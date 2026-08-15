/**
 * MockLLMProvider — provider LLM scriptabile per test deterministici (T1.1,
 * PLANNING-QUALITA.md). Implementa ILLMProvider (src/core/provider.ts) senza
 * chiamare nessun endpoint reale: risponde da un copione di risposte predefinite,
 * nell'ordine in cui vengono richieste da Agent / team.ts / goal.ts.
 *
 * Uso tipico:
 *   const provider = new MockLLMProvider([
 *     { toolCalls: [mockToolCall('read_file', { path: 'x.txt' })] },
 *     { content: 'Fatto.' }
 *   ]);
 *   const agent = new Agent(provider, registry, permissionManager, 'system prompt');
 *   await agent.run('leggi x.txt');
 *   // provider.callLog contiene le 2 chiamate ricevute, ispezionabili nel test
 */
import { ChatMessageLike, ChatOptions, ChatResponse, ChatStats, ILLMProvider } from '../../src/core/provider';
import { StreamChannel } from '../../src/core/thinkParser';

export interface MockToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Costruisce un tool_call nella forma restituita dall'API OpenAI-compatible
 * (arguments serializzati come stringa JSON, come li riceve Agent.run).
 */
let mockToolCallSeq = 0;
export function mockToolCall(name: string, args: Record<string, any> = {}): MockToolCall {
  mockToolCallSeq++;
  return {
    id: `mock_call_${mockToolCallSeq}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) }
  };
}

export interface ScriptedResponse {
  /** Testo della risposta assistant. Omesso o '' se la risposta è solo tool_calls. */
  content?: string;
  /** Tool call richieste dal "modello" in questo round. */
  toolCalls?: MockToolCall[];
  /** Override parziale delle statistiche di generazione (default: valori fittizi coerenti). */
  stats?: Partial<ChatStats>;
}

export interface MockCallRecord {
  /** Snapshot dei messaggi ricevuti in questa chiamata (copia, non riferimento condiviso). */
  messages: ChatMessageLike[];
  tools?: any[];
  hadOnChunk: boolean;
  /** ChatOptions ricevute (T8.10): permette ai test di ispezionare quale
   *  reasoning_effort è arrivato davvero fino al provider, dopo la cascata. */
  options?: ChatOptions;
}

/**
 * Provider fittizio che consuma un copione di ScriptedResponse in ordine, una per
 * ogni chiamata a chatWithTools. Se il copione si esaurisce, lancia un errore
 * esplicito: è un segnale che il test è mal dimensionato (mancano round attesi),
 * non un comportamento da mascherare con un fallback silenzioso.
 */
export class MockLLMProvider implements ILLMProvider {
  readonly callLog: MockCallRecord[] = [];
  private cursor = 0;
  private currentModel: string;
  private baseUrl: string;

  constructor(private readonly script: ScriptedResponse[], opts?: { model?: string; baseUrl?: string }) {
    this.currentModel = opts?.model ?? 'mock-model-9b';
    this.baseUrl = opts?.baseUrl ?? 'mock://local';
  }

  /** Numero di risposte del copione non ancora consumate. */
  get remaining(): number {
    return this.script.length - this.cursor;
  }

  async chatWithTools(
    messages: ChatMessageLike[],
    tools?: any[],
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    signal?: AbortSignal,
    options?: ChatOptions
  ): Promise<ChatResponse> {
    this.callLog.push({ messages: messages.map((m) => ({ ...m })), tools, hadOnChunk: !!onChunk, options });

    if (signal?.aborted) {
      return { content: '' };
    }

    if (this.cursor >= this.script.length) {
      throw new Error(
        `MockLLMProvider: copione esaurito dopo ${this.cursor} chiamate. ` +
        `Il test si aspetta più round di quanti ne siano stati scriptati: aggiungi altre ScriptedResponse.`
      );
    }

    const scripted = this.script[this.cursor++];

    if (onChunk && scripted.content) {
      onChunk(scripted.content, 'content');
    }

    const tokenCount = scripted.stats?.tokenCount ?? Math.ceil((scripted.content?.length ?? 0) / 3.5);
    const promptTokens = scripted.stats?.promptTokens ?? 0;
    const stats: ChatStats = {
      durationMs: scripted.stats?.durationMs ?? 1,
      tokenCount,
      tokensPerSecond: scripted.stats?.tokensPerSecond ?? 0,
      promptTokens,
      totalTokens: scripted.stats?.totalTokens ?? promptTokens + tokenCount
    };

    return {
      content: scripted.content ?? '',
      toolCalls: scripted.toolCalls,
      stats
    };
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

  async listModels(): Promise<string[]> {
    return [this.currentModel];
  }

  reconfigure(baseUrl: string, _apiKey: string, defaultModel: string): void {
    this.baseUrl = baseUrl;
    this.currentModel = defaultModel;
  }
}
