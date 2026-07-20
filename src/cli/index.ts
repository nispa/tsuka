import * as dotenv from 'dotenv';
import prompts from 'prompts';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { LLMProvider } from '../core/provider';
import { ConfigManager } from '../core/config';
import { MemoryStore } from '../core/memory';
import { createDefaultRegistry } from '../tools/index';
import { PermissionManager } from '../safety/permissions';
import { Agent } from '../core/agent';
import { getModelProfile } from '../core/modelProfile';
import { CLITheme, InteractiveMenu } from './ui';
import { StreamRenderer } from './stream';
import { StatusLine } from './statusline';
import { askInput } from './input';
import { GenerationInterrupt } from './interrupt';
import {
  RoleConfig, TraitConfig, CharacterConfig, TeamConfig,
  loadJsonFile, listAvailableItems, listAvailableCharacters, resolveCharacter,
  loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, notifyIfUnprofiled
} from './shared';
import { CommandCtx } from './commands/types';
import { handleExit, handleInfo, handleReset } from './commands/session';
import { handleProvider, handleModels, handleUse, handleSearchEngine, handleBenchmark } from './commands/provider';
import { handleCharacter, handleRenameChar, handleRole, handleTrait } from './commands/persona';
import { handleCall } from './commands/call';
import { handleTeam } from './commands/team';

// Re-esporta interfacce per retrocompatibilità
export { RoleConfig, TraitConfig, CharacterConfig, TeamConfig };
export { loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, listAvailableItems };

// Carica variabili d'ambiente (.env per le API key protette)
dotenv.config();

// Ctrl+C durante la generazione: ripristina il terminale (riga di stato, cursore)
process.on('SIGINT', () => {
  StatusLine.emergencyReset();
  console.log(chalk.yellow('\nUscita in corso... Arrivederci!'));
  process.exit(130);
});

async function main() {
  CLITheme.banner();

  // Inizializza gestori e registri
  const configManager = new ConfigManager();
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
    
    return new Agent(
      provider,
      registry,
      permissionManager,
      loadSystemPrompt(role, trait, model, registry, char),
      role.allowedTools,
      configManager.getMaxHistoryMessages(),
      configManager.getMaxHistoryTokens()
    );
  };

  // Inizializzazione iniziale dell'agente
  let agent = recreateAgent();
  
  // Stampa informazioni iniziali
  const initialCharName = configManager.getActiveCharacter();
  const initialChar = loadCharacter(initialCharName);
  {
    const rows: { label: string; value: string; color?: (s: string) => string }[] = [
      { label: 'Provider', value: activeProvider.toUpperCase(), color: chalk.green },
      { label: 'Server', value: activeConfig.baseUrl, color: chalk.cyan },
    ];
    if (initialChar) {
      rows.push({ label: 'Personaggio', value: `${initialChar.displayName} (${initialChar.aiName})`, color: chalk.green });
    } else {
      rows.push({ label: 'Ruolo', value: loadRole(configManager.getActiveRole()).displayName, color: chalk.green });
      rows.push({ label: 'Attitudine', value: loadTrait(configManager.getActiveTrait()).displayName, color: chalk.green });
    }
    CLITheme.statusPanel(rows);
  }
  
  let availableModels: string[] = [];
  let initSpinner = CLITheme.createSpinner(`Connessione a ${activeProvider}...`);
  initSpinner.start();

  try {
    availableModels = await provider.listModels();
    initSpinner.succeed(chalk.green('Connessione stabilita con successo!'));
    
    // Controlla se il modello configurato è disponibile sul server
    if (availableModels.length > 0) {
      if (!availableModels.includes(activeConfig.model)) {
        const fallbackModel = availableModels[0];
        provider.setCurrentModel(fallbackModel);
        configManager.updateActiveModel(fallbackModel);
        
        agent = recreateAgent();
        
        CLITheme.warning(
          `Il modello configurato '${activeConfig.model}' non è presente. Impostato fallback a '${fallbackModel}'.`
        );
      } else {
        CLITheme.success(`Modello attivo: ${chalk.green(activeConfig.model)}`);
      }
      // Suggerisce /benchmark se il modello attivo non è mai stato profilato
      notifyIfUnprofiled(provider.getCurrentModel());
    } else {
      CLITheme.warning('Nessun modello trovato sul server.');
    }
  } catch (error: any) {
    initSpinner.fail(chalk.red(`Impossibile connettersi a ${activeProvider}.`));
    if (activeProvider === 'ollama') {
      CLITheme.warning('Assicurati che Ollama sia in esecuzione localmente (esegui "ollama serve").');
    } else {
      CLITheme.warning('Verifica la connessione internet e le chiavi API nel file .env.');
    }
    CLITheme.info('Puoi comunque digitare comandi o cambiare provider.\n');
  }

  // Visualizza la guida ai comandi
  CLITheme.help();

  // Costruisce il contesto condiviso per tutti i comandi slash
  const commandCtx: CommandCtx = {
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

  // Mappa dei comandi: ogni handler riceve il contesto e l'argomento
  const commandMap: Record<string, (ctx: CommandCtx, arg: string) => Promise<void>> = {
    '/exit':       handleExit,
    '/provider':   handleProvider,
    '/models':     handleModels,
    '/use':        handleUse,
    '/character':  handleCharacter,
    '/rename-char':handleRenameChar,
    '/team':       handleTeam,
    '/call':       handleCall,
    '/role':       handleRole,
    '/trait':      handleTrait,
    '/search-engine': handleSearchEngine,
    '/benchmark':  handleBenchmark,
  };

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
      if (command === '/memory') {
        const store = MemoryStore.getInstance();
        const facts = store.getRecent(20);
        console.log(chalk.bold(`\n🧠 Memoria condivisa (${store.count()} ricordi totali, ultimi ${facts.length}):`));
        if (facts.length === 0) {
          console.log(chalk.gray('  (vuota — gli agenti possono salvare fatti con il tool save_memory)'));
        } else {
          for (const f of facts) {
            const date = f.timestamp.replace('T', ' ').slice(0, 16);
            const content = f.content.length > 90 ? f.content.slice(0, 90) + '…' : f.content;
            console.log(`  ${chalk.gray(f.id)}  ${chalk.cyan(date)}  ${chalk.yellow(`(${f.source})`)} ${content}`);
          }
        }
        console.log();
        continue;
      }
      if (command === '/forget') {
        if (!arg) {
          CLITheme.error('Specificare l\'id del ricordo da eliminare, oppure "all" per svuotare la memoria. Es: /forget all');
          continue;
        }
        const store = MemoryStore.getInstance();
        if (arg.toLowerCase() === 'all') {
          console.log();
          const confirm = await prompts({
            type: 'confirm',
            name: 'ok',
            message: chalk.red(`Eliminare TUTTI i ${store.count()} ricordi dalla memoria condivisa?`),
            initial: false
          });
          if (confirm.ok) {
            store.clear();
            CLITheme.success('Memoria condivisa svuotata.');
          } else {
            CLITheme.info('Operazione annullata.');
          }
        } else {
          if (store.remove(arg)) {
            CLITheme.success(`Ricordo '${arg}' eliminato.`);
          } else {
            CLITheme.error(`Nessun ricordo trovato con id '${arg}'. Usa /memory per vedere gli id.`);
          }
        }
        continue;
      }

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

     // Determina il prompt con il nome proprio del personaggio se disponibile
     const charName = configManager.getActiveCharacter();
     const activeCharObj = loadCharacter(charName);
     const agentHeaderName = activeCharObj ? activeCharObj.aiName : 'Tsuka';

     // Streaming live con status line animata; a fine risposta il renderer
    // sostituisce lo stream grezzo con il pannello markdown definitivo.
    // Esc interrompe la generazione e torna al prompt (Ctrl+C esce).
    const renderer = new StreamRenderer({ headerName: agentHeaderName });
    const interrupt = new GenerationInterrupt();
    interrupt.arm();
    renderer.begin();
    try {
       await agent.run(
         trimmedInput,
         (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
         (stats) => renderer.setStats(stats),
         (ev) => renderer.onAgentEvent(ev),
         interrupt.signal
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
     } catch (error: any) {
      renderer.abort();
      console.log();
      CLITheme.error(`Errore durante l'elaborazione: ${error.message}`);
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
