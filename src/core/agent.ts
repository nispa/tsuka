import { ILLMProvider, ChatOptions, ReasoningEffort } from './provider';
import { ToolRegistry } from '../tools/registry';
import { PermissionManager } from '../safety/permissions';
import { AgentEvent, AgentEventHandler } from './agentEvents';
import { StreamChannel } from './thinkParser';
import chalk from 'chalk';
import { MemoryStore } from './memory';
import { ChatMessage } from './types';

/**
 * Sagoma minima per la cascata di risoluzione del reasoning_effort (T8.10):
 * qualunque oggetto con un campo opzionale `reasoningEffort` la soddisfa, così
 * i CharacterConfig/RoleConfig reali (src/cli/shared.ts, VIETATO da toccare in
 * questo task) non vanno importati qui — bastano duck-typing e il campo in più
 * nei rispettivi file JSON (characters/*.json, roles/*.json).
 */
export interface ReasoningEffortSource {
  reasoningEffort?: ReasoningEffort;
}

/**
 * Cascata a 4 livelli per decidere il reasoning_effort effettivo di una chiamata
 * (T8.10, TASKS.md): override del chiamante (es. spawn_agent per un sotto-compito
 * meccanico) → personaggio → ruolo → default di `tsuka.config.json`. Il primo
 * livello che specifica un valore vince. Il tratto resta fuori di proposito:
 * descrive il tono della risposta, non la profondità del ragionamento — i due assi
 * sono indipendenti.
 */
// Parametri tipizzati `object` (non ReasoningEffortSource): TypeScript considera
// ReasoningEffortSource un "weak type" (tutte proprietà opzionali) e rifiuta con
// TS2559 l'assegnazione diretta di un CharacterConfig/RoleConfig reale (nessuna
// proprietà in comune per nome, non avendo ancora `reasoningEffort` nel loro tipo
// dichiarato in src/cli/shared.ts, VIETATO da toccare in questo task — il campo
// esiste comunque a runtime nei file JSON, vedi characters/*.json e roles/*.json).
// La lettura resta sicura: `as ReasoningEffortSource` più `?.` non lancia mai se
// il campo manca, si limita a leggere `undefined`.
export function resolveReasoningEffort(
  callerOverride: ReasoningEffort | undefined,
  character: object | null | undefined,
  role: object | null | undefined,
  configDefault: ReasoningEffort | undefined
): ReasoningEffort | undefined {
  return (
    callerOverride ??
    (character as ReasoningEffortSource | undefined)?.reasoningEffort ??
    (role as ReasoningEffortSource | undefined)?.reasoningEffort ??
    configDefault
  );
}

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

  private provider: ILLMProvider;
  private registry: ToolRegistry;
  private permissionManager: PermissionManager;
  private messages: ChatMessage[] = [];
  private allowedTools?: string[];
  private maxHistoryMessages: number;
  private maxHistoryTokens: number;
  // Rapporto caratteri/token usato dalla stima euristica, tarato a runtime (vedi
  // calibrateCharsPerToken): seed 3,5 (valore storico, tarato sull'inglese), corretto
  // verso il rapporto realmente osservato su italiano/codice via l'usage reale dell'API.
  private charsPerToken = 3.5;
  private static readonly RATIO_SMOOTHING = 0.2; // peso della nuova osservazione nella media mobile
  // Etichetta dell'agente (es. aiName del personaggio), passata alle richieste di
  // permesso (T3.1) così che un prompt RESTRICTED/DANGEROUS mostri chi lo chiede
  // quando più agenti sono attivi in parallelo (blocco PARALLELO di /goal).
  private agentLabel?: string;
  // Sforzo di ragionamento risolto per QUESTO agente (T8.10): già il risultato
  // della cascata personaggio → ruolo → default config, calcolato dal chiamante
  // (vedi resolveReasoningEffort) — Agent non conosce character/role, solo l'esito.
  private reasoningEffort?: ReasoningEffort;
  // Caratteri dell'array `tools` inviato all'ultimo round (T8.9, "Ridurre il costo
  // fisso del prompt"): gli schemi dei tool viaggiano nella richiesta API esattamente
  // come i messaggi, ma pruneHistory/estimateMessagesTokens/compressHistory ne erano
  // ciechi — il budget di contesto credeva di avere più spazio di quanto ne avesse
  // davvero. Aggiornato a ogni round da run() (stesso punto in cui i tool vengono
  // calcolati per la chiamata), 0 quando nessun tool viene inviato (allineato a
  // `tools.length > 0 ? tools : undefined` in run(): coerente con ciò che l'API
  // riceve davvero, non con l'array vuoto restituito da listForLLM).
  private toolsChars = 0;

  constructor(
    provider: ILLMProvider,
    registry: ToolRegistry,
    permissionManager: PermissionManager,
    systemPrompt: string,
    allowedTools?: string[],
    maxHistoryMessages: number = 40,
    maxHistoryTokens: number = 65536,
    agentLabel?: string,
    reasoningEffort?: ReasoningEffort
  ) {
    this.provider = provider;
    this.registry = registry;
    this.permissionManager = permissionManager;
    this.allowedTools = allowedTools;
    this.maxHistoryMessages = Math.max(4, maxHistoryMessages);
    this.maxHistoryTokens = Math.max(0, maxHistoryTokens);
    this.agentLabel = agentLabel;
    this.reasoningEffort = reasoningEffort;
    this.clearHistory(systemPrompt);
  }

  /** Sforzo di ragionamento risolto per questo agente (diagnostica/test). */
  getReasoningEffort(): ReasoningEffort | undefined {
    return this.reasoningEffort;
  }

  /** Conta i caratteri "grezzi" di un messaggio (content + tool_calls serializzati). */
  private static messageChars(m: Pick<ChatMessage, 'content' | 'tool_calls'>): number {
    let chars = typeof m.content === 'string' ? m.content.length : 0;
    if (m.tool_calls) {
      try { chars += JSON.stringify(m.tool_calls).length; } catch {}
    }
    return chars;
  }

  /**
   * Stima i token di un messaggio usando il rapporto caratteri/token corrente
   * (tarato a runtime, vedi calibrateCharsPerToken), inclusi gli eventuali
   * tool_calls serializzati che viaggiano nel contesto insieme al content.
   */
  private estimateTokens(m: Pick<ChatMessage, 'content' | 'tool_calls'>): number {
    return Math.ceil(Agent.messageChars(m) / this.charsPerToken);
  }

  /**
   * Aggiorna il rapporto caratteri/token con un'osservazione reale: chiamata dopo
   * ogni risposta dell'LLM per cui l'API ha restituito promptTokens > 0 (usage reale,
   * non stimato). Media mobile invece di sostituzione secca: un singolo turno anomalo
   * (es. prompt quasi vuoto) non deve far divergere la stima per i turni successivi.
   * Include i caratteri degli schemi tool (T8.9): promptTokens dell'API conta anche
   * l'array `tools` inviato nella stessa richiesta, quindi il denominatore dei
   * caratteri deve farlo altrettanto, o la calibrazione convergerebbe a un rapporto
   * caratteri/token falsato.
   */
  private calibrateCharsPerToken(sentMessages: Array<Pick<ChatMessage, 'content' | 'tool_calls'>>, promptTokens?: number): void {
    if (!promptTokens || promptTokens <= 0) return;
    const chars = sentMessages.reduce((sum, m) => sum + Agent.messageChars(m), 0) + this.toolsChars;
    const observed = chars / promptTokens;
    if (!Number.isFinite(observed) || observed <= 0) return;
    this.charsPerToken = this.charsPerToken * (1 - Agent.RATIO_SMOOTHING) + observed * Agent.RATIO_SMOOTHING;
  }

  /**
   * Registra la dimensione (in caratteri) dell'array `tools` che sta per essere
   * inviato all'API (T8.9): chiamato da run() a ogni round, con lo stesso valore
   * che verrà davvero passato a chatWithTools (`undefined` quando non ci sono tool
   * → 0 caratteri, non "[]", per restare coerenti con ciò che l'API riceve).
   */
  private updateToolsSize(toolsForRequest: unknown[] | undefined): void {
    if (!toolsForRequest || toolsForRequest.length === 0) {
      this.toolsChars = 0;
      return;
    }
    try {
      this.toolsChars = JSON.stringify(toolsForRequest).length;
    } catch {
      this.toolsChars = 0;
    }
  }

  /**
   * Stima i token occupati dagli schemi tool dell'ultimo round (T8.9), con lo
   * stesso rapporto caratteri/token corrente usato per i messaggi.
   */
  private estimateToolsTokens(): number {
    return this.toolsChars > 0 ? Math.ceil(this.toolsChars / this.charsPerToken) : 0;
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
   * Cambia la skill (ruolo) ed i tool ammessi dell'agente a caldo,
   * aggiornando il system prompt ed il filtro dei tool senza cancellare la cronologia.
   */
  setActiveSkill(systemPrompt: string, allowedTools?: string[]): void {
    this.allowedTools = allowedTools;
    if (this.messages.length > 0 && this.messages[0].role === 'system') {
      this.messages[0].content = systemPrompt;
    } else {
      this.messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
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
      // T8.9: gli schemi tool viaggiano nella stessa richiesta dei messaggi — un
      // baseline fisso non prunabile (non fa parte del while sotto: potare i
      // messaggi non riduce i tool), ma va contato nel budget o le soglie
      // ragionano su un contesto più piccolo di quello davvero inviato.
      let total = this.estimateToolsTokens() + this.estimateTokens(this.messages[0]);
      for (let i = start; i < this.messages.length; i++) {
        total += this.estimateTokens(this.messages[i]);
      }
      while (total > this.maxHistoryTokens && start < this.messages.length - 3) {
        total -= this.estimateTokens(this.messages[start]);
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
   * Stima i token di un array completo di messaggi, con il rapporto caratteri/token
   * corrente (tarato a runtime). Pubblico: usato anche fuori da questa classe per
   * mostrare stime di contesto coerenti con la calibrazione di questo agente.
   */
  estimateMessagesTokens(msgs: Array<Pick<ChatMessage, 'content' | 'tool_calls'>>): number {
    const chars = msgs.reduce((sum, m) => sum + Agent.messageChars(m), 0);
    return Math.ceil(chars / this.charsPerToken);
  }

  /** Rapporto caratteri/token correntemente tarato (per diagnostica/test). */
  getCharsPerTokenRatio(): number {
    return this.charsPerToken;
  }

  /**
   * Stima di contesto TOTALE (T8.9): messaggi correnti + schemi tool dell'ultimo
   * round, con il rapporto caratteri/token corrente. A differenza di
   * `estimateMessagesTokens` (che ragiona solo sui messaggi passati, riusata anche
   * per sotto-insiemi come "quanto pesa il blocco da comprimere"), questa è la
   * stima pensata per essere confrontata col `promptTokens` reale dell'ultima
   * risposta API: entrambe includono i tool, quindi convergono con la calibrazione
   * di `calibrateCharsPerToken` invece di sottostimare sistematicamente.
   */
  estimateTotalContextTokens(): number {
    return this.estimateMessagesTokens(this.messages) + this.estimateToolsTokens();
  }

  /**
   * Compressione automatica della cronologia quando il contesto supera la soglia.
   * Sostituisce i messaggi più vecchi (mantenendo system + ultimi 4) con un
   * riassunto generato dall'LLM. Salva i dettagli in MemoryStore per recall_memory.
   *
   * @param threshold Soglia di attivazione (default 0.75 = 75% di maxHistoryTokens)
   * @returns Token risparmiati e numero messaggi compressi
   */
  async compressHistory(threshold: number = 0.75): Promise<{ saved: number; compressedCount: number }> {
    if (this.maxHistoryTokens <= 0 || this.messages.length < 6) return { saved: 0, compressedCount: 0 };

    // T8.9: stesso baseline tool contato da pruneHistory, sommato alla stima dei
    // messaggi — altrimenti la soglia di attivazione (threshold) scatta più tardi
    // di quanto dovrebbe rispetto al contesto realmente inviato all'API.
    const total = this.estimateTotalContextTokens();
    if (total < this.maxHistoryTokens * threshold) return { saved: 0, compressedCount: 0 };

    // Trova quanti messaggi comprimere: da [1] a [N], mantenendo system + ultimi 4
    const keepRecent = 4;
    const maxCompressEnd = this.messages.length - keepRecent - 1;
    if (maxCompressEnd < 1) return { saved: 0, compressedCount: 0 };

    // Non rompere coppie tool_call/tool
    let compressEnd = maxCompressEnd;
    while (compressEnd > 0 && this.messages[compressEnd]?.role === 'tool') {
      compressEnd--;
    }
    if (compressEnd < 1) return { saved: 0, compressedCount: 0 };

    const toCompress = this.messages.slice(1, compressEnd + 1);
    const compressTok = this.estimateMessagesTokens(toCompress);
    // Chiamata LLM costa ~1k tok (prompt + risposta): comprimi solo se risparmio > 3x
    if (compressTok < 3000) return { saved: 0, compressedCount: 0 };

    // Costruisce testo da riassumere
    const summaryInput = toCompress
      .filter((m) => m.role !== 'tool' && m.content)
      .map((m) => {
        const label = m.role === 'user' ? 'Utente' : 'Assistente';
        const content = (m.content || '').slice(0, 600);
        return `${label}: ${content}`;
      })
      .join('\n\n');

    let summary = '';
    try {
      const response = await this.provider.chatWithTools(
        [
          { role: 'system', content: 'You summarize technical conversations concisely and objectively in 3-5 sentences: key points, decisions, files created, results. Max 200 words.' },
          { role: 'user', content: `Summarize this conversation:\n\n${summaryInput}` }
        ],
        undefined,
        undefined,
        undefined,
        this.reasoningEffort ? { reasoningEffort: this.reasoningEffort } : undefined
      );
      summary = response.content?.trim() || '';
    } catch {
      // Fallback: tronca i contenuti più rilevanti
      summary = toCompress
        .filter((m) => m.role === 'assistant' && m.content)
        .map((m) => (m.content || '').slice(0, 300))
        .join('\n')
        .slice(0, 1500);
    }

    if (summary) {
      MemoryStore.getInstance().addFact(
        `[Storia compressa] ${summary.replace(/\s+/g, ' ').slice(0, 500)}`,
        'system',
        { kind: 'run' }
      );
    }

    const summaryMsg = {
      role: 'user' as const,
      content: `[Storia precedente compressa]: ${summary.slice(0, 2000)}`
    };

    this.messages = [
      this.messages[0],
      summaryMsg,
      ...this.messages.slice(compressEnd + 1)
    ];

    const afterTotal = this.estimateTotalContextTokens();
    const saved = total - afterTotal;
    const savedStr = saved >= 1000 ? `${(saved / 1000).toFixed(1)}k` : `${saved}`;
    console.log(chalk.gray(`[Compressione automatica: compressi ${toCompress.length} messaggi, risparmiati ~${savedStr} tok (ora ~${Math.round(afterTotal / 1000)}k)]`));

    return { saved, compressedCount: toCompress.length };
  }

  /**
   * Avvia il ciclo agentico per elaborare un messaggio utente.
   */
  async run(
    userMessage: string,
    onChunk?: (chunk: string, channel?: StreamChannel) => void,
    onStats?: (stats: { durationMs: number; tokenCount: number; tokensPerSecond: number; promptTokens: number; totalTokens: number }) => void,
    onEvent?: AgentEventHandler,
    signal?: AbortSignal,
    // Override del chiamante (T8.10, primo livello della cascata): es. spawn_agent
    // che sa già che il sotto-compito è meccanico. Vince su quanto risolto in
    // costruzione (this.reasoningEffort), solo per questa singola run().
    reasoningEffortOverride?: ReasoningEffort
  ): Promise<string> {
    const emit = onEvent ?? plainEventRenderer;
    this.messages.push({ role: 'user', content: userMessage });
    const effectiveEffort = reasoningEffortOverride ?? this.reasoningEffort;
    const chatOptions: ChatOptions | undefined = effectiveEffort ? { reasoningEffort: effectiveEffort } : undefined;

    let isDone = false;
    let finalAnswer = '';
    let toolRounds = 0;
    // Stats cumulative attraverso tutti i round LLM (tool loop)
    let cumStats = { durationMs: 0, tokenCount: 0, promptTokens: 0, totalTokens: 0 };

    while (!isDone) {
      // Interruzione utente arrivata tra un round e l'altro (es. durante i tool):
      // esce subito senza aspettare che sia la prossima chiamata API a fallire
      if (signal?.aborted) break;

      // T8.12: propaga l'effort già risolto (effectiveEffort, calcolato sopra) fino al
      // tier dei tool — senza questo passaggio getModelTier ricadeva sempre sul default
      // prudente 'xhigh' di getModelProfile, e un profilo misurato a un altro livello
      // (es. 'medium') non veniva mai usato per decidere quali tool mostrare al modello.
      const tools = this.registry.listForLLM(this.provider.getCurrentModel(), this.allowedTools, effectiveEffort);
      const toolsForRequest = tools.length > 0 ? tools : undefined;

      // T8.9: registra la dimensione degli schemi PRIMA di potare la history, così
      // pruneHistory ragiona sul budget realmente occupato (messaggi + tool) invece
      // di un punto cieco di ~2-3k token.
      this.updateToolsSize(toolsForRequest);

      // Mantiene il contesto entro la finestra configurata prima di ogni chiamata API
      this.pruneHistory();

      try {
        // Richiesta all'LLM (invia messaggi storici e l'elenco dei tool disponibili)
        const response = await this.provider.chatWithTools(
          this.messages,
          toolsForRequest,
          onChunk,
          signal,
          chatOptions
        );

        const { content, toolCalls, stats } = response;

        // Taratura del rapporto caratteri/token: this.messages è ancora esattamente
        // il prompt appena inviato (il push del turno corrente avviene sotto), quindi
        // è il denominatore corretto per calibrare su promptTokens reale dell'API.
        this.calibrateCharsPerToken(this.messages, (stats as any)?.promptTokens);

        // Aggiunge la risposta dell'assistente alla storia locale
        const assistantMessage: ChatMessage = { role: 'assistant', content: content || null };
        if (toolCalls && toolCalls.length > 0) {
          assistantMessage.tool_calls = toolCalls;
        }
        this.messages.push(assistantMessage);

        if (content) {
          finalAnswer = content;
        }

        // Invia i dati statistici della generazione se disponibili
        if (stats && onStats) {
          cumStats.durationMs += stats.durationMs;
          cumStats.tokenCount += stats.tokenCount;
          // promptTokens = dimensione contesto di input: prendi il max (ultimo round è il più grande)
          cumStats.promptTokens = Math.max(cumStats.promptTokens, (stats as any).promptTokens ?? 0);
          cumStats.totalTokens = Math.max(cumStats.totalTokens, (stats as any).totalTokens ?? 0);
          const tps = cumStats.durationMs > 0
            ? parseFloat((cumStats.tokenCount / (cumStats.durationMs / 1000)).toFixed(1))
            : 0;
          onStats({
            durationMs: cumStats.durationMs,
            tokenCount: cumStats.tokenCount,
            tokensPerSecond: tps,
            promptTokens: cumStats.promptTokens,
            totalTokens: cumStats.totalTokens
          });
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

          // Interruzione utente: i tool rimanenti non vengono eseguiti, ma ogni
          // tool_call riceve comunque la sua risposta 'tool' (cronologia coerente:
          // un tool_call orfano farebbe rifiutare la successiva chiamata API)
          if (signal?.aborted) {
            this.messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: '[Esecuzione annullata: generazione interrotta dall\'utente]'
            });
            continue;
          }

          emit({ type: 'tool_start', name: toolName, args: toolArgs });

          // Esecuzione del tool con verifica dei permessi integrata
          const result = await this.registry.executeTool(toolName, toolArgs, this.permissionManager, this.provider, this.agentLabel);

          // Aggiunge l'output del tool alla cronologia dei messaggi
          this.messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: result.output
          });

          emit({ type: 'tool_end', name: toolName, args: toolArgs, success: result.success, output: result.output });
        }

        // Dopo i tool: se nel frattempo è arrivata l'interruzione, stop pulito
        if (signal?.aborted) break;

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
