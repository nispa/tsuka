#!/usr/bin/env node
import * as dotenv from 'dotenv';
import prompts from 'prompts';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import type { ILLMProvider } from '../core/provider';
import { homePath, loadEnvironmentVariables } from '../core/apphome';
import { ConfigManager } from '../core/config';
import { scanProviders, detectContextWindow } from '../core/discovery';
import { MemoryStore } from '../core/memory';
import { createHarnessRuntime } from '../core/runtime';
import { Agent, resolveReasoningEffort } from '../core/agent';
import { resolveToolSet } from '../core/toolSet';
import { getModelProfile, getRecommendedEffort } from '../core/modelProfile';
import { withEffortPin, confirmEffortDivergence, setEffortPin } from '../core/effortControl';
import type { ReasoningEffort } from '../core/provider';
import { CLITheme, InteractiveMenu } from './ui';
import { StreamRenderer } from './stream';
import { StatusLine } from './statusline';
import { askInput, setCompletionSource } from './input';
import { argumentCompletions, mentionCompletions } from './commands/completion';
import { lockRawMode } from './rawlock';
import { GenerationInterrupt } from './interrupt';
import { ContextTracker } from '../core/contextTracker';
import { getContextPressure } from '../core/contextBudget';
import {
  RoleConfig, TraitConfig, CharacterConfig, TeamConfig,
  loadJsonFile, listAvailableItems, listAvailableCharacters, listAvailableTeams, listAvailableRoles, resolveCharacter,
  loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, notifyIfUnprofiled
} from './shared';
import { CommandCtx } from './commands/types';
import { handleExit, handleInfo, handleReset } from './commands/session';
import { handleProvider, handleModels, handleSearchEngine, handleBenchmark } from './commands/provider';
import { handleAgent } from './commands/persona';
import { handleSudo } from './commands/sudo';
import { handleTools } from './commands/tools';
import { handleRuns } from './commands/runs';
import { handleMemory } from './commands/memory';
import { handleContext } from './commands/session';
import { handleCall } from './commands/call';
import { handleTeam } from './commands/team';
import { handleGoal } from './commands/goal';
import { handleEffort } from './commands/effort';
import { handleBlackboard } from './commands/blackboard';
import { handleExport } from './commands/exportSession';
import { listThinkingTraces, resolveThinkingTrace, buildResumeDirective } from './commands/continueSession';

import { handleInitCmd } from './initCmd';
import { launchTui } from '../tui/index';
import type { WorkflowDispatcher } from '../core/workflowDispatcher';
import { createCliPermissionPromptHandler } from './permissionPrompt';
import { setLogSink, logSink } from '../core/logSink';

export { RoleConfig, TraitConfig, CharacterConfig, TeamConfig };
export { loadRole, loadTrait, loadCharacter, loadTeam, loadSystemPrompt, listAvailableItems };

function createWorkflowDispatcher(ctx: CommandCtx): WorkflowDispatcher {
  return {
    runGoal: (goal) => handleGoal(ctx, goal),
    runTeam: (teamName, task) => handleTeam(ctx, teamName, task),
    runCall: (participants, topic) => handleCall(ctx, participants.join(' '), topic),
  };
}

// Load environment variables (.env) with hierarchical priority (root .env > .tsuka/.env > global .env)
loadEnvironmentVariables();

// SIGINT handler: resets terminal cursor and status line
process.on('SIGINT', () => {
  StatusLine.emergencyReset();
  logSink.log(chalk.yellow('\nExiting... Goodbye!'));
  process.exit(130);
});

async function main() {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0 && cliArgs[0] === 'init') {
    const success = await handleInitCmd(cliArgs.slice(1));
    process.exit(success ? 0 : 1);
  }

  const configManager = new ConfigManager();
  const isCliForced = cliArgs.includes('--cli') || cliArgs.includes('--repl');
  const isTuiForced = cliArgs.includes('--tui') || cliArgs.includes('tui');

  if (isTuiForced || (!isCliForced && configManager.getDefaultUi() === 'tui')) {
    await launchTui();
    return;
  }

  // The bare CLI owns stdout and can preserve chunk-level command streaming. Other
  // presentation layers replace this sink instead of competing for the terminal.
  setLogSink({
    log: (message) => console.log(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message),
    write: (message) => process.stdout.write(message),
  });

  // Lock raw mode across whole session to prevent Windows readline input wedge
  lockRawMode();

  CLITheme.banner();

  const runtime = await createHarnessRuntime({
    configManager,
    permissionHandler: createCliPermissionPromptHandler(),
    connectMcp: true,
  });
  const { permissionManager, registry, provider } = runtime;

  let activeProvider = configManager.getActiveProviderName();
  let activeConfig = configManager.getActiveProviderConfig();

  // Restore the last /effort choice persisted in tsuka.config.json as the startup pin,
  // so it must be set BEFORE the first recreateAgent() bakes effort into the agent.
  const savedEffort = configManager.getDefaultReasoningEffort();
  if (savedEffort) setEffortPin(savedEffort);

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

    const toolSet = resolveToolSet(role);

    const a = new Agent(
      provider,
      registry,
      permissionManager,
      loadSystemPrompt(role, trait, model, registry, char, undefined, reasoningEffort, provider.getBaseUrl(), provider.getProviderClass?.()),
      toolSet.active,
      configManager.getMaxHistoryMessages(),
      configManager.getMaxHistoryTokens(),
      char?.aiName || role.name,
      reasoningEffort,
      undefined,
      configManager.getMaxToolRounds()
    );
    a.setDeferredTools(toolSet.deferred);
    a.setRoleName(role.name);
    if (char) a.setCharName(char.aiName);
    a.setSubagentRunner(runtime.subagentRunner);
    if (configManager.isContextSchedulerEnabled()) {
      a.setContextScheduler({
        enabled: true,
        ...configManager.getContextSchedulerConfig(),
      });
    }
    if (typeof commandCtx !== 'undefined') {
      a.setWorkflowDispatcher(createWorkflowDispatcher(commandCtx));
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
      provider.reconfigure(activeConfig.baseUrl, configManager.getApiKey(), activeConfig.model, activeConfig.class);
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

      notifyIfUnprofiled(provider.getCurrentModel(), agent.getReasoningEffort(), provider.getBaseUrl(), activeConfig.class, activeConfig.displayName);
    }
  } else {
    initSpinner.fail(chalk.red('No configured LLM provider is reachable.'));
    CLITheme.warning('Check providers.json endpoints and the configured apiKeyEnv variables.');
    logSink.log(chalk.gray('  • To initialize a preset roster in workspace: ') + chalk.cyan('tsuka init --preset core\n'));
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
    subagentRunner: runtime.subagentRunner,
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
  agent.setWorkflowDispatcher(createWorkflowDispatcher(commandCtx));

  const commandMap: Record<string, (ctx: CommandCtx, arg: string) => Promise<void>> = {
    '/provider':   handleProvider,
    '/models':     handleModels,
    '/call':       handleCall,
    '/team':       handleTeam,
    '/goal':       handleGoal,
    '/agent':      handleAgent,
    '/tools':      handleTools,
    '/sudo':       handleSudo,
    '/runs':       handleRuns,
    '/benchmark':  handleBenchmark,
    '/memory':     handleMemory,
    '/context':    handleContext,
    '/effort':     handleEffort,
    '/blackboard': handleBlackboard,
    '/export':     handleExport,
    '/save':       handleExport,
    '/search-engine': handleSearchEngine,
  };

  setCompletionSource({
    commands: [...new Set([
      ...Object.keys(commandMap),
      '/clear', '/help', '/reset', '/info', '/exit', '/continue',
    ])].sort(),
    // Shared with the TUI suggestion menu: one table, not two drifting lists.
    argumentsFor: (command) => argumentCompletions(command, {
      models: () => commandCtx.availableModels.current,
      providers: () => configManager.getProviderNames(),
    }).map((item) => item.value),
    mentions: () => mentionCompletions().map((item) => item.value),
  });

  while (true) {
    const input = await askInput('User ❯');

    if (input === undefined) {
      logSink.log(chalk.yellow('\nExiting... Goodbye!'));
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
        logSink.log(chalk.yellow('Exiting... Goodbye!'));
        await runtime.close();
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
        await handleReset(commandCtx, arg);
        agent = commandCtx.agent.current;
        continue;
      }
      if (command === '/info') {
        await handleInfo(commandCtx, arg);
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
          logSink.log('');
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
        logSink.log('');

          try {
            if (agentRunStats) {
              const limitTokens = configManager.getMaxHistoryTokens();
              const lastPromptTokens = agentRunStats.lastPromptTokens ?? agentRunStats.promptTokens ?? 0;
              const peakPromptTokens = agentRunStats.peakPromptTokens ?? agentRunStats.promptTokens ?? 0;
              const usedTokens = lastPromptTokens > 0
                ? lastPromptTokens
                : agent.estimateTotalContextTokens();
              const pressure = getContextPressure(usedTokens, limitTokens);
              ContextTracker.getInstance().addEntry({
                timestamp: new Date().toISOString(),
                agentName: agentHeaderName,
                tokenCount: agentRunStats.tokenCount ?? 0,
                promptTokens: lastPromptTokens,
                peakPromptTokens: peakPromptTokens > 0 ? peakPromptTokens : undefined,
                action: trimmedInput.length > 80 ? trimmedInput.slice(0, 80) + '…' : trimmedInput,
                usedTokens: pressure.usedTokens,
                limitTokens: pressure.limitTokens,
                ratio: pressure.ratio,
                source: lastPromptTokens > 0 ? 'observed' : 'estimated',
              });
            }
          } catch {}

        try {
          await agent.compressHistory(0.75);
        } catch {}

      } catch (error: any) {
       renderer.abort();
       logSink.log('');
       const msg = error?.message || String(error);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        CLITheme.error(`Unable to connect to provider ${activeProvider.toUpperCase()} (${activeConfig.baseUrl}).`);
        CLITheme.warning(`Ensure server is running or use /provider to switch endpoint.`);
      } else if (msg.includes('401') || msg.includes('403') || msg.includes('Forbidden') || msg.includes('Incorrect API key') || msg.includes('Unauthorized')) {
        CLITheme.error(`Authentication / Authorization failed for provider ${activeProvider.toUpperCase()}.`);
        const keyEnv = activeConfig.apiKeyEnv;
        if (keyEnv) {
          CLITheme.warning(`Verify that ${keyEnv} is set in your .env or environment variables.`);
        } else {
          CLITheme.warning(`Verify API key in .env or configure via /provider.`);
        }
      } else {
        CLITheme.error(`Error during execution: ${msg}`);
      }
    } finally {
      interrupt.disarm();
    }

    CLITheme.printDivider();
  }

  await runtime.close();
}

main().catch((err) => {
  CLITheme.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
