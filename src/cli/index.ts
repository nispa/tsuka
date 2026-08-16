#!/usr/bin/env node
import * as dotenv from 'dotenv';
import prompts from 'prompts';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { LLMProvider, setLlmTimeoutMs } from '../core/provider';
import { homePath } from '../core/apphome';
import { ConfigManager } from '../core/config';
import { scanProviders, detectContextWindow } from '../core/discovery';
import { MemoryStore } from '../core/memory';
import { createDefaultRegistry } from '../tools/index';
import { PermissionManager } from '../safety/permissions';
import { Agent, resolveReasoningEffort } from '../core/agent';
import { getModelProfile, getRecommendedEffort } from '../core/modelProfile';
import { withEffortPin, confirmEffortDivergence } from '../core/effortControl';
import type { ReasoningEffort } from '../core/provider';
import { CLITheme, InteractiveMenu } from './ui';
import { StreamRenderer } from './stream';
import { StatusLine } from './statusline';
import { askInput, setCompletionSource } from './input';
import { lockRawMode } from './rawlock';
import { GenerationInterrupt } from './interrupt';
import { ContextTracker } from '../core/contextTracker';
import {
  RoleConfig, TraitConfig, CharacterConfig, TeamConfig,
  loadJsonFile, listAvailableItems, listAvailableCharacters, listAvailableTeams, listAvailableRoles, resolveCharacter,
  loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, notifyIfUnprofiled
} from './shared';
import { CommandCtx } from './commands/types';
import { handleExit, handleInfo, handleReset } from './commands/session';
import { handleProvider, handleModels, handleSearchEngine, handleBenchmark } from './commands/provider';
import { handleAgent } from './commands/persona';
import { handleTools } from './commands/tools';
import { handleRuns } from './commands/runs';
import { handleMemory } from './commands/memory';
import { handleContext } from './commands/session';
import { handleCall } from './commands/call';
import { handleTeam } from './commands/team';
import { handleGoal } from './commands/goal';
import { handleEffort } from './commands/effort';
import { handleBlackboard } from './commands/blackboard';
import { listThinkingTraces, resolveThinkingTrace, buildResumeDirective } from './commands/continueSession';

import { handleInitCmd } from './initCmd';

export { RoleConfig, TraitConfig, CharacterConfig, TeamConfig };
export { loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, listAvailableItems };

// Carica variabili d'ambiente (.env per le API key protette) dalla home
// dell'app, non dalla cwd: il comando globale `tsuka` può essere lanciato
// da qualsiasi cartella e deve comunque trovare le chiavi.
dotenv.config({ path: homePath('.env') });

// Ctrl+C durante la generazione: ripristina il terminale (riga di stato, cursore)
process.on('SIGINT', () => {
  StatusLine.emergencyReset();
  console.log(chalk.yellow('\nUscita in corso... Arrivederci!'));
  process.exit(130);
});

async function main() {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0 && cliArgs[0] === 'init') {
    const success = await handleInitCmd(cliArgs.slice(1));
    process.exit(success ? 0 : 1);
  }

  // Blocca il raw mode per tutta la sessione: evita il wedge dell'input su
  // Windows causato dai passaggi raw→cooked di readline/prompts (vedi rawlock.ts)
  lockRawMode();

  CLITheme.banner();

  // Inizializza gestori e registri
  const configManager = new ConfigManager();
  setLlmTimeoutMs(configManager.getLlmTimeoutMs());



  const permissionManager = new PermissionManager();
  const registry = await createDefaultRegistry();

  let activeProvider = configManager.getActiveProviderName();
  let activeConfig = configManager.getActiveProviderConfig();
  
  // Carica provider LLM
  let provider = new LLMProvider(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model);

  // Helper locale per ricreare l'agente al volo rileggendo la configurazione corrente
  const recreateAgent = (): Agent => {
    const charName = configManager.getActiveCharacter();
    const char = loadCharacter(charName);
    
    const roleName = char ? char.role : configManager.getActiveRole();
    const traitName = char ? char.trait : configManager.getActiveTrait();
    
    const role = loadRole(roleName);
    const trait = loadTrait(traitName);
    const model = provider.getCurrentModel();

    // T8.10: cascata override chiamante (nessuno, qui — è la chat normale) →
    // personaggio → ruolo → default di tsuka.config.json.
    const cascadedEffort = resolveReasoningEffort(undefined, char, role, configManager.getDefaultReasoningEffort());
    // T8.14: il pin globale (/effort, in memoria di processo) si applica SOPRA
    // questa cascata — resolveReasoningEffort resta invariata, il pin vince solo
    // se presente (withEffortPin torna cascadedEffort quando non c'è pin).
    const reasoningEffort = withEffortPin(cascadedEffort);

    const a = new Agent(
      provider,
      registry,
      permissionManager,
      loadSystemPrompt(role, trait, model, registry, char, undefined, reasoningEffort),
      role.allowedTools,
      configManager.getMaxHistoryMessages(),
      configManager.getMaxHistoryTokens(),
      undefined,
      reasoningEffort,
      undefined,
      configManager.getMaxToolRounds()
    );
    if (typeof commandCtx !== 'undefined') {
      a.setCommandCtx(commandCtx);
    }
    return a;
  };

  let commandCtx: CommandCtx;

  // Inizializzazione iniziale dell'agente
  let agent = recreateAgent();
  
  // Scansione dei server all'avvio: prova il provider attivo e, se spento,
  // gli altri server locali configurati, agganciandosi al volo a quello vivo
  // e al modello disponibile (o già caricato in memoria) in quel momento.
  let availableModels: string[] = [];
  let initSpinner = CLITheme.createSpinner(`Scansione dei server LLM (attivo: ${activeProvider})...`);
  initSpinner.start();

  const candidates = configManager.getProviderNames().map((name) => ({
    name,
    config: configManager.getProviderConfig(name)!,
    apiKey: configManager.getApiKeyFor(name),
  }));
  const scan = await scanProviders(candidates, activeProvider);

  if (scan) {
    if (scan.name !== activeProvider) {
      initSpinner.succeed(chalk.green(`Server '${scan.name}' attivo`) + chalk.gray(` (il provider configurato '${activeProvider}' non risponde)`));
      activeProvider = scan.name;
      configManager.setActiveProvider(scan.name);
      activeConfig = configManager.getActiveProviderConfig();
      provider.reconfigure(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model);
      agent = recreateAgent();
    } else {
      initSpinner.succeed(chalk.green(`Connessione stabilita con ${activeProvider}.`));
    }

    availableModels = scan.models;
    if (availableModels.length === 0) {
      CLITheme.warning('Nessun modello trovato sul server.');
    } else {
      // Priorità: modello già caricato in RAM > modello configurato se presente > primo disponibile
      const configured = activeConfig.model;
      const chosen = scan.loadedModel ?? (availableModels.includes(configured) ? configured : availableModels[0]);
      if (chosen !== provider.getCurrentModel()) {
        provider.setCurrentModel(chosen);
        configManager.updateActiveModel(chosen);
        agent = recreateAgent();
      }
      if (scan.loadedModel && scan.loadedModel !== configured) {
        CLITheme.success(`Agganciato al modello già caricato sul server: ${chalk.green(chosen)}`);
      } else if (!availableModels.includes(configured) && chosen !== configured) {
        CLITheme.warning(`Il modello configurato '${configured}' non è presente. Impostato fallback a '${chosen}'.`);
      } else {
        const loadedHint = scan.loadedModel === chosen ? chalk.gray(' (già caricato in memoria)') : '';
        CLITheme.success(`Modello attivo: ${chalk.green(chosen)}${loadedHint}`);
      }

      // Rilevamento dinamico della finestra di contesto (T11.5)
      const dynamicCtx = scan.contextWindow ?? (await detectContextWindow(activeConfig.baseUrl, configManager.getApiKey(), chosen));
      if (dynamicCtx) {
        configManager.setRuntimeContextTokens(dynamicCtx);
        agent = recreateAgent();
      }

      // Suggerisce /benchmark se il modello attivo non è mai stato profilato
      notifyIfUnprofiled(provider.getCurrentModel(), agent.getReasoningEffort());
    }
  } else {
    initSpinner.fail(chalk.red('Nessun server LLM raggiungibile (Ollama, Unsloth, OpenRouter).'));
    CLITheme.warning('💡 Come iniziare:');
    console.log(chalk.gray('  • Se usi Ollama: avvialo con ') + chalk.cyan('ollama serve') + chalk.gray(' e carica un modello (es. ') + chalk.cyan('ollama run qwen2.5-coder:7b') + chalk.gray(')'));
    console.log(chalk.gray('  • Se usi OpenRouter: configura la chiave API in ') + chalk.cyan('.env') + chalk.gray(' o digita ') + chalk.cyan('/provider'));
    console.log(chalk.gray('  • Per inizializzare un set di agenti nel workspace: ') + chalk.cyan('tsuka init --preset core\n'));
  }

  // Pannello di stato con i dati effettivi post-scansione
  const initialCharName = configManager.getActiveCharacter();
  const initialChar = loadCharacter(initialCharName);
  {
    const runtimeCtx = configManager.getRuntimeContextTokens();
    const ctxLabel = runtimeCtx
      ? `${runtimeCtx.toLocaleString()} tok (live server)`
      : `${configManager.getMaxHistoryTokens().toLocaleString()} tok (default config)`;

    const currentM = scan ? provider.getCurrentModel() : '';
    const recEffort = currentM ? getRecommendedEffort(currentM) : null;
    const effortLabel = recEffort
      ? `${recEffort.toUpperCase()} (consigliato da benchmark)`
      : 'standard';

    const rows: { label: string; value: string; color?: (s: string) => string }[] = [
      { label: 'Provider', value: activeProvider.toUpperCase(), color: chalk.green },
      { label: 'Server', value: activeConfig.baseUrl, color: chalk.cyan },
      { label: 'Modello', value: scan ? provider.getCurrentModel() : 'nessuno (server offline)', color: scan ? chalk.green : chalk.red },
      { label: 'Contesto', value: ctxLabel, color: runtimeCtx ? chalk.green : chalk.gray },
      { label: 'Sforzo (Effort)', value: effortLabel, color: recEffort ? chalk.magenta : chalk.gray },
    ];
    if (initialChar) {
      rows.push({ label: 'Personaggio', value: `${initialChar.displayName} (${initialChar.aiName})`, color: chalk.green });
    } else {
      rows.push({ label: 'Ruolo', value: loadRole(configManager.getActiveRole()).displayName, color: chalk.green });
      rows.push({ label: 'Attitudine', value: loadTrait(configManager.getActiveTrait()).displayName, color: chalk.green });
    }
    CLITheme.statusPanel(rows);
  }

  // Visualizza la guida ai comandi
  CLITheme.help();

  // Costruisce il contesto condiviso per tutti i comandi slash
  commandCtx = {
    configManager,
    provider,
    registry,
    permissionManager,
    agent: { current: agent },
    availableModels: { current: availableModels },
    recreateAgent,
    loadRole,
    loadTrait,
    loadCharacter,
    loadTeam,
    listAvailableCharacters,
    listAvailableItems
  };
  agent.setCommandCtx(commandCtx);

  // Mappa dei comandi: ogni handler riceve il contesto e l'argomento
  const commandMap: Record<string, (ctx: CommandCtx, arg: string) => Promise<void>> = {
    '/provider':   handleProvider,
    '/models':     handleModels,
    '/call':       handleCall,
    '/team':       handleTeam,
    '/goal':       handleGoal,
    '/agent':      handleAgent,
    '/tools':      handleTools,
    '/runs':       handleRuns,
    '/benchmark':  handleBenchmark,
    '/memory':     handleMemory,
    '/context':    handleContext,
    '/effort':     handleEffort,
    '/blackboard': handleBlackboard,
    '/search-engine': handleSearchEngine,
  };

  // Autocompletamento con Tab: nomi comando + argomenti dinamici + mention @personaggi/@ruoli.
  // I comandi inline (gestiti direttamente nel loop REPL) vanno aggiunti a mano.
  setCompletionSource({
    commands: [...new Set([
      ...Object.keys(commandMap),
      '/clear', '/help', '/reset', '/info', '/exit', '/continue',
    ])].sort(),
    argumentsFor: (command) => {
      if (command === '/models' || command === '/benchmark') return commandCtx.availableModels.current;
      if (command === '/provider') return configManager.getProviderNames();
      if (command === '/continue') return listThinkingTraces().map((t) => t.filename);
      if (command === '/agent') return commandCtx.listAvailableCharacters().map(c => c.name);
      if (command === '/team') return listAvailableTeams().map(t => t.name);
      if (command === '/call') {
        const chars = commandCtx.listAvailableCharacters().map(c => `@${c.name}`);
        const roles = listAvailableRoles().map(r => `@${r.name}`);
        return [...new Set([...chars, ...roles])];
      }
      if (command === '/memory') return ['clear'];
      if (command === '/effort') return ['none', 'low', 'medium', 'xhigh', 'auto', 'ask'];
      return [];
    },
    mentions: () => {
      const chars = commandCtx.listAvailableCharacters().map(c => `@${c.name}`);
      const roles = listAvailableRoles().map(r => `@${r.name}`);
      return [...new Set([...chars, ...roles])];
    }
  });

  // Avvia il loop REPL (readline nativo: history navigabile con frecce su/giù)
  while (true) {
    const input = await askInput('User ❯');

    // Gestione dell'interruzione (Ctrl+C / Ctrl+D)
    if (input === undefined) {
      console.log(chalk.yellow('\nUscita in corso... Arrivederci!'));
      break;
    }

    const trimmedInput = input.trim();
    if (!trimmedInput) continue;

    // Messaggio effettivo da inviare all'agente in questo giro: di norma è
    // trimmedInput così com'è, ma /continue lo sostituisce con la direttiva
    // di ripresa forzata e "cade" nel turno di chat normale sotto invece di
    // consumare l'input con un `continue` come fanno gli altri comandi.
    let messageToSend: string | null = null;

    // Gestione dei comandi Slash
    if (trimmedInput.startsWith('/')) {
      const parts = trimmedInput.split(' ');
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      // Comandi semplici inline
      if (command === '/exit') {
        console.log(chalk.yellow('Uscita in corso... Arrivederci!'));
        process.exit(0);
      }
      if (command === '/clear') {
        CLITheme.banner();
        CLITheme.help();
        continue;
      }
      if (command === '/help') {
        CLITheme.help();
        continue;
      }
      if (command === '/reset') {
        agent = recreateAgent();
        commandCtx.agent.current = agent;
        permissionManager.resetSession();
        CLITheme.success('Sessione resettata con successo (cronologia e autorizzazioni azzerate).');
        continue;
      }
      if (command === '/info') {
        const charName = configManager.getActiveCharacter();
        const char = loadCharacter(charName);
        console.log(chalk.bold('\nInformazioni di Sessione:'));
        console.log(`- Provider Attivo: ${chalk.green(configManager.getActiveProviderName().toUpperCase())}`);
        console.log(`- Endpoint Server: ${chalk.cyan(provider.getBaseUrl())}`);
        console.log(`- Modello Attivo:  ${chalk.green(provider.getCurrentModel())}`);
        const profile = getModelProfile(provider.getCurrentModel());
        if (profile) {
          const tierColor = profile.tier === 'large' ? chalk.green : profile.tier === 'medium' ? chalk.yellow : chalk.red;
          console.log(`- Profilo Misurato: tier ${tierColor(profile.tier.toUpperCase())} (${profile.tokensPerSecond} tok/s, testato il ${profile.testedAt.slice(0, 10)})`);
        } else {
          console.log(chalk.gray('- Profilo Misurato: assente (usa /benchmark per misurare le capacità del modello)'));
        }
        if (char) {
          console.log(`- Personaggio:     ${chalk.green(char.displayName)} (${chalk.yellow(char.aiName)})`);
          console.log(`  └─ Ruolo collegato:  ${char.role}`);
          console.log(`  └─ Tratto collegato: ${char.trait}`);
        } else {
          console.log(`- Ruolo Agente:    ${chalk.green(loadRole(configManager.getActiveRole()).displayName)}`);
          console.log(`- Attitudine:      ${chalk.green(loadTrait(configManager.getActiveTrait()).displayName)}`);
        }
        console.log();
        continue;
      }
      if (command === '/continue') {
        const traces = listThinkingTraces();
        if (traces.length === 0) {
          CLITheme.warning('Nessun ragionamento salvato da riprendere (memory/thinking/ è vuota).');
          continue;
        }
        const trace = await resolveThinkingTrace(arg, traces);
        if (!trace) {
          CLITheme.error(`Nessuna traccia trovata per '${arg}'. Usa /continue senza argomenti per l'elenco.`);
          continue;
        }
        let traceContent: string;
        try {
          traceContent = fs.readFileSync(trace.fullPath, 'utf-8');
        } catch (err: any) {
          CLITheme.error(`Impossibile leggere ${trace.filename}: ${err.message}`);
          continue;
        }
        CLITheme.info(`Ripresa forzata da: ${chalk.cyan(trace.filename)} (${trace.interrupted ? chalk.yellow('interrotto') : chalk.green('completo')})`);
        messageToSend = buildResumeDirective(traceContent);
        // Nessun `continue` qui: si cade di proposito nel turno di chat
        // normale più sotto, con messageToSend al posto di trimmedInput.
      } else {
        // Dispatch ai moduli estratti per i comandi complessi
        const handler = commandMap[command];
        if (handler) {
          await handler(commandCtx, arg);
          // Aggiorna i riferimenti mutabili dopo l'esecuzione del comando
          agent = commandCtx.agent.current;
          if (commandCtx.availableModels.current !== availableModels) {
            availableModels = commandCtx.availableModels.current;
          }
          continue;
        }

        CLITheme.error(`Comando sconosciuto: ${command}. Digita /help per vedere i comandi.`);
        continue;
      }
    } else {
      messageToSend = trimmedInput;
    }

    if (messageToSend === null) continue;

     // Determina il prompt con il nome proprio del personaggio se disponibile
     const charName = configManager.getActiveCharacter();
     const activeCharObj = loadCharacter(charName);
     const agentHeaderName = activeCharObj ? activeCharObj.aiName : 'Tsuka';

     // T8.14: rende visibile (o chiede conferma, in modalità ask) quando l'effort
     // di questo turno diverge dal livello di riferimento (pin, o default di
     // configurazione se non c'è pin). SOLO qui: è l'unico punto della chat
     // interattiva vera — /team, /goal e i figli di spawn_agent passano invece
     // da logEffortDivergence (mai un prompt, vincolo esplicito del task).
     const turnEffortOverride: ReasoningEffort | undefined = await confirmEffortDivergence(
       agentHeaderName,
       agent.getReasoningEffort(),
       configManager.getDefaultReasoningEffort(),
       async (effective, reference) => {
         console.log();
         const decision = await InteractiveMenu.select<'yes' | 'no'>(
           `Questo turno girerebbe a effort '${effective ?? 'nessuno'}' (riferimento: '${reference ?? 'nessuno'}'). Procedere?`,
           [
             { title: `Procedi con '${effective ?? 'nessuno'}'`, value: 'yes' },
             { title: `Usa il riferimento '${reference ?? 'nessuno'}' solo per questo turno`, value: 'no' }
           ],
           'yes'
         );
         return decision === 'yes';
       }
     );

     // Streaming live con status line animata; a fine risposta il renderer
    // sostituisce lo stream grezzo con il pannello markdown definitivo.
    // Esc interrompe la generazione e torna al prompt (Ctrl+C esce).
    const renderer = new StreamRenderer({ headerName: agentHeaderName });
    const interrupt = new GenerationInterrupt();
    interrupt.arm();
    renderer.begin();

    // Accumula stats per context tracker
    let agentRunStats: any = null;

    try {
       await agent.run(
         messageToSend,
         (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
         (stats) => { renderer.setStats(stats); agentRunStats = stats; },
         // rearm: i prompt di autorizzazione disattivano il raw mode alla chiusura,
         // riattivarlo a ogni evento mantiene Esc/Ctrl+X funzionanti per tutto il run
         (ev) => { renderer.onAgentEvent(ev); interrupt.rearm(); },
         interrupt.signal,
         // Override SOLO per questo turno se l'utente ha rifiutato in modalità
         // ask (torna sempre agent.getReasoningEffort() quando non c'è
         // divergenza o l'ask mode è spenta: nessun comportamento nuovo).
         turnEffortOverride !== agent.getReasoningEffort() ? turnEffortOverride : undefined
       );
       if (interrupt.aborted) {
         // Conserva in cronologia l'eventuale risposta parziale già streammata
         const partial = renderer.getFullText().trim();
         if (partial) {
           agent.getMessages().push({ role: 'assistant', content: partial + '\n[risposta interrotta dall\'utente]' });
         }
         renderer.abort();
         CLITheme.warning('Generazione interrotta (Esc).');
       } else {
         renderer.finish();
       }
       console.log();

       // Traccia l'attività nel context tracker
       try {
         if (agentRunStats) {
           ContextTracker.getInstance().addEntry({
             timestamp: new Date().toISOString(),
             agentName: agentHeaderName,
             tokenCount: agentRunStats.tokenCount ?? 0,
             promptTokens: agentRunStats.promptTokens ?? 0,
             action: trimmedInput.length > 80 ? trimmedInput.slice(0, 80) + '…' : trimmedInput
           });
         }
       } catch {}

       // Compressione automatica se il contesto supera la soglia
       try {
         await agent.compressHistory(0.75);
       } catch {}

     } catch (error: any) {
      renderer.abort();
      console.log();
      const msg = error?.message || String(error);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        CLITheme.error(`Impossibile connettersi al provider ${activeProvider.toUpperCase()} (${activeConfig.baseUrl}).`);
        CLITheme.warning(`Assicurati che il server sia attivo o usa /provider per cambiare endpoint.`);
      } else if (msg.includes('401') || msg.includes('Incorrect API key') || msg.includes('Unauthorized')) {
        CLITheme.error(`Autenticazione fallita per il provider ${activeProvider.toUpperCase()}.`);
        CLITheme.warning(`Verifica la chiave API in .env o configurala tramite /provider.`);
      } else {
        CLITheme.error(`Errore durante l'elaborazione: ${msg}`);
      }
    } finally {
      interrupt.disarm();
    }

    CLITheme.printDivider();
  }
}

main().catch((err) => {
  CLITheme.error(`Errore fatal: ${err.message}`);
  process.exit(1);
});
