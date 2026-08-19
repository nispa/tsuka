/**
 * Test per T8.14 — Controllo globale dell'effort: comando /effort (TASKS.md — FASE 3).
 * Copre l'Accettazione del task:
 *  - con un pin attivo, un personaggio con reasoningEffort diverso gira al
 *    livello del pin (sia in chat/team che nei figli di spawn_agent, dove il
 *    pin vince anche sull'override esplicito del chiamante);
 *  - /effort (bare) dichiara il livello attivo con la provenienza corretta
 *    (pin, personaggio, ruolo o default);
 *  - /effort auto rimuove il pin e ripristina esattamente il comportamento
 *    precedente (stessa cascata di T8.10, non riscritta);
 *  - un pin che cambia il tier dei tool produce un messaggio che nomina la
 *    differenza (quanti e quali tool compaiono/spariscono) — l'effetto
 *    collaterale meno intuibile del comando (T8.12);
 *  - in modalità ask, un turno di /team NON apre alcun prompt interattivo e
 *    scrive invece una riga di log (vincolo esplicito: ask è attiva SOLO
 *    nella chat interattiva; /team, /goal e i figli di spawn_agent degradano
 *    sempre, a prescindere dalla modalità ask globale);
 *  - il pin vive in memoria di processo: non compare in tsuka.config.json e
 *    non sopravvive a un nuovo processo.
 *
 * Isolamento: models_profile.json (repo reale) è usato con backup/restore,
 * stesso pattern di test_reasoning_effort.ts/test_effort_propagation.ts. Il
 * solo scenario che scrive su disco nella home reale è la sezione spawn_agent
 * (runs/<uuid>/*.md, come da comportamento normale del tool T8.5): il file/
 * cartella generati vengono cancellati a fine sezione, in un finally.
 * tsuka.config.json reale è letto MAI scritto in questo file (nessuna
 * ConfigManager.set* viene mai chiamata: per le sezioni che hanno bisogno di
 * un personaggio/ruolo/default arbitrario si costruisce un ConfigManager
 * finto in memoria, non l'istanza reale).
 *
 * Esecuzione isolata: node --import tsx tests/test_effort_command.ts
 * (imposta TSUKA_MEMORY_FILE a un file temporaneo prima di lanciarlo da solo).
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import { Agent, resolveReasoningEffort } from '../src/core/agent';
import { ToolRegistry, getModelTier } from '../src/tools/registry';
import { PermissionManager } from '../src/safety/permissions';
import { ConfigManager } from '../src/core/config';
import { ReasoningEffort } from '../src/core/provider';
import {
  getEffortPin, setEffortPin, isAskModeEnabled, setAskMode, resetEffortControlForTest,
  withEffortPin, describeEffortSource, getReferenceEffort, describeToolDiff,
  logEffortDivergence, confirmEffortDivergence
} from '../src/core/effortControl';
import {
  loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt,
  listAvailableCharacters, listAvailableItems
} from '../src/cli/shared';
import { CommandCtx } from '../src/cli/commands/types';
import { handleEffort } from '../src/cli/commands/effort';
import { runRoundRobin } from '../src/cli/commands/team';
import { GenerationInterrupt } from '../src/cli/interrupt';
import { InteractiveMenu } from '../src/cli/ui';
import { MockLLMProvider, mockToolCall } from './mocks/mockProvider';
import { buildMockCtx } from './mocks/mockCtx';
import { spawnAgentTool } from '../src/tools/impl/spawnAgent';
import {
  getModelProfile, profileKey, BENCHMARK_VERSION, ModelProfile
} from '../src/core/modelProfile';
import { getBenchmarkTestsHash } from '../src/core/benchmarkTests';
import { homePath } from '../src/core/apphome';
import { agentWithRole, aiNameOf } from './fixtures/roster';


// Agente risolto per mestiere: la cascata dell'effort si verifica sul RUOLO.
const DEV = agentWithRole('developer');
const DEV_AI = aiNameOf(DEV);


let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

/** Cattura le righe stampate con console.log durante l'esecuzione di fn (stesso pattern di test_team_modes.ts). */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };
  try {
    const result = await fn();
    return { result, logs };
  } finally {
    console.log = original;
  }
}

/** ConfigManager finto (nessuna scrittura su disco, mai la classe reale): solo i metodi che handleEffort/recreateAgent usano davvero. */
function fakeConfigManager(opts: {
  activeCharacter?: string;
  activeRole?: string;
  activeTrait?: string;
  defaultEffort?: ReasoningEffort;
}): ConfigManager {
  return {
    getActiveCharacter: () => opts.activeCharacter ?? 'custom',
    getActiveRole: () => opts.activeRole ?? 'developer',
    getActiveTrait: () => opts.activeTrait ?? 'professional',
    getDefaultReasoningEffort: () => opts.defaultEffort,
    getMaxHistoryMessages: () => 40,
    getMaxHistoryTokens: () => 65536,
  } as unknown as ConfigManager;
}

/** Stessa logica di recreateAgent in cli/index.ts (T8.10 + T8.14: cascata + pin). */
function makeRecreateAgent(provider: MockLLMProvider, registry: ToolRegistry, permissionManager: PermissionManager, configManager: ConfigManager) {
  return (): Agent => {
    const charName = configManager.getActiveCharacter();
    const char = loadCharacter(charName);
    const roleName = char ? char.role : configManager.getActiveRole();
    const traitName = char ? char.trait : configManager.getActiveTrait();
    const role = loadRole(roleName);
    const trait = loadTrait(traitName);
    const model = provider.getCurrentModel();
    const cascaded = resolveReasoningEffort(undefined, char, role, configManager.getDefaultReasoningEffort());
    const reasoningEffort = withEffortPin(cascaded);
    return new Agent(
      provider, registry, permissionManager,
      loadSystemPrompt(role, trait, model, registry, char),
      role.allowedTools, configManager.getMaxHistoryMessages(), configManager.getMaxHistoryTokens(),
      undefined, reasoningEffort
    );
  };
}

function buildEffortCtx(provider: MockLLMProvider, registry: ToolRegistry, configManager: ConfigManager): CommandCtx {
  const permissionManager = new PermissionManager();
  const recreateAgent = makeRecreateAgent(provider, registry, permissionManager, configManager);
  return {
    configManager, provider, registry, permissionManager,
    agent: { current: recreateAgent() },
    availableModels: { current: [] },
    recreateAgent,
    loadRole, loadTrait, loadCharacter, loadTeam,
    listAvailableCharacters, listAvailableItems
  };
}

async function main() {
  console.log('=== Test /effort — controllo globale dell\'effort (T8.14) ===\n');

  // ── A. Pin/ask mode: stato di base ──────────────────────────────────────
  {
    resetEffortControlForTest();
    check('A.1a', getEffortPin() === undefined, 'nessun pin all\'avvio (stato pulito)');
    check('A.1b', isAskModeEnabled() === false, 'ask mode spenta all\'avvio');

    setEffortPin('low');
    check('A.2a', getEffortPin() === 'low', 'setEffortPin fissa il pin');
    setEffortPin(undefined);
    check('A.2b', getEffortPin() === undefined, 'setEffortPin(undefined) rimuove il pin ("auto")');

    setAskMode(true);
    check('A.3a', isAskModeEnabled() === true, 'setAskMode(true) attiva la modalità ask');
    setAskMode(false);
    check('A.3b', isAskModeEnabled() === false, 'setAskMode(false) la disattiva');
    resetEffortControlForTest();
  }

  // ── B. withEffortPin: il pin si aggiunge SOPRA la cascata di T8.10, senza riscriverla ──
  {
    resetEffortControlForTest();
    // Stessa cascata di RE.1b in test_reasoning_effort.ts: personaggio vince su ruolo/default.
    const cascaded = resolveReasoningEffort(undefined, { reasoningEffort: 'xhigh' }, { reasoningEffort: 'medium' }, 'low');
    check('B.1a', cascaded === 'xhigh', 'la cascata di T8.10 resta invariata (non toccata da questo task)');
    check('B.1b', withEffortPin(cascaded) === 'xhigh', 'senza pin, withEffortPin lascia invariato il risultato della cascata');

    setEffortPin('none');
    check('B.2a', withEffortPin(cascaded) === 'none',
      "Accettazione: con un pin attivo, un personaggio con reasoningEffort diverso ('xhigh') gira al livello del pin ('none')");

    // "/effort auto ripristina ESATTAMENTE il comportamento precedente al pin"
    setEffortPin(undefined);
    check('B.3a', withEffortPin(cascaded) === cascaded,
      'Accettazione: /effort auto (pin=undefined) ripristina esattamente il valore della cascata pre-pin');
    resetEffortControlForTest();
  }

  // ── C. describeEffortSource: provenienza corretta a ogni livello, pin compreso ──
  {
    resetEffortControlForTest();
    const char = { reasoningEffort: 'xhigh' as ReasoningEffort };
    const role = { reasoningEffort: 'medium' as ReasoningEffort };

    check('C.1a', describeEffortSource(char, role, 'low').source === 'personaggio' || describeEffortSource(char, role, 'low').source === 'character', 'senza pin, vince il personaggio (come la cascata)');
    check('C.1b', describeEffortSource(null, role, 'low').source === 'ruolo' || describeEffortSource(null, role, 'low').source === 'role', 'senza personaggio, vince il ruolo');
    check('C.1c', describeEffortSource(null, null, 'low').source === 'default', 'senza personaggio né ruolo, vince il default di configurazione');
    check('C.1d', describeEffortSource(null, null, undefined).source === 'nessuno' || describeEffortSource(null, null, undefined).source === 'none', 'nessun livello specificato in nessun posto → source "nessuno"');

    setEffortPin('xhigh');
    const withPin = describeEffortSource(char, role, 'low');
    check('C.2a', withPin.source === 'pin' && withPin.effort === 'xhigh', 'con un pin attivo, la provenienza dichiarata è "pin" — vince su tutto il resto');
    resetEffortControlForTest();
  }

  // ── D. getReferenceEffort / logEffortDivergence / describeToolDiff ──────
  {
    resetEffortControlForTest();
    check('D.1a', getReferenceEffort('low') === 'low', 'senza pin, il riferimento è il default di configurazione');
    setEffortPin('xhigh');
    check('D.1b', getReferenceEffort('low') === 'xhigh', 'con un pin attivo, il riferimento è il pin, non il default');
    resetEffortControlForTest();

    const { logs: logsNoDiverge } = await captureLogs(async () => {
      logEffortDivergence('Test', 'medium', 'medium');
    });
    check('D.2a', logsNoDiverge.length === 0, 'nessuna riga di log quando effettivo e riferimento coincidono');

    const { logs: logsDiverge } = await captureLogs(async () => {
      logEffortDivergence('Test', 'xhigh', 'low');
    });
    check('D.2b', logsDiverge.length === 1 && /\[Effort\]/.test(logsDiverge[0]) && /Test/.test(logsDiverge[0]),
      `una riga di log quando divergono, con l'etichetta dell'agente (ricevuto: ${JSON.stringify(logsDiverge)})`);

    check('D.3a', describeToolDiff(['a', 'b'], ['a', 'b']) === null, 'nessuna differenza → null');
    const diff = describeToolDiff(['a'], ['a', 'b']);
    check('D.3b', !!diff && /\+1/.test(diff) && /b/.test(diff), `un tool in più viene descritto (ricevuto: ${diff})`);
    const diff2 = describeToolDiff(['a', 'b'], ['a']);
    check('D.3c', !!diff2 && /-1/.test(diff2) && /b/.test(diff2), `un tool in meno viene descritto (ricevuto: ${diff2})`);
  }

  // ── E. confirmEffortDivergence: ask mode SOLO se esplicitamente attiva ──
  {
    resetEffortControlForTest();

    // Nessuna divergenza → confirmFn mai chiamata, nessun log
    let confirmCalls = 0;
    const confirmFn = async () => { confirmCalls++; return true; };
    const { result: r1, logs: l1 } = await captureLogs(() => confirmEffortDivergence('X', 'medium', 'medium', confirmFn));
    check('E.1a', r1 === 'medium' && confirmCalls === 0 && l1.length === 0, 'nessuna divergenza: nessun confirm, nessun log, effort invariato');

    // Divergenza, ask mode SPENTA (default) → log-only, confirmFn mai chiamata
    const { result: r2, logs: l2 } = await captureLogs(() => confirmEffortDivergence('X', 'xhigh', 'low', confirmFn));
    check('E.2a', confirmCalls === 0, 'ask mode spenta: confirmFn non viene MAI chiamata su divergenza');
    check('E.2b', r2 === 'xhigh', 'ask mode spenta: il turno prosegue comunque al livello effettivo (mai bloccato)');
    check('E.2c', l2.length === 1 && /\[Effort\]/.test(l2[0]), 'ask mode spenta: la divergenza produce comunque una riga di log');

    // Divergenza, ask mode ATTIVA, utente accetta
    setAskMode(true);
    const { result: r3, logs: l3 } = await captureLogs(() => confirmEffortDivergence('X', 'xhigh', 'low', async () => { confirmCalls++; return true; }));
    check('E.3a', confirmCalls === 1, 'ask mode attiva + divergenza: confirmFn viene chiamata');
    check('E.3b', r3 === 'xhigh', 'accettato: il turno gira al livello effettivo originale');

    // Divergenza, ask mode ATTIVA, utente rifiuta → ripiega sul riferimento SOLO per questo turno
    const { result: r4, logs: l4 } = await captureLogs(() => confirmEffortDivergence('X', 'xhigh', 'low', async () => false));
    check('E.4a', r4 === 'low', 'rifiutato: il turno usa il riferimento, non l\'effettivo originale');
    check('E.4b', l4.some((line) => /rifiutat|rejected/i.test(line)), 'rifiutato: una riga di log lo segnala');
    check('E.4c', getEffortPin() === undefined, 'un rifiuto in modalità ask NON tocca il pin (vale solo per quel turno)');

    resetEffortControlForTest();
  }

  // ── F. /team (runMemberTurn): ask mode NON apre MAI un prompt, degrada a log ──
  {
    resetEffortControlForTest();

    // Impedisce qualunque prompt interattivo reale: se runMemberTurn (o
    // qualunque funzione sotto ask mode) ne chiamasse anche solo uno, il test
    // fallirebbe con un errore invece di restare silenziosamente bloccato su
    // stdin — prova diretta del vincolo "MAI un blocco in /team".
    const originalSelect = InteractiveMenu.select;
    (InteractiveMenu as any).select = async () => {
      throw new Error('InteractiveMenu.select NON deve mai essere chiamato da un turno di /team, nemmeno in modalità ask');
    };

    try {
      setAskMode(true); // vincolo: deve degradare comunque a log, MAI a un prompt

      const provider = new MockLLMProvider([
        { content: 'Fatto.\nSTATO: COMPLETATO' }
      ]);
      const ctx = buildMockCtx(provider);
      const team = { members: [DEV] }; // developer → reasoningEffort 'medium' (roles/developer.json)
      const interrupt = new GenerationInterrupt();

      const { result, logs } = await captureLogs(() =>
        runRoundRobin(ctx, team, 'compito di prova', 1, interrupt, [
          { role: 'system' as const, content: '' },
          { role: 'user' as const, content: 'COMPITO DI GRUPPO DA RISOLVERE: "compito di prova"' }
        ])
      );

      check('F.1a', result.completed === true, 'il turno di team si completa normalmente (nessun blocco)');
      check('F.1b',
        provider.callLog[0]?.options?.reasoningEffort === 'medium',
        `chi copre 'developer' (@${DEV}) gira davvero a 'medium' (ricevuto: ${JSON.stringify(provider.callLog[0]?.options)})`
      );
      // Config reale di questo repo non ha "reasoningEffort" (verificato in
      // tsuka.config.json): il default è quindi undefined, quindi 'medium'
      // diverge dal riferimento → una riga di log deve comparire.
      check('F.1c',
        logs.some((l) => /\[Effort\]/.test(l) && new RegExp(DEV_AI, 'i').test(l)),
        `ask mode attiva ma contesto /team: la divergenza produce una riga di log, non un prompt (righe: ${JSON.stringify(logs)})`
      );
    } finally {
      (InteractiveMenu as any).select = originalSelect;
      setAskMode(false);
    }
  }

  // ── F2. /team con un pin attivo: il pin vince sul personaggio, e NON produce
  //        più una riga di divergenza (perché il riferimento diventa il pin stesso) ──
  {
    resetEffortControlForTest();
    setEffortPin('low');
    try {
      const provider = new MockLLMProvider([
        { content: 'Fatto.\nSTATO: COMPLETATO' }
      ]);
      const ctx = buildMockCtx(provider);
      const team = { members: [DEV] };
      const interrupt = new GenerationInterrupt();

      const { logs } = await captureLogs(() =>
        runRoundRobin(ctx, team, 'compito di prova 2', 1, interrupt, [
          { role: 'system' as const, content: '' },
          { role: 'user' as const, content: 'COMPITO DI GRUPPO DA RISOLVERE: "compito di prova 2"' }
        ])
      );

      check('F2.1a',
        provider.callLog[0]?.options?.reasoningEffort === 'low',
        `Accettazione: il pin ('low') vince sul personaggio/ruolo ('medium') anche in un turno di /team (ricevuto: ${JSON.stringify(provider.callLog[0]?.options)})`
      );
      check('F2.1b',
        !logs.some((l) => /\[Effort\]/.test(l)),
        'col pin attivo il riferimento È il pin: nessuna divergenza da segnalare (nessuna riga [Effort])'
      );
    } finally {
      resetEffortControlForTest();
    }
  }

  // ── G. spawn_agent: il pin vince anche sull'override esplicito del chiamante ──
  {
    resetEffortControlForTest();
    const createdRunDirs: string[] = [];
    const originalSelect = InteractiveMenu.select;
    (InteractiveMenu as any).select = async () => {
      throw new Error('InteractiveMenu.select NON deve mai essere chiamato da un figlio di spawn_agent');
    };

    try {
      setAskMode(true); // stesso vincolo di F: mai un prompt, nemmeno qui
      setEffortPin('none');

      const registry = new ToolRegistry();
      const provider = new MockLLMProvider([{ content: 'Fatto (figlio).' }], { model: 'mock-spawn-effort' });
      const permissionManager = new PermissionManager();
      const context = { provider, registry, permissionManager } as any;

      const result = await spawnAgentTool.execute(
        // Il chiamante chiede esplicitamente 'xhigh': il pin ('none') deve vincere comunque.
        { task: 'Compito qualsiasi per il test del pin.', roleName: 'developer', reasoningEffort: 'xhigh' },
        context
      );

      const match = /runs[\\\/]([^\\\/]+)[\\\/]/.exec(String(result));
      if (match) createdRunDirs.push(homePath('runs', match[1]));

      check('G.1a', typeof result === 'string' && (result.includes('SUB-AGENTE') || result.includes('SUB-AGENT')), 'spawn_agent completa normalmente');
      check('G.1b',
        provider.callLog[0]?.options?.reasoningEffort === 'none',
        `Accettazione: il pin ('none') vince anche sull'override esplicito del tool ('xhigh') (ricevuto: ${JSON.stringify(provider.callLog[0]?.options)})`
      );

      // Senza pin, l'override esplicito del chiamante torna a funzionare come T8.13 (invariato).
      resetEffortControlForTest();
      const provider2 = new MockLLMProvider([{ content: 'Fatto (figlio 2).' }], { model: 'mock-spawn-effort-2' });
      const context2 = { provider: provider2, registry: new ToolRegistry(), permissionManager: new PermissionManager() } as any;
      const result2 = await spawnAgentTool.execute(
        { task: 'Compito qualsiasi per il test senza pin.', roleName: 'developer', reasoningEffort: 'medium' },
        context2
      );
      const match2 = /runs[\\\/]([^\\\/]+)[\\\/]/.exec(String(result2));
      if (match2) createdRunDirs.push(homePath('runs', match2[1]));
      check('G.2a',
        provider2.callLog[0]?.options?.reasoningEffort === 'medium',
        `senza pin, l'override del chiamante ('medium') resta invariato rispetto a T8.13 (ricevuto: ${JSON.stringify(provider2.callLog[0]?.options)})`
      );
    } finally {
      (InteractiveMenu as any).select = originalSelect;
      resetEffortControlForTest();
      for (const dir of createdRunDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    }
  }

  // ── H. Comando /effort: stato, pin, annuncio del cambio di tool, ask ────
  {
    resetEffortControlForTest();
    const profilePath = path.resolve(process.cwd(), 'models_profile.json');
    const backup = fs.existsSync(profilePath) ? fs.readFileSync(profilePath, 'utf-8') : null;

    try {
      // H1 — bare, nessun pin: provenienza "ruolo" (sysadmin → 'medium', nessun
      // personaggio, nessun default di configurazione).
      {
        const configManager = fakeConfigManager({ activeCharacter: 'custom', activeRole: 'sysadmin' });
        const registry = new ToolRegistry();
        const provider = new MockLLMProvider([], { model: '__t814_h1_probe__' });
        const ctx = buildEffortCtx(provider, registry, configManager);

        const { logs } = await captureLogs(() => handleEffort(ctx, ''));
        const text = logs.join('\n');
        check('H.1a', /medium/.test(text), `mostra il livello attivo risolto dal ruolo sysadmin (ricevuto: ${JSON.stringify(logs)})`);
        check('H.1b', /ruolo|role/i.test(text), 'dichiara la provenienza corretta: "ruolo"');
        check('H.1c', /nessuno|disattiva|none|disabled/i.test(text), 'dichiara che nessun pin è attivo e la modalità ask è spenta');
      }

      // H2 — /effort <livello>: fissa il pin, ricrea l'agente, annuncia un
      // cambiamento REALE del set di tool (fakeModel profilato SOLO a 'medium').
      {
        const fakeModel = '__t814_h2_probe__';
        fs.writeFileSync(profilePath, JSON.stringify({
          profiles: {
            [profileKey(fakeModel, 'medium')]: {
              model: fakeModel, provider: 'test', tier: 'medium',
              scores: { instruction: 0.7, json: 0.6, toolCalling: 0.65 },
              tokensPerSecond: 20, testedAt: new Date().toISOString(),
              benchmarkVersion: BENCHMARK_VERSION, testsHash: getBenchmarkTestsHash(),
              reasoningEffort: 'medium', avgCompletionTokens: 200
            }
          }
        }, null, 2), 'utf-8');

        const configManager = fakeConfigManager({ activeCharacter: 'custom', activeRole: 'sysadmin' }); // sysadmin → xhigh? no: 'medium' di suo
        const registry = new ToolRegistry();
        registry.register({ name: 'execute_command', riskLevel: 'RESTRICTED', execute: async () => 'ok' });
        const provider = new MockLLMProvider([], { model: fakeModel });
        const ctx = buildEffortCtx(provider, registry, configManager);

        // sysadmin è già 'medium' di suo: per generare una VERA divergenza di
        // tier partiamo da 'none' (nessun profilo a quella chiave → euristica
        // 'small', execute_command nascosto), poi pinniamo esplicitamente 'medium'
        // (profilo misurato → tier 'medium', execute_command visibile).
        setEffortPin('none');
        ctx.agent.current = ctx.recreateAgent();
        const before = getModelTier(fakeModel, ctx.agent.current.getReasoningEffort());
        check('H.2pre', before === 'small', `precondizione: a 'none' (non profilato) il tier ricade sull'euristica 'small' (ricevuto: ${before})`);

        const { logs } = await captureLogs(() => handleEffort(ctx, 'medium'));
        const text = logs.join('\n');
        check('H.2a', getEffortPin() === 'medium', 'il pin è stato fissato a \'medium\'');
        check('H.2b', ctx.agent.current.getReasoningEffort() === 'medium', 'l\'agente è stato ricreato con l\'effort pinnato');
        check('H.2c', /(Cambiano i tool|Visible tools changed)/i.test(text), `Accettazione: un pin che cambia il tier produce un messaggio che nomina la differenza (ricevuto: ${JSON.stringify(logs)})`);
        check('H.2d', /execute_command/.test(text), 'il messaggio nomina il tool coinvolto (execute_command)');
      }

      // H3 — /effort auto: rimuove il pin, ricrea l'agente, nessun cambiamento
      // di tool stavolta (nessun profilo per questo modello, l'euristica non
      // dipende dall'effort: prima e dopo restano identici).
      {
        const configManager = fakeConfigManager({ activeCharacter: 'custom', activeRole: 'sysadmin' });
        const registry = new ToolRegistry();
        registry.register({ name: 'execute_command', riskLevel: 'RESTRICTED', execute: async () => 'ok' });
        const provider = new MockLLMProvider([], { model: '__t814_h3_probe_no_digits__' });
        const ctx = buildEffortCtx(provider, registry, configManager);

        setEffortPin('xhigh');
        ctx.agent.current = ctx.recreateAgent();

        const { logs } = await captureLogs(() => handleEffort(ctx, 'auto'));
        const text = logs.join('\n');
        check('H.3a', getEffortPin() === undefined, '/effort auto rimuove il pin');
        check('H.3b', ctx.agent.current.getReasoningEffort() === 'medium', 'senza pin, l\'agente torna alla cascata (ruolo sysadmin → medium)');
        check('H.3c', /(Nessun cambiamento|No changes in visible tools)/i.test(text), `nessun profilo per questo modello: il tier resta lo stesso, il comando lo dichiara esplicitamente (ricevuto: ${JSON.stringify(logs)})`);
      }

      // H3b — /effort auto quando non c'è già nessun pin: no-op dichiarato, non un errore.
      {
        resetEffortControlForTest();
        const configManager = fakeConfigManager({ activeCharacter: 'custom', activeRole: 'sysadmin' });
        const ctx = buildEffortCtx(new MockLLMProvider([], { model: 'x' }), new ToolRegistry(), configManager);
        const { logs } = await captureLogs(() => handleEffort(ctx, 'auto'));
        check('H.3d', logs.some((l) => /(già in modalità automatica|already in automatic cascade)/i.test(l)), 'auto senza pin attivo: messaggio esplicito, nessun errore');
      }

      // H4 — /effort ask: alterna la modalità, messaggi distinti nei due sensi.
      {
        resetEffortControlForTest();
        const configManager = fakeConfigManager({ activeCharacter: 'custom', activeRole: 'sysadmin' });
        const ctx = buildEffortCtx(new MockLLMProvider([], { model: 'x' }), new ToolRegistry(), configManager);

        const { logs: onLogs } = await captureLogs(() => handleEffort(ctx, 'ask'));
        check('H.4a', isAskModeEnabled() === true, "/effort ask attiva la modalità (era spenta)");
        check('H.4b', onLogs.some((l) => /(attivata|Ask mode enabled)/i.test(l)), 'messaggio di attivazione');

        const { logs: offLogs } = await captureLogs(() => handleEffort(ctx, 'ask'));
        check('H.4c', isAskModeEnabled() === false, '/effort ask la disattiva di nuovo (toggle)');
        check('H.4d', offLogs.some((l) => /(disattivata|Ask mode disabled)/i.test(l)), 'messaggio di disattivazione');
        resetEffortControlForTest();
      }

      // H5 — livello non valido: errore esplicito, nessun pin toccato.
      {
        resetEffortControlForTest();
        const configManager = fakeConfigManager({ activeCharacter: 'custom', activeRole: 'sysadmin' });
        const ctx = buildEffortCtx(new MockLLMProvider([], { model: 'x' }), new ToolRegistry(), configManager);
        const { logs } = await captureLogs(() => handleEffort(ctx, 'ultra'));
        check('H.5a', getEffortPin() === undefined, 'un livello non valido non tocca il pin');
        check('H.5b', logs.some((l) => /(non valido|Invalid effort level)/i.test(l)), 'errore esplicito per un livello fuori enum');
      }
    } finally {
      if (backup !== null) {
        fs.writeFileSync(profilePath, backup, 'utf-8');
      } else if (fs.existsSync(profilePath)) {
        fs.unlinkSync(profilePath);
      }
      resetEffortControlForTest();
    }
  }

  // ── I. Non persistenza: il pin non tocca tsuka.config.json e non sopravvive
  //        a un nuovo processo ──────────────────────────────────────────────
  {
    const realConfigPath = path.resolve(process.cwd(), 'tsuka.config.json');
    const before = fs.readFileSync(realConfigPath, 'utf-8');

    resetEffortControlForTest();
    setEffortPin('none');
    setEffortPin('xhigh');
    setAskMode(true);
    setEffortPin(undefined);
    setAskMode(false);

    const after = fs.readFileSync(realConfigPath, 'utf-8');
    check('I.1a', before === after, 'tsuka.config.json reale è byte-identico dopo vari cambi di pin/ask (nessuna scrittura su disco)');
    resetEffortControlForTest();

    // "Non sopravvive al riavvio": un processo figlio fresco, che non ha MAI
    // chiamato setEffortPin, deve vedere getEffortPin() === undefined — non
    // c'è alcun meccanismo di persistenza da cui potrebbe ereditarlo.
    const { spawnSync } = await import('child_process');
    const os = await import('os');
    const modulePath = path.join(__dirname, '..', 'src', 'core', 'effortControl').replace(/\\/g, '/');
    const probeScript = `
      import { getEffortPin, isAskModeEnabled } from '${modulePath}';
      if (getEffortPin() !== undefined) { console.error('PIN NON VUOTO'); process.exit(1); }
      if (isAskModeEnabled() !== false) { console.error('ASK MODE NON VUOTA'); process.exit(1); }
      process.exit(0);
    `;
    const probePath = path.join(os.tmpdir(), `tsuka-effort-probe-${Date.now()}.ts`);
    fs.writeFileSync(probePath, probeScript, 'utf-8');
    try {
      const r = spawnSync('node', ['--import', 'tsx', probePath], { stdio: 'pipe', windowsHide: true });
      check('I.2a', r.status === 0, `un processo nuovo parte SEMPRE senza pin/ask attivi (stdout: ${r.stdout?.toString()}, stderr: ${r.stderr?.toString()})`);
    } finally {
      try { fs.unlinkSync(probePath); } catch {}
    }
  }

  console.log(`\n=== Risultato: ${passed} passati, ${failed} falliti ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Errore fatale nel test:', err);
  process.exit(1);
});
