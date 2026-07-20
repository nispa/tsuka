import { OpenAI } from 'openai';
import { ThinkTagParser, stripThinkBlocks, StreamChannel } from './thinkParser';

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
    try {
      const response = await this.client.chat.completions.create({
        model: this.currentModel,
        messages: messages as any,
        tools: tools,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
        stream: !!onChunk,
        // Richiede le statistiche d'uso reali nel chunk finale dello stream
        // (supportato da OpenAI/OpenRouter; Ollama ignora i campi sconosciuti senza errori)
        ...(onChunk ? { stream_options: { include_usage: true } } : {})
      }, signal ? { signal } : undefined);

      if (onChunk && (Symbol.asyncIterator in response || (response as any)[Symbol.asyncIterator])) {
        let fullText = '';
        const toolCallsAccumulator: any[] = [];
        let chunkCount = 0;
        let usage: any = null;

        // Separa i blocchi <think> inline dal contenuto: la cronologia (fullText)
        // non deve contenere il reasoning, che viaggia sul canale dedicato
        const thinkParser = new ThinkTagParser((text, channel) => {
          if (channel === 'content') {
            fullText += text;
          }
          onChunk(text, channel);
        });

        for await (const chunk of response as any) {
          // Il chunk finale dello stream può contenere le statistiche d'uso reali (choices vuoto)
          if (chunk?.usage) {
            usage = chunk.usage;
          }

          const choice = chunk.choices?.[0];
          const content = choice?.delta?.content || '';
          // OpenRouter espone il reasoning come campo delta dedicato
          // (alcuni gateway DeepSeek-compatibili usano reasoning_content)
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

        // Rilascia eventuale testo trattenuto dal parser (prefissi di tag a fine stream)
        thinkParser.flush();

        // Pulisce e filtra lo stream dei tool call accumulati
        const cleanToolCalls = toolCallsAccumulator.filter(
          (tc) => tc && tc.function && tc.function.name
        );

        const durationMs = Date.now() - startTime;
        // Token reali dall'API (completion_tokens); fallback al conteggio dei chunk se assenti
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

        // Token reali dall'API se presenti; altrimenti stima basata sulla lunghezza del testo
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
      throw new Error(`Errore di comunicazione con il modello '${this.currentModel}': ${error.message}`);
    }
  }
}
