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
import { launchTui } from '../tui/index';

export { RoleConfig, TraitConfig, CharacterConfig, TeamConfig };
export { loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, listAvailableItems };

// Load environment variables (.env) from app home directory
dotenv.config({ path: homePath('.env') });

// SIGINT handler: resets terminal cursor and status line
process.on('SIGINT', () => {
  StatusLine.emergencyReset();
  console.log(chalk.yellow('\nExiting... Goodbye!'));
  process.exit(130);
});

async function main() {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0 && cliArgs[0] === 'init') {
    const success = await handleInitCmd(cliArgs.slice(1));
    process.exit(success ? 0 : 1);
  }

  const configManager = new ConfigManager();
  setLlmTimeoutMs(configManager.getLlmTimeoutMs());

  const isCliForced = cliArgs.includes('--cli') || cliArgs.includes('--repl');
  const isTuiForced = cliArgs.includes('--tui') || cliArgs.includes('tui');

  if (isTuiForced || (!isCliForced && configManager.getDefaultUi() === 'tui')) {
    await launchTui();
    return;
  }

  // Lock raw mode across whole session to prevent Windows readline input wedge
  lockRawMode();

  CLITheme.banner();

  const permissionManager = new PermissionManager();
  const registry = await createDefaultRegistry();

  let activeProvider = configManager.getActiveProviderName();
  let activeConfig = configManager.getActiveProviderConfig();
  
  let provider = new LLMProvider(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model);

  // Helper to recreate agent dynamically with active settings
  const recreateAgent = (): Agent => {
    const charName = configManager.getActiveCharacter();
    const char = loadCharacter(charName);
    
    const roleName = char ? char.role : configManager.getActiveRole();
    const traitName = char ? char.trait : configManager.getActiveTrait();
    
    const role = loadRole(roleName);
    const trait = loadTrait(traitName);
    const model = provider.getCurrentModel();

    const cascadedEffort = resolveReasoningEffort(undefined, char, role, configManager.getDefaultReasoningEffort());
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

  let agent = recreateAgent();
  
  // Scan servers on startup
  let availableModels: string[] = [];
  let initSpinner = CLITheme.createSpinner(`Scanning LLM servers (active: ${activeProvider})...`);
  initSpinner.start();

  const candidates = configManager.getProviderNames().map((name) => ({
    name,
    config: configManager.getProviderConfig(name)!,
    apiKey: configManager.getApiKeyFor(name),
  }));
  const scan = await scanProviders(candidates, activeProvider);

  if (scan) {
    if (scan.name !== activeProvider) {
      initSpinner.succeed(chalk.green(`Server '${scan.name}' online`) + chalk.gray(` (configured provider '${activeProvider}' unreachable)`));
      activeProvider = scan.name;
      configManager.setActiveProvider(scan.name);
      activeConfig = configManager.getActiveProviderConfig();
      provider.reconfigure(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model);
      agent = recreateAgent();
    } else {
      initSpinner.succeed(chalk.green(`Connection established with ${activeProvider}.`));
    }

    availableModels = scan.models;
    if (availableModels.length === 0) {
      CLITheme.warning('No models found on server.');
    } else {
      const configured = activeConfig.model;
      const chosen = scan.loadedModel ?? (availableModels.includes(configured) ? configured : availableModels[0]);
      if (chosen !== provider.getCurrentModel()) {
        provider.setCurrentModel(chosen);
        configManager.updateActiveModel(chosen);
        agent = recreateAgent();
      }
      if (scan.loadedModel && scan.loadedModel !== configured) {
        CLITheme.success(`Attached to model already loaded in server RAM: ${chalk.green(chosen)}`);
      } else if (!availableModels.includes(configured) && chosen !== configured) {
        CLITheme.warning(`Configured model '${configured}' not available. Falling back to '${chosen}'.`);
      } else {
        const loadedHint = scan.loadedModel === chosen ? chalk.gray(' (loaded in RAM)') : '';
        CLITheme.success(`Active model: ${chalk.green(chosen)}${loadedHint}`);
      }

      const dynamicCtx = scan.contextWindow ?? (await detectContextWindow(activeConfig.baseUrl, configManager.getApiKey(), chosen));
      if (dynamicCtx) {
        configManager.setRuntimeContextTokens(dynamicCtx);
        agent = recreateAgent();
      }

      notifyIfUnprofiled(provider.getCurrentModel(), agent.getReasoningEffort());
    }
  } else {
    initSpinner.fail(chalk.red('No LLM server reachable (Ollama, Unsloth, OpenRouter).'));
    CLITheme.warning('💡 Getting started:');
    console.log(chalk.gray('  • If using Ollama: start with ') + chalk.cyan('ollama serve') + chalk.gray(' and load a model (e.g. ') + chalk.cyan('ollama run qwen2.5-coder:7b') + chalk.gray(')'));
    console.log(chalk.gray('  • If using OpenRouter: configure API key in ') + chalk.cyan('.env') + chalk.gray(' or type ') + chalk.cyan('/provider'));
    console.log(chalk.gray('  • To initialize a preset roster in workspace: ') + chalk.cyan('tsuka init --preset core\n'));
  }

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
      ? `${recEffort.toUpperCase()} (benchmark recommended)`
      : 'standard';

    const rows: { label: string; value: string; color?: (s: string) => string }[] = [
      { label: 'Provider', value: activeProvider.toUpperCase(), color: chalk.green },
      { label: 'Server', value: activeConfig.baseUrl, color: chalk.cyan },
      { label: 'Model', value: scan ? provider.getCurrentModel() : 'none (offline)', color: scan ? chalk.green : chalk.red },
      { label: 'Context', value: ctxLabel, color: runtimeCtx ? chalk.green : chalk.gray },
      { label: 'Effort', value: effortLabel, color: recEffort ? chalk.magenta : chalk.gray },
    ];
    if (initialChar) {
      rows.push({ label: 'Character', value: `${initialChar.displayName} (${initialChar.aiName})`, color: chalk.green });
    } else {
      rows.push({ label: 'Role', value: loadRole(configManager.getActiveRole()).displayName, color: chalk.green });
      rows.push({ label: 'Trait', value: loadTrait(configManager.getActiveTrait()).displayName, color: chalk.green });
    }
    CLITheme.statusPanel(rows);
  }

  CLITheme.help();

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

  while (true) {
    const input = await askInput('User ❯');

    if (input === undefined) {
      console.log(chalk.yellow('\nExiting... Goodbye!'));
      break;
    }

    const trimmedInput = input.trim();
    if (!trimmedInput) continue;

    let messageToSend: string | null = null;

    if (trimmedInput.startsWith('/')) {
      const parts = trimmedInput.split(' ');
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      if (command === '/exit') {
        console.log(chalk.yellow('Exiting... Goodbye!'));
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
        CLITheme.success('Session reset successfully (history and permissions cleared).');
        continue;
      }
      if (command === '/info') {
        const charName = configManager.getActiveCharacter();
        const char = loadCharacter(charName);
        console.log(chalk.bold('\nSession Information:'));
        console.log(`- Active Provider: ${chalk.green(configManager.getActiveProviderName().toUpperCase())}`);
        console.log(`- Server Endpoint: ${chalk.cyan(provider.getBaseUrl())}`);
        console.log(`- Active Model:    ${chalk.green(provider.getCurrentModel())}`);
        const profile = getModelProfile(provider.getCurrentModel());
        if (profile) {
          const tierColor = profile.tier === 'large' ? chalk.green : profile.tier === 'medium' ? chalk.yellow : chalk.red;
          console.log(`- Measured Profile: tier ${tierColor(profile.tier.toUpperCase())} (${profile.tokensPerSecond} tok/s, tested on ${profile.testedAt.slice(0, 10)})`);
        } else {
          console.log(chalk.gray('- Measured Profile: none (use /benchmark to measure model capabilities)'));
        }
        if (char) {
          console.log(`- Character:       ${chalk.green(char.displayName)} (${chalk.yellow(char.aiName)})`);
          console.log(`  └─ Linked Role:   ${char.role}`);
          console.log(`  └─ Linked Trait:  ${char.trait}`);
        } else {
          console.log(`- Agent Role:      ${chalk.green(loadRole(configManager.getActiveRole()).displayName)}`);
          console.log(`- Trait:           ${chalk.green(loadTrait(configManager.getActiveTrait()).displayName)}`);
        }
        console.log();
        continue;
      }
      if (command === '/continue') {
        const traces = listThinkingTraces();
        if (traces.length === 0) {
          CLITheme.warning('No saved reasoning traces to resume (memory/thinking/ is empty).');
          continue;
        }
        const trace = await resolveThinkingTrace(arg, traces);
        if (!trace) {
          CLITheme.error(`No trace found for '${arg}'. Use /continue without arguments to see the list.`);
          continue;
        }
        let traceContent: string;
        try {
          traceContent = fs.readFileSync(trace.fullPath, 'utf-8');
        } catch (err: any) {
          CLITheme.error(`Unable to read ${trace.filename}: ${err.message}`);
          continue;
        }
        CLITheme.info(`Forced resumption from: ${chalk.cyan(trace.filename)} (${trace.interrupted ? chalk.yellow('interrupted') : chalk.green('complete')})`);
        messageToSend = buildResumeDirective(traceContent);
      } else {
        const handler = commandMap[command];
        if (handler) {
          await handler(commandCtx, arg);
          agent = commandCtx.agent.current;
          if (commandCtx.availableModels.current !== availableModels) {
            availableModels = commandCtx.availableModels.current;
          }
          continue;
        }

        CLITheme.error(`Unknown command: ${command}. Type /help to see available commands.`);
        continue;
      }
    } else {
      messageToSend = trimmedInput;
    }

    if (messageToSend === null) continue;

     const charName = configManager.getActiveCharacter();
     const activeCharObj = loadCharacter(charName);
     const agentHeaderName = activeCharObj ? activeCharObj.aiName : 'Tsuka';

     const turnEffortOverride: ReasoningEffort | undefined = await confirmEffortDivergence(
       agentHeaderName,
       agent.getReasoningEffort(),
       configManager.getDefaultReasoningEffort(),
       async (effective, reference) => {
         console.log();
         const decision = await InteractiveMenu.select<'yes' | 'no'>(
           `This turn would run with effort '${effective ?? 'none'}' (reference: '${reference ?? 'none'}'). Proceed?`,
           [
             { title: `Proceed with '${effective ?? 'none'}'`, value: 'yes' },
             { title: `Use reference '${reference ?? 'none'}' only for this turn`, value: 'no' }
           ],
           'yes'
         );
         return decision === 'yes';
       }
     );

    const renderer = new StreamRenderer({ headerName: agentHeaderName });
    const interrupt = new GenerationInterrupt();
    interrupt.arm();
    renderer.begin();

    let agentRunStats: any = null;

    try {
       await agent.run(
         messageToSend,
         (chunk, channel) => renderer.onDelta(chunk, channel ?? 'content'),
         (stats) => { renderer.setStats(stats); agentRunStats = stats; },
         (ev) => { renderer.onAgentEvent(ev); interrupt.rearm(); },
         interrupt.signal,
         turnEffortOverride !== agent.getReasoningEffort() ? turnEffortOverride : undefined
       );
       if (interrupt.aborted) {
         const partial = renderer.getFullText().trim();
         if (partial) {
           agent.getMessages().push({ role: 'assistant', content: partial + '\n[response interrupted by user]' });
         }
         renderer.abort();
         CLITheme.warning('Generation interrupted (Esc).');
       } else {
         renderer.finish();
       }
       console.log();

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

       try {
         await agent.compressHistory(0.75);
       } catch {}

     } catch (error: any) {
      renderer.abort();
      console.log();
      const msg = error?.message || String(error);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        CLITheme.error(`Unable to connect to provider ${activeProvider.toUpperCase()} (${activeConfig.baseUrl}).`);
        CLITheme.warning(`Ensure server is running or use /provider to switch endpoint.`);
      } else if (msg.includes('401') || msg.includes('Incorrect API key') || msg.includes('Unauthorized')) {
        CLITheme.error(`Authentication failed for provider ${activeProvider.toUpperCase()}.`);
        CLITheme.warning(`Verify API key in .env or configure via /provider.`);
      } else {
        CLITheme.error(`Error during execution: ${msg}`);
      }
    } finally {
      interrupt.disarm();
    }

    CLITheme.printDivider();
  }
}

main().catch((err) => {
  CLITheme.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
