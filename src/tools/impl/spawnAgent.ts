import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Tool, ToolExecutionContext } from '../registry';
import { loadSystemPrompt, resolveCharacter, loadRole, loadTrait } from '../../cli/shared';
import { Agent } from '../../core/agent';
import { ReasoningEffort } from '../../core/provider';
import { ConfigManager } from '../../core/config';
import { PermissionManager } from '../../safety/permissions';
import { Blackboard } from '../../core/blackboard';
import { homePath } from '../../core/apphome';
import { withEffortPin, logEffortDivergence } from '../../core/effortControl';
import { resolveSafePath } from './utils';

// Limite del briefing passato al sub-agente (T8.7): NON va alzato — è la finestra
// di contesto del modello locale a non reggere briefing più lunghi. Il limite
// resta un vincolo tenuto; solo il messaggio d'errore cambia (vedi sotto).
const MAX_TASK_LENGTH = 2000;
// Limite del briefing letto da 'briefingFile' (T9.8): più permissivo di
// MAX_TASK_LENGTH perché qui il testo arriva da disco, non da un argomento JSON
// che il modello chiamante deve generare e chiudere correttamente — il fallimento
// che MAX_TASK_LENGTH previene (JSON malformato/troncato su stringhe lunghe,
// osservato in produzione con modelli locali via llama-server) non si applica: il
// tool legge il file, il modello passa solo un percorso breve. Il tetto resta
// comunque finito perché il testo finisce per intero nel system prompt del
// sub-agente, quindi pesa sulla SUA finestra di contesto.
const MAX_BRIEFING_FILE_LENGTH = 12000;
// Limite del valore ritornato al padre (T8.5): sintesi breve + percorso, non il
// resoconto integrale (che finisce su file, vedi sotto).
const MAX_RETURN_LENGTH = 3000;

// T8.13: livelli validi per l'override di effort del sub-agente, stesso enum di
// ReasoningEffort (provider.ts) — validato qui a mano perché gli argomenti del
// tool arrivano come JSON non tipizzato dall'LLM chiamante.
const VALID_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'xhigh'];

export const spawnAgentTool: Tool = {
  name: 'spawn_agent',
  riskLevel: 'SAFE',
  execute: async (args: { task?: string; briefingFile?: string; roleName?: string; traitName?: string; charName?: string; reasoningEffort?: string }, context?: ToolExecutionContext) => {
    const inlineTask = (args.task || '').trim();
    const briefingFileArg = (args.briefingFile || '').trim();

    // T9.8: un briefing lungo letto da FILE, non incollato inline nell'argomento
    // JSON — il chiamante scrive il testo con 'write_file' e passa qui solo il
    // percorso (stringa breve, banale da chiudere correttamente in JSON). Evita
    // alla radice il fallimento osservato in produzione: un modello locale che
    // genera una stringa JSON lunga e dettagliata per 'task' rompe il parsing
    // (JSON troncato/non chiuso) lato harness o lato server — un percorso non ha
    // questo problema. 'task', se presente insieme a briefingFile, resta come
    // introduzione breve davanti al contenuto del file.
    let task: string;
    if (briefingFileArg) {
      const fullPath = resolveSafePath(briefingFileArg);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Il file di briefing '${briefingFileArg}' non esiste. Scrivilo prima con 'write_file'.`);
      }
      if (fs.statSync(fullPath).isDirectory()) {
        throw new Error(`Il percorso '${briefingFileArg}' è una directory, non un file di briefing.`);
      }
      let briefingContent = fs.readFileSync(fullPath, 'utf-8').trim();
      if (!briefingContent) {
        throw new Error(`Il file di briefing '${briefingFileArg}' è vuoto.`);
      }
      if (briefingContent.length > MAX_BRIEFING_FILE_LENGTH) {
        throw new Error(
          `Il file di briefing '${briefingFileArg}' è troppo lungo: ${briefingContent.length} caratteri ` +
          `(limite ${MAX_BRIEFING_FILE_LENGTH}). Il testo intero finisce nel prompt del sub-agente: se non basta, ` +
          `è più di un compito — dividilo in più chiamate a 'spawn_agent', ciascuna con il proprio briefing autosufficiente.`
        );
      }
      task = inlineTask ? `${inlineTask}\n\n${briefingContent}` : briefingContent;
    } else {
      task = inlineTask;
      if (!task) throw new Error("Specificare un compito per il sub-agente ('task', oppure 'briefingFile' per un briefing lungo).");
      if (task.length > MAX_TASK_LENGTH) {
        // T8.7: la lunghezza è il sintomo, non il problema — un briefing che non sta
        // in 2000 caratteri non è un compito, sono più compiti. L'errore prescrive
        // la riparazione corretta e vieta esplicitamente quella sbagliata
        // (accorciare = buttare requisiti in silenzio, il sub-agente lavorerebbe
        // comunque, ma sul compito sbagliato, senza che nessuno se ne accorga).
        throw new Error(
          `Compito troppo lungo: ${task.length} caratteri (limite ${MAX_TASK_LENGTH}). ` +
          `NON accorciarlo per farlo stare nel limite: significa eliminare requisiti in silenzio. ` +
          `Due uscite legittime: ` +
          `(a) se il compito è in realtà più compiti, dividilo in più chiamate a 'spawn_agent', una per compito, ciascuna autosufficiente; ` +
          `(b) se è davvero un compito unitario, scrivi il briefing completo con 'write_file' e passalo qui con 'briefingFile' (percorso del file), non incollato in 'task'.`
        );
      }
    }

    // T8.13: override di effort per il singolo sub-agente — livello "chiamante"
    // della cascata a quattro livelli (già in resolveReasoningEffort, agent.ts),
    // oggi raggiungibile solo internamente. Validato qui: un valore fuori enum
    // arrivato dall'LLM chiamante va segnalato subito, non propagato silenzioso.
    let reasoningEffortOverride: ReasoningEffort | undefined;
    if (args.reasoningEffort !== undefined && args.reasoningEffort !== '') {
      const candidate = String(args.reasoningEffort).trim().toLowerCase();
      if (!VALID_REASONING_EFFORTS.includes(candidate as ReasoningEffort)) {
        throw new Error(
          `reasoningEffort non valido: '${args.reasoningEffort}'. Valori ammessi: ${VALID_REASONING_EFFORTS.join(', ')}.`
        );
      }
      reasoningEffortOverride = candidate as ReasoningEffort;
    }

    const provider = context?.provider;
    if (!provider) throw new Error('Provider non disponibile nel contesto.');
    const registry = context?.registry;
    if (!registry) throw new Error('Registry non disponibile nel contesto.');
    const permissionManager = context?.permissionManager ?? new PermissionManager();

    // Risolve personaggio, ruolo e tratto
    const charName = (args.charName || '').trim().toLowerCase();
    const char = charName ? resolveCharacter(charName) : null;
    let roleName = (args.roleName || '').trim().toLowerCase() || 'developer';
    let traitName = (args.traitName || '').trim().toLowerCase() || 'professional';
    if (char) { roleName = char.role || char.activeRole || 'developer'; traitName = char.trait; }

    const roleObj = loadRole(roleName);
    const traitObj = loadTrait(traitName);
    const configManager = new ConfigManager();
    const label = char?.aiName || roleName;

    // T8.1: quando esiste un run attivo (/team o /goal in corso), il sub-agente
    // gira nel contesto async del padre (stesso meccanismo di withWorkspaceOverride/
    // logBuffer): Blackboard.current() risolve già al run corrente senza bisogno di
    // propagarlo esplicitamente. Gli si aggiungono i tool di lavagna con lo stesso
    // criterio già usato in strategies/common.ts per i tool di protocollo di T2.1 —
    // qui, non nei JSON di roles/. Fuori da un run attivo: comportamento identico a
    // oggi, nessun tool aggiuntivo.
    const blackboard = Blackboard.current();
    const subAllowedTools = blackboard
      ? [...(roleObj.allowedTools || []), 'post_note', 'read_notes']
      : roleObj.allowedTools;

    // T8.14: il pin globale vince anche sull'override esplicito del chiamante
    // (l'argomento reasoningEffort qui sopra) — è il livello più alto della
    // cascata finale. Nessun pin attivo → comportamento identico a T8.13.
    // Log-only per vincolo esplicito del task: i figli di spawn_agent non
    // chiedono MAI conferma, a prescindere dalla modalità ask globale.
    const effectiveOverride = withEffortPin(reasoningEffortOverride);
    logEffortDivergence(label, effectiveOverride, configManager.getDefaultReasoningEffort());

    let sysPrompt = loadSystemPrompt(roleObj, traitObj, provider.getCurrentModel?.() || 'default', registry, char, task, effectiveOverride) +
      `\n\nQuesto è un compito subordinato. Completalo e riporta il risultato in modo conciso. Al termine scrivi solo il resoconto di ciò che hai fatto.`;

    if (blackboard) {
      sysPrompt += `\n\nLAVAGNA DEL RUN: questo compito fa parte di un run più ampio (/team o /goal), con una lavagna condivisa separata dalla cronologia. Prima di iniziare, usa 'read_notes' per leggere decisioni, artefatti o punti aperti lasciati da chi ti ha preceduto in QUESTO run; usa 'post_note' per lasciare i tuoi prima di finire.`;
    }

    const subAgent = new Agent(
      provider, registry, permissionManager, sysPrompt, subAllowedTools,
      configManager.getMaxHistoryMessages(), configManager.getMaxHistoryTokens(),
      label
    );

    const result = await subAgent.run(
      `Esegui questo compito: ${task}`,
      undefined, undefined, undefined, undefined,
      // T8.13: override per QUESTA run — vince sulla cascata personaggio/ruolo del
      // sub-agente quando il padre lo specifica esplicitamente; undefined lascia
      // la cascata invariata (comportamento identico a prima del task).
      effectiveOverride
    );

    const fullReport = result || '[nessuna risposta]';

    // T8.5: il resoconto integrale va su un file di run, non solo in un messaggio
    // della history del padre — che una potatura (pruneHistory/compressHistory) può
    // cancellare senza lasciare traccia da nessuna parte. Il ritorno al padre resta
    // breve (sintesi + percorso): il percorso è la parte che conta, perché resta
    // leggibile con read_file anche dopo che il messaggio originale è stato tagliato.
    // Chiave della cartella: il runId della blackboard quando esiste (così più
    // sub-agenti dello stesso run/goal condividono runs/<runId>/ e si trovano da
    // soli via la nota sulla lavagna), altrimenti un id ad hoc solo per organizzare
    // il file — nessun run attivo non deve impedire l'artefatto.
    const runKey = blackboard?.runId || crypto.randomUUID();
    const runDir = homePath('runs', runKey);
    fs.mkdirSync(runDir, { recursive: true });
    const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase() || 'subagente';
    const fileName = `${safeLabel}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.md`;
    const filePath = path.join(runDir, fileName);
    fs.writeFileSync(filePath, fullReport, 'utf-8');
    // Percorso relativo alla app home (stesso riferimento usato per gli altri
    // artefatti su disco): leggibile dal padre con read_file quando la sua
    // workspace root coincide con la app home (caso comune a singolo progetto).
    const relPath = path.join('runs', runKey, fileName);

    if (blackboard) {
      blackboard.post('artefatto-sub-agente', relPath, label);
    }

    const shortSummary = fullReport.length > 400 ? fullReport.slice(0, 400) + '…' : fullReport;
    const output = `[SUB-AGENTE: ${label}] Resoconto completo salvato in '${relPath}' (${fullReport.length} caratteri, leggibile con read_file). Sintesi:\n${shortSummary}`;
    return output.length > MAX_RETURN_LENGTH ? output.slice(0, MAX_RETURN_LENGTH) : output;
  }
};
