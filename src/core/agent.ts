import { LLMProvider } from './provider';
import { ToolRegistry } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { AgentEvent, AgentEventHandler } from './agentEvents';
import { StreamChannel } from './thinkParser';
import chalk from 'chalk';

/**
 * Renderer minimale usato quando il chiamante non fornisce un handler eventi
 * (test, usi programmatici). La CLI passa il proprio (StreamRenderer).
 */
function plainEventRenderer(ev: AgentEvent): void {
  switch (ev.type) {
    case 'tool_start':
      console.log(chalk.cyan(`[tool] ${ev.name}...`));
      break;
    case 'tool_end':
      console.log(chalk.gray(`[tool] ${ev.name} ${ev.success ? 'completato' : 'fallito/rifiutato'}`));
      break;
    case 'max_rounds':
      console.log(chalk.yellow(`[Interruzione: raggiunto il limite di ${ev.limit} cicli di tool]`));
      break;
  }
}

export class Agent {
  // Limite di sicurezza: massimo numero di cicli consecutivi di esecuzione tool
  // per singola richiesta utente (evita loop infiniti se il modello continua a richiedere tool)
  private static readonly MAX_TOOL_ROUNDS = 15;

  private provider: LLMProvider;
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: any[]; tool_call_id?: string; name?: string }> = [];
  private allowedTools?: string[];
  private maxHistoryMessages: number;
  private maxHistoryTokens: number;

  constructor(
    provider: LLMProvider,
    registry: ToolRegistry,
    permissionManager: PermissionManager,
    systemPrompt: string,
    allowedTools?: string[],
    maxHistoryMessages: number = 40,
    maxHistoryTokens: number = 65536
  ) {
    this.provider = provider;
    this.registry = registry;
    this.permissionManager = permissionManager;
    this.allowedTools = allowedTools;
    this.maxHistoryMessages = Math.max(4, maxHistoryMessages);
    this.maxHistoryTokens = Math.max(0, maxHistoryTokens);
    this.clearHistory(systemPrompt);
  }

  /**
   * Stima i token di un messaggio (~3,5 caratteri/token), inclusi gli eventuali
   * tool_calls serializzati che viaggiano nel contesto insieme al content.
   */
  private static estimateTokens(m: { content: string | null; tool_calls?: any[] }): number {
    let chars = typeof m.content === 'string' ? m.content.length : 0;
    if (m.tool_calls) {
      try { chars += JSON.stringify(m.tool_calls).length; } catch {}
    }
    return Math.ceil(chars / 3.5);
  }

  getMessages() {
    return this.messages;
  }

  clearHistory(systemPrompt: string): void {
    this.messages = [
      { role: 'system', content: systemPrompt }
    ];
  }

  /**
   * Mantiene la cronologia entro i limiti configurati: conserva il system prompt
   * e taglia i messaggi meno recenti in base a due criteri combinati:
   *  1. numero massimo di messaggi (maxHistoryMessages);
   *  2. budget di token stimati (maxHistoryTokens): protegge la context window
   *     anche quando pochi messaggi contengono output tool molto grandi.
   * Il punto di taglio è scelto in modo sicuro: il primo messaggio mantenuto non è
   * mai una risposta 'tool' orfana del suo tool_call (altrimenti l'API rifiuterebbe
   * la richiesta) e restano sempre almeno gli ultimi 3 messaggi oltre al system.
   * Ritorna il numero di messaggi rimossi.
   */
  pruneHistory(): number {
    // 1) Limite a conteggio messaggi
    let start = 1;
    if (this.messages.length > this.maxHistoryMessages) {
      start = this.messages.length - (this.maxHistoryMessages - 1);
    }

    // 2) Limite a token stimati: avanza il punto di taglio finché il budget è
    //    rispettato, senza mai scendere sotto gli ultimi 3 messaggi (un output
    //    recente sopra budget da solo resta: rimuoverlo romperebbe il turno in corso)
    if (this.maxHistoryTokens > 0) {
      let total = Agent.estimateTokens(this.messages[0]);
      for (let i = start; i < this.messages.length; i++) {
        total += Agent.estimateTokens(this.messages[i]);
      }
      while (total > this.maxHistoryTokens && start < this.messages.length - 3) {
        total -= Agent.estimateTokens(this.messages[start]);
        start++;
      }
    }

    // Taglio sicuro rispetto alle coppie tool_call/tool
    while (start < this.messages.length - 1 && this.messages[start].role === 'tool') {
      start++;
    }

    const removed = start - 1;
    if (removed <= 0) {
      return 0;
    }

    this.messages = [this.messages[0], ...this.messages.slice(start)];
    console.log(
      chalk.gray(`[Cronologia: rimossi ${removed} messaggi meno recenti per restare entro i limiti di contesto (${this.maxHistoryMessages} messaggi / ~${this.maxHistoryTokens} token)]`)
    );
    return removed;
  }

  /**
   * Avvia il ciclo agentico per elaborare un messaggio utente.
   * Il ciclo continuerà finché il modello richiede esecuzioni di tool.
   */
  async run(
    userMessage: string,
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    onStats?: (stats: { durationMs: number; tokenCount: number; tokensPerSecond: number }) => void,
    onEvent?: AgentEventHandler,
    signal?: AbortSignal
  ): Promise<string> {
    const emit = onEvent ?? plainEventRenderer;
    this.messages.push({ role: 'user', content: userMessage });

    let isDone = false;
    let finalAnswer = '';
    let toolRounds = 0;

    while (!isDone) {
      const tools = this.registry.listForLLM(this.provider.getCurrentModel(), this.allowedTools);

      // Mantiene il contesto entro la finestra configurata prima di ogni chiamata API
      this.pruneHistory();

      try {
        // Richiesta all'LLM (invia messaggi storici e l'elenco dei tool disponibili)
        const response = await this.provider.chatWithTools(
          this.messages,
          tools.length > 0 ? tools : undefined,
          onChunk,
          signal
        );

        const { content, toolCalls, stats } = response;

        // Aggiunge la risposta dell'assistente alla storia locale
        const assistantMessage: any = { role: 'assistant', content: content || null };
        if (toolCalls && toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        this.messages.push(assistantMessage);

        if (content) {
          finalAnswer = content;
        }

        // Invia i dati statistici della generazione se disponibili
        if (stats && onStats) {
          onStats(stats);
        }

        // Se l'LLM non richiede nessun tool, il ciclo è terminato
        if (!toolCalls || toolCalls.length === 0) {
          isDone = true;
          break;
        }

        // Esegue le chiamate ai tool richieste dal modello
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          let toolArgs: any = {};

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            toolArgs = toolCall.function.arguments;
          }

          emit({ type: 'tool_start', name: toolName, args: toolArgs });

          // Esecuzione del tool con verifica dei permessi integrata
          const result = await this.registry.executeTool(toolName, toolArgs, this.permissionManager);

          // Aggiunge l'output del tool alla cronologia dei messaggi
          this.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.output
          });

          emit({ type: 'tool_end', name: toolName, args: toolArgs, success: result.success, output: result.output });
        }

        // Guardia anti loop-infinito: se il modello continua a richiedere tool oltre
        // il limite, interrompiamo il ciclo con un messaggio esplicito all'utente.
        // La cronologia resta coerente: tutti i tool_calls dell'ultimo giro hanno già
        // ricevuto il rispettivo messaggio 'tool' nel for-loop qui sopra.
        toolRounds++;
        if (toolRounds >= Agent.MAX_TOOL_ROUNDS) {
          const stopMessage =
            `[Interruzione di sicurezza] Ho raggiunto il limite massimo di ${Agent.MAX_TOOL_ROUNDS} ` +
            `cicli consecutivi di esecuzione tool per questa richiesta. Il processo è stato fermato ` +
            `per evitare un loop infinito. Riformula la richiesta o spezzala in passi più piccoli.`;
          emit({ type: 'max_rounds', limit: Agent.MAX_TOOL_ROUNDS });
          this.messages.push({ role: 'assistant', content: stopMessage });
          finalAnswer = stopMessage;
          break;
        }

        // Il loop continua: segnala al renderer che l'agente sta rielaborando i risultati
        emit({ type: 'round_continue', round: toolRounds });

      } catch (error: any) {
        // Interruzione richiesta dall'utente (Esc): uscita pulita, non è un errore
        if (signal?.aborted) break;
        throw new Error(`Errore nel ciclo agentico: ${error.message}`);
      }
    }

    return finalAnswer;
  }
}
