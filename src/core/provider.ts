import { OpenAI } from 'openai';
import chalk from 'chalk';
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from './thinkParser';
import { ChatMessage, ChatRole, ToolCall } from './types';
import { logSink } from './logSink';

const FIRST_TOKEN_TIMEOUT_MS = 120_000; // 2 minuti di attesa per il primo token
const MAX_RETRIES = 3;                  // tentativi prima di dichiarare "mancata risposta"

// ── T8.11: timeout a orologio sull'intera generazione ──
// FIRST_TOKEN_TIMEOUT_MS si azzera al primo token: da lì in poi, prima di questo
// task, la generazione era illimitata (unica uscita: Esc dell'utente). Questo
// secondo timer NON si azzera mai — copre l'intera durata di un tentativo,
// pensiero incluso — e riusa lo stesso attemptAbort già armato per il primo
// timer. Variabile (non const) con setter dedicato: è l'unico modo per un test
// di non dover davvero aspettare 5 minuti reali per esercitare il ramo di
// timeout (vedi tests/test_generation_timeout.ts). Non va in tsuka.config.json
// di proposito (fuori proprietà file, vedi TASKS.md): resta una costante di
// modulo affiancata a FIRST_TOKEN_TIMEOUT_MS.
let MAX_GENERATION_MS = 120_000; // 2 minuti di default, configurabile tramite tsuka.config.json (llmTimeoutMs)

/**
 * Configura il timeout a orologio sull'intera generazione LLM (T8.16).
 */
export function setLlmTimeoutMs(ms: number): void {
  if (ms >= 1000) {
    MAX_GENERATION_MS = ms;
  }
}

/**
 * Solo per i test (T8.11/T8.16): permette di abbassare la soglia del timeout
 * sull'intera generazione senza attese reali.
 */
export function __setMaxGenerationMsForTest(ms: number): void {
  MAX_GENERATION_MS = ms;
}

// T8.11: soffitto vero e generoso sui token generati per singolo tentativo —
// non un valore "da tarare". Con un modello che ragiona deve coprire pensiero
// + risposta: se troppo stretto tronca una tool call a metà JSON, che è peggio
// che lento. 8k token è oltre quanto qualunque risposta normale raggiunge.
const MAX_TOKENS_CEILING = 8192;

/**
 * T9.8: distingue un errore di JSON malformato nella tool call generata dal
 * modello (glitch di campionamento, spesso non riproducibile al tentativo
 * successivo) da un errore di comunicazione generico (server giù, rete,
 * richiesta rifiutata) — solo il primo merita un retry immediato. Osservato in
 * produzione con llama-server su un argomento stringa lungo: "Failed to parse
 * tool call arguments as JSON: [json.exception.parse_error.101] ... invalid
 * string: missing closing quote". Il pattern resta permissivo (non ancorato al
 * messaggio esatto di un singolo backend) perché server OpenAI-compatible
 * diversi (vLLM, ollama, llama-server) lo formulano in modo leggermente
 * diverso, ma tutti nominano "tool call" insieme a "json"/"parse".
 */
function isMalformedToolCallJsonError(message: string): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('tool call') && (m.includes('json') || m.includes('parse'));
}

// dotenv caricato dal punto di ingresso (cli/index.ts)

export type { ChatRole };
// Alias storico: ChatMessageLike === ChatMessage (src/core/types.ts, T4.1). Nome
// mantenuto per compatibilità con gli importatori esistenti (es. tests/mocks/).
export type ChatMessageLike = ChatMessage;

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'xhigh';

export type CreativityLevel = 'precise' | 'balanced' | 'creative' | 'low' | 'medium' | 'high';

export interface SamplingParams {
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

/**
 * Opzioni di chat non legate ai messaggi (T8.10/T8.17):
 * - reasoningEffort: sforzo di ragionamento per modelli reasoning ('none'|'low'|'medium'|'xhigh')
 * - creativity: preset sintetico umano per lo stile del campionamento ('precise'|'balanced'|'creative')
 * - parametri di campionamento numerici (temperature, topP, presencePenalty, frequencyPenalty)
 */
export interface ChatOptions extends SamplingParams {
  reasoningEffort?: ReasoningEffort;
  creativity?: CreativityLevel;
}

export function resolveSamplingParams(options?: ChatOptions): {
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
} {
  if (!options) return {};

  let temperature = options.temperature;
  let top_p = options.topP;
  let presence_penalty = options.presencePenalty;
  let frequency_penalty = options.frequencyPenalty;

  if (options.creativity) {
    switch (options.creativity) {
      case 'precise':
      case 'low':
        temperature = temperature ?? 0.2;
        top_p = top_p ?? 0.8;
        break;
      case 'creative':
      case 'high':
        temperature = temperature ?? 0.95;
        top_p = top_p ?? 0.95;
        presence_penalty = presence_penalty ?? 0.3;
        break;
      case 'balanced':
      case 'medium':
      default:
        temperature = temperature ?? 0.7;
        top_p = top_p ?? 0.9;
        break;
    }
  }

  const result: {
    temperature?: number;
    top_p?: number;
    presence_penalty?: number;
    frequency_penalty?: number;
  } = {};
  if (temperature !== undefined) result.temperature = temperature;
  if (top_p !== undefined) result.top_p = top_p;
  if (presence_penalty !== undefined) result.presence_penalty = presence_penalty;
  if (frequency_penalty !== undefined) result.frequency_penalty = frequency_penalty;
  return result;
}

export interface ChatStats {
  durationMs: number;
  tokenCount: number;
  tokensPerSecond: number;
  promptTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  stats?: ChatStats;
  /** T9.12: catena di pensiero completa di questo round (se il modello ne ha
   *  prodotta una), per uso opzionale del chiamante — es. persisterla come nota
   *  di memoria invece di lasciarla sparire dopo il rendering live. undefined se
   *  il modello non ha fatto reasoning separato dal content. */
  reasoningText?: string;
}

/**
 * Contratto minimo usato da Agent e dai comandi CLI. Estratto da LLMProvider per
 * permettere implementazioni alternative (es. MockLLMProvider nei test) senza
 * toccare il comportamento del provider reale: LLMProvider la implementa e basta.
 */
export interface ILLMProvider {
  chatWithTools(
    messages: ChatMessage[],
    tools?: any[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<ChatResponse>;
  getCurrentModel(): string;
  setCurrentModel(model: string): void;
  getBaseUrl(): string;
  listModels(): Promise<string[]>;
  reconfigure(baseUrl: string, apiKey: string, defaultModel: string): void;
}

export class LLMProvider implements ILLMProvider {
  private client: OpenAI;
  private currentModel: string;
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string, defaultModel: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || 'ollama';
    this.currentModel = defaultModel;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  /**
   * Ripunta l'istanza a un altro provider (endpoint/chiave/modello) ricreando
   * il client. Muta l'istanza condivisa: i riferimenti esistenti (agent,
   * closure della REPL, CommandCtx) restano validi senza sostituzioni.
   */
  reconfigure(baseUrl: string, apiKey: string, defaultModel: string): void {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || 'ollama';
    this.currentModel = defaultModel;
    this.client = new OpenAI({
      baseURL: this.baseUrl,
      apiKey: this.apiKey,
      dangerouslyAllowBrowser: true
    });
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

  setCurrentModel(model: string): void {
    this.currentModel = model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Elenca tutti i modelli disponibili presso il provider.
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.models.list();
      return response.data.map((m) => m.id).sort();
    } catch (error: any) {
      if (this.baseUrl.includes('localhost') || this.baseUrl.includes('127.0.0.1')) {
        try {
          const directUrl = this.baseUrl.replace(/\/v1\/?$/, '/api/tags');
          const response = await fetch(directUrl);
          if (response.ok) {
            const data = await response.json() as { models?: Array<{ name: string }> };
            if (data.models && Array.isArray(data.models)) {
              return data.models.map((m) => m.name).sort();
            }
          }
        } catch (fetchError) {}
      }
      throw new Error(`Errore nel recupero dei modelli da ${this.baseUrl}: ${error.message}`);
    }
  }

  /**
   * Effettua una chiamata di chat completions con supporto per i Tool (Function Calling).
   * Gestisce l'accumulo dello stream sia per il testo che per i tool.
   * Le statistiche sui token usano il campo `usage` reale dell'API quando disponibile
   * (richiesto esplicitamente via stream_options), con fallback su stima.
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools?: any[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<ChatResponse> {
    const startTime = Date.now();
    // T9.12: reasoning accumulato ATTRAVERSO i tentativi (non solo quello
    // dell'ultimo) — un retry su timeout/JSON malformato non deve far perdere il
    // pensiero già prodotto dai tentativi precedenti, vedi il blocco catch sotto.
    let allReasoningText = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) break;

      const attemptAbort = new AbortController();
      let timedOut = false;
      let generationTimedOut = false; // T8.11: timeout sull'INTERA generazione (il modello stava rispondendo)
      // T9.12: accumulo del reasoning di QUESTO tentativo, dichiarato qui (non dentro
      // il ramo streaming più sotto) apposta perché deve restare leggibile anche dal
      // blocco catch: un ragionamento lungo interrotto da un timeout o da un tool call
      // JSON malformato lato server veniva finora perso — il testo era già stato
      // generato (e mostrato live), ma buttato via a fine chiamata. Ora resta
      // recuperabile su ChatResponse.reasoningText (successo) o Error.partialReasoning
      // (fallimento/interruzione) — vedi il chiamante in core/agent.ts, che lo
      // persiste come nota di memoria invece di lasciarlo sparire.
      let reasoningText = '';

      const onUserAbort = () => attemptAbort.abort();
      if (signal) {
        if (signal.aborted) break;
        signal.addEventListener('abort', onUserAbort, { once: true });
      }

      const firstTokenTimer = setTimeout(() => {
        timedOut = true;
        attemptAbort.abort();
      }, FIRST_TOKEN_TIMEOUT_MS);

      // T8.11: secondo timer, MAI azzerato all'arrivo del primo token (a differenza
      // di firstTokenTimer, azzerato più sotto). Stesso attemptAbort: interrompe la
      // richiesta in corso esattamente come fa il timeout sul primo token, ma qui il
      // modello stava producendo output — il messaggio d'errore in catch lo distingue.
      const generationTimer = setTimeout(() => {
        generationTimedOut = true;
        attemptAbort.abort();
      }, MAX_GENERATION_MS);

      try {
        const response = await this.client.chat.completions.create({
          model: this.currentModel,
          messages: messages as any,
          tools: tools,
          tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
          stream: !!onChunk,
          ...(onChunk ? { stream_options: { include_usage: true } } : {}),
          // T8.11: soffitto vero, non un limite da tarare — vedi MAX_TOKENS_CEILING.
          max_tokens: MAX_TOKENS_CEILING,
          // T8.10: senza questo parametro il modello gira sui propri default (per
          // alcuni modelli locali, xhigh — il massimo sforzo anche per un banale
          // read_file). SDK OpenAI tipizza reasoning_effort solo low/medium/high:
          // 'none'/'xhigh' sono livelli aggiuntivi supportati dai provider locali,
          // quindi il cast `as any` qui è necessario, non un ripiego.
          ...(options?.reasoningEffort ? { reasoning_effort: options.reasoningEffort as any } : {}),
          ...resolveSamplingParams(options)
        }, { signal: attemptAbort.signal });

        const isStreaming = onChunk && (Symbol.asyncIterator in response || (response as any)[Symbol.asyncIterator]);
        if (!isStreaming) clearTimeout(firstTokenTimer);

        if (isStreaming) {
          let fullText = '';
          const toolCallsAccumulator: ToolCall[] = [];
          let chunkCount = 0;
          let usage: any = null;
          let receivedFirstToken = false;

          const thinkParser = new ThinkTagParser((text, channel) => {
            if (channel === 'content') {
              fullText += text;
            } else {
              // T9.12: reasoning estratto da tag <think> dentro il content (modelli
              // senza campo 'reasoning' separato nella delta) — vedi anche il ramo
              // 'reasoning' esplicito qui sotto per i modelli che invece lo espongono.
              reasoningText += text;
            }
            onChunk(text, channel);
          });

          for await (const chunk of response as any) {
            if (!receivedFirstToken) {
              receivedFirstToken = true;
              clearTimeout(firstTokenTimer);
            }

            if (chunk?.usage) {
              usage = chunk.usage;
            }

            const choice = chunk.choices?.[0];
            const content = choice?.delta?.content || '';
            const reasoning = (choice?.delta as any)?.reasoning || (choice?.delta as any)?.reasoning_content || '';

            if (reasoning) {
              chunkCount++;
              reasoningText += reasoning;
              onChunk(reasoning, 'reasoning');
            }

            if (content) {
              chunkCount++;
              thinkParser.push(content);
            }

            if (choice?.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallsAccumulator[idx]) {
                  toolCallsAccumulator[idx] = {
                    id: '',
                    type: 'function',
                    function: { name: '', arguments: '' }
                  };
                }
                if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                if (tc.function?.name) toolCallsAccumulator[idx].function.name += tc.function.name;
                if (tc.function?.arguments) toolCallsAccumulator[idx].function.arguments += tc.function.arguments;
              }
            }
          }

          // T9.9: la SDK OpenAI (node_modules/openai/streaming.js, Stream.fromSSEResponse)
          // intercetta l'AbortError generato dal NOSTRO attemptAbort.abort() e chiude
          // l'iteratore con un `return` silenzioso invece di rilanciare — comportamento
          // pensato per l'uso pubblico di `stream.controller.abort()`, dove il chiamante
          // ha chiesto lui di fermarsi e non vuole un errore. Senza questo controllo, un
          // timeout scattato a metà stream (T8.11/T8.16) produceva un ChatResponse
          // "riuscito" con testo troncato a metà (osservato in produzione: risposta
          // interrotta a "I'm " con il normale footer di stats, nessun errore visibile).
          // Rilanciamo qui un errore generico per rientrare nella gestione già corretta
          // del blocco catch sottostante (retry per timedOut, errore definitivo per
          // generationTimedOut) invece di restituire silenziosamente il parziale.
          if (generationTimedOut || timedOut) {
            throw new Error('__generation_aborted_by_timeout__');
          }

          clearTimeout(firstTokenTimer);
          thinkParser.flush();

          const cleanToolCalls = toolCallsAccumulator.filter(
            (tc) => tc && tc.function && tc.function.name
          );

          const durationMs = Date.now() - startTime;
          const tokenCount = usage?.completion_tokens ?? chunkCount;
          const promptTokens = usage?.prompt_tokens ?? 0;
          const totalTokens = usage?.total_tokens ?? (promptTokens + tokenCount);
          const tokensPerSecond = durationMs > 0 ? (tokenCount / (durationMs / 1000)) : 0;

          return {
            content: fullText,
            toolCalls: cleanToolCalls.length > 0 ? cleanToolCalls : undefined,
            reasoningText: reasoningText || undefined,
            stats: {
              durationMs,
              tokenCount,
              tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1)),
              promptTokens,
              totalTokens
            }
          };
        } else {
          const nonStreamResponse = response as any;
          const msg = nonStreamResponse.choices[0]?.message;
          const content = stripThinkBlocks(msg?.content || '');
          const durationMs = Date.now() - startTime;

          const charPerToken = 3.5;
          const tokenCount = nonStreamResponse.usage?.completion_tokens ?? Math.round(content.length / charPerToken);
          const promptTokens = nonStreamResponse.usage?.prompt_tokens ?? 0;
          const totalTokens = nonStreamResponse.usage?.total_tokens ?? (promptTokens + tokenCount);
          const tokensPerSecond = durationMs > 0 ? (tokenCount / (durationMs / 1000)) : 0;

          return {
            content: content,
            toolCalls: msg?.tool_calls || undefined,
            stats: {
              durationMs,
              tokenCount,
              tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1)),
              promptTokens,
              totalTokens
            }
          };
        }
      } catch (error: any) {
        if (signal?.aborted) break;

        // T9.12: il reasoning di QUESTO tentativo (se ce n'era) entra nell'accumulo
        // cross-tentativo PRIMA di qualunque retry/throw — così un secondo o terzo
        // tentativo non fa perdere il pensiero già prodotto da quelli precedenti,
        // e ogni errore lanciato qui sotto lo porta con sé (Error.partialReasoning)
        // invece di lasciarlo sparire con l'eccezione.
        if (reasoningText) {
          allReasoningText += (allReasoningText ? '\n\n---\n\n' : '') + reasoningText;
        }

        // T8.11: controllato PRIMA di timedOut — il modello stava generando (ha già
        // superato il timeout sul primo token, altrimenti sarebbe quest'ultimo a
        // scattare per primo), quindi il messaggio va distinto da "mancata risposta"
        // (che diagnosticherebbe il problema sbagliato: qui non è silenzio, è lentezza).
        // Interruzione definitiva, senza retry: un tentativo che ha già occupato
        // MAX_GENERATION_MS non va ripetuto da capo, raddoppiando l'attesa in silenzio.
        if (generationTimedOut) {
          throw Object.assign(
            new Error(
              `[Timeout generazione] Il modello '${this.currentModel}' stava rispondendo ma ha superato il limite di ` +
              `${MAX_GENERATION_MS / 1000}s per l'intera generazione: interrotto. Non è una mancata risposta — il ` +
              `modello stava producendo output quando è scattato il timeout.`
            ),
            { partialReasoning: allReasoningText || undefined }
          );
        }

        if (timedOut) {
          if (attempt < MAX_RETRIES) {
            process.stdout.write('\n');
            logSink.log(
              chalk.yellow(`[Tentativo ${attempt}/${MAX_RETRIES}] Il modello '${this.currentModel}' non risponde, riprovo...`)
            );
            continue;
          }
          throw Object.assign(
            new Error(
              `[Mancata risposta] Il modello '${this.currentModel}' non ha prodotto token dopo ${MAX_RETRIES} tentativi ` +
              `(timeout: ${FIRST_TOKEN_TIMEOUT_MS / 1000}s per tentativo).`
            ),
            { partialReasoning: allReasoningText || undefined }
          );
        }

        // T9.8: JSON malformato in una tool call — retry immediato (stesso giro di
        // tentativi di "mancata risposta"), perché è tipicamente un glitch di
        // campionamento che non si ripete al tentativo successivo, non un guasto
        // persistente. Un tentativo già scaduto per timeout non arriva qui (i due
        // rami sopra hanno già lanciato), quindi nessuna sovrapposizione.
        if (isMalformedToolCallJsonError(error.message)) {
          if (attempt < MAX_RETRIES) {
            process.stdout.write('\n');
            logSink.log(
              chalk.yellow(`[Tentativo ${attempt}/${MAX_RETRIES}] Il server ha rifiutato una tool call con JSON malformato, riprovo...`)
            );
            continue;
          }
          throw Object.assign(
            new Error(
              `[JSON malformato] Il modello '${this.currentModel}' ha generato ripetutamente (${MAX_RETRIES} tentativi) una tool call ` +
              `con argomenti JSON non validi. Errore del server: ${error.message}`
            ),
            { partialReasoning: allReasoningText || undefined }
          );
        }

        throw Object.assign(
          new Error(`Errore di comunicazione con il modello '${this.currentModel}': ${error.message}`),
          { partialReasoning: allReasoningText || undefined }
        );
      } finally {
        // T8.11: entrambi i timer ripuliti qui, incondizionatamente — copre ogni
        // uscita dal try (successo, errore, abort utente), non solo il percorso felice.
        clearTimeout(firstTokenTimer);
        clearTimeout(generationTimer);
        if (signal) signal.removeEventListener('abort', onUserAbort);
      }
    }

    throw new Error(
      `[Mancata risposta] Il modello '${this.currentModel}' non ha prodotto token dopo ${MAX_RETRIES} tentativi ` +
      `(timeout: ${FIRST_TOKEN_TIMEOUT_MS / 1000}s per tentativo).`
    );
  }
}
