import { OpenAI } from 'openai';
import chalk from 'chalk';
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from './thinkParser';

const FIRST_TOKEN_TIMEOUT_MS = 120_000; // 2 minuti di attesa per il primo token
const MAX_RETRIES = 3;                  // tentativi prima di dichiarare "mancata risposta"

// dotenv caricato dal punto di ingresso (cli/index.ts)

export class LLMProvider {
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
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }>,
    tools?: any[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal
  ): Promise<{ content: string; toolCalls?: any[]; stats?: { durationMs: number; tokenCount: number; tokensPerSecond: number } }> {
    const startTime = Date.now();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) break;

      const attemptAbort = new AbortController();
      let timedOut = false;

      const onUserAbort = () => attemptAbort.abort();
      if (signal) {
        if (signal.aborted) break;
        signal.addEventListener('abort', onUserAbort, { once: true });
      }

      const firstTokenTimer = setTimeout(() => {
        timedOut = true;
        attemptAbort.abort();
      }, FIRST_TOKEN_TIMEOUT_MS);

      try {
        const response = await this.client.chat.completions.create({
          model: this.currentModel,
          messages: messages as any,
          tools: tools,
          tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
          stream: !!onChunk,
          ...(onChunk ? { stream_options: { include_usage: true } } : {})
        }, { signal: attemptAbort.signal });

        const isStreaming = onChunk && (Symbol.asyncIterator in response || (response as any)[Symbol.asyncIterator]);
        if (!isStreaming) clearTimeout(firstTokenTimer);

        if (isStreaming) {
          let fullText = '';
          const toolCallsAccumulator: any[] = [];
          let chunkCount = 0;
          let usage: any = null;
          let receivedFirstToken = false;

          const thinkParser = new ThinkTagParser((text, channel) => {
            if (channel === 'content') {
              fullText += text;
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

          clearTimeout(firstTokenTimer);
          thinkParser.flush();

          const cleanToolCalls = toolCallsAccumulator.filter(
            (tc) => tc && tc.function && tc.function.name
          );

          const durationMs = Date.now() - startTime;
          const tokenCount = usage?.completion_tokens ?? chunkCount;
          const tokensPerSecond = durationMs > 0 ? (tokenCount / (durationMs / 1000)) : 0;

          return {
            content: fullText,
            toolCalls: cleanToolCalls.length > 0 ? cleanToolCalls : undefined,
            stats: {
              durationMs,
              tokenCount,
              tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1))
            }
          };
        } else {
          const nonStreamResponse = response as any;
          const msg = nonStreamResponse.choices[0]?.message;
          const content = stripThinkBlocks(msg?.content || '');
          const durationMs = Date.now() - startTime;

          const charPerToken = 3.5;
          const tokenCount = nonStreamResponse.usage?.completion_tokens ?? Math.round(content.length / charPerToken);
          const tokensPerSecond = durationMs > 0 ? (tokenCount / (durationMs / 1000)) : 0;

          return {
            content: content,
            toolCalls: msg?.tool_calls || undefined,
            stats: {
              durationMs,
              tokenCount,
              tokensPerSecond: parseFloat(tokensPerSecond.toFixed(1))
            }
          };
        }
      } catch (error: any) {
        if (signal?.aborted) break;

        if (timedOut) {
          if (attempt < MAX_RETRIES) {
            process.stdout.write('\n');
            console.log(
              chalk.yellow(`[Tentativo ${attempt}/${MAX_RETRIES}] Il modello '${this.currentModel}' non risponde, riprovo...`)
            );
            continue;
          }
          throw new Error(
            `[Mancata risposta] Il modello '${this.currentModel}' non ha prodotto token dopo ${MAX_RETRIES} tentativi ` +
            `(timeout: ${FIRST_TOKEN_TIMEOUT_MS / 1000}s per tentativo).`
          );
        }

        throw new Error(`Errore di comunicazione con il modello '${this.currentModel}': ${error.message}`);
      } finally {
        clearTimeout(firstTokenTimer);
        if (signal) signal.removeEventListener('abort', onUserAbort);
      }
    }

    throw new Error(
      `[Mancata risposta] Il modello '${this.currentModel}' non ha prodotto token dopo ${MAX_RETRIES} tentativi ` +
      `(timeout: ${FIRST_TOKEN_TIMEOUT_MS / 1000}s per tentativo).`
    );
  }
}
