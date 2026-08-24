import { CommandCtx } from './types';
import { ConfigManager } from '../../core/config';
import { runBenchmark, ModelProfile } from '../../core/modelProfile';
import { probeProvider, warmUpModel, isLocalUrl, detectContextWindow } from '../../core/discovery';
import { CLITheme, InteractiveMenu } from '../ui';
import { notifyIfUnprofiled } from '../shared';
import { filterOpenRouterModels, ModelCatalogFilter } from '../../core/modelCatalog';
import { isOpenRouterProvider } from '../../tools/registry';
import chalk from 'chalk';
import prompts from 'prompts';

const CHANGE_PROVIDER = '__change_provider__';
const SHOW_FREE_MODELS = '__show_free_models__';
const SHOW_ALL_MODELS = '__show_all_models__';

function formatProviderName(name: string): string {
  if (name === 'openrouter') return 'OpenRouter';
  if (name === 'ollama') return 'Ollama';
  if (name === 'unsloth') return 'Unsloth Studio';
  return name;
}

function activateProvider(ctx: CommandCtx, target: string): boolean {
  const config = ctx.configManager.getProviderConfig(target);
  if (!config) return false;
  ctx.configManager.setActiveProvider(target);
  ctx.provider.reconfigure(config.baseUrl, ctx.configManager.getApiKey(), config.model);
  ctx.agent.current = ctx.recreateAgent();
  return true;
}

/**
 * Sends the real warm-up request (a 1-token completion, forcing the server to load the model)
 * with a spinner reporting progress — TUI-safe since T14.17 (no raw stdout, no confirmation
 * prompt to render). Callers decide *whether* to ask first; this just does the loading once
 * that's settled. A no-op for anything but a local server with a genuinely different model
 * already in RAM.
 */
export async function warmUpIfNeeded(
  baseUrl: string,
  apiKey: string,
  selectedModel: string,
  loadedModel: string | null
): Promise<void> {
  if (!isLocalUrl(baseUrl) || !loadedModel || loadedModel === selectedModel) return;

  const spinner = CLITheme.createSpinner(`Loading '${selectedModel}' on server...`);
  spinner.start();
  const ok = await warmUpModel(baseUrl, apiKey, selectedModel);
  if (ok) {
    spinner.succeed(chalk.green(`Model '${selectedModel}' loaded and ready.`));
  } else {
    spinner.fail(chalk.red('Warm up request failed (timeout or server error).'));
    CLITheme.warning('Server will attempt loading upon first chat request.');
  }
}

/**
 * Full "make sure this model is actually loaded" sequence for a caller with no prompt to render
 * (the TUI's own `/models`, or a non-interactive `/models <name>`): probes what the server has
 * loaded right now, then warms up the target if it differs — unasked, since T14.19 found the
 * alternative isn't "ask safely", it's "silently defer the load to the user's next chat
 * message" (the TUI's model-switch paths never called any warm-up at all).
 */
export async function syncModelOnServer(configManager: ConfigManager, targetModel: string): Promise<void> {
  const providerName = configManager.getActiveProviderName();
  const activeConfig = configManager.getActiveProviderConfig();
  const apiKey = configManager.getApiKey();
  const scan = await probeProvider(providerName, activeConfig, apiKey);
  if (!scan) return;
  await warmUpIfNeeded(activeConfig.baseUrl, apiKey, targetModel, scan.loadedModel);
}

async function maybeWarmUp(ctx: CommandCtx, selectedModel: string, loadedModel: string | null): Promise<void> {
  const baseUrl = ctx.provider.getBaseUrl();
  if (!isLocalUrl(baseUrl) || !loadedModel || loadedModel === selectedModel) return;
  if (process.env.TSUKA_TUI || (ctx as any).isTui || !process.stdin.isTTY) return; // TUI/non-interactive: caller uses syncModelOnServer/warmUpIfNeeded directly, unasked

  console.log();
  const confirm = await prompts({
    type: 'confirm',
    name: 'ok',
    message: chalk.yellow(`Server currently has '${loadedModel}' loaded in RAM. Warm up '${selectedModel}' now? (model swap may take minutes)`),
    initial: true
  });
  if (!confirm.ok) {
    CLITheme.info('Model will be loaded by the server upon first request.');
    return;
  }

  await warmUpIfNeeded(baseUrl, ctx.configManager.getApiKey(), selectedModel, loadedModel);
}

export async function handleProvider(ctx: CommandCtx, arg: string): Promise<void> {
  let targetProvider = arg.toLowerCase();
  const providerNames = ctx.configManager.getProviderNames();

  if (!targetProvider) {
    const currentProvider = ctx.configManager.getActiveProviderName();
    console.log();
    const selected = await InteractiveMenu.select<string>(
      'Select active provider (use arrow keys):',
      providerNames.map((name) => ({
        title: `${formatProviderName(name)} ${currentProvider === name ? '(selected)' : ''}`,
        value: name,
      })),
      currentProvider
    );
    if (!selected) return;
    targetProvider = selected;
  }

  if (!providerNames.includes(targetProvider)) {
    CLITheme.error(`Please specify a configured provider: ${providerNames.join(', ')}`);
    return;
  }

  activateProvider(ctx, targetProvider);
  const newConfig = ctx.configManager.getActiveProviderConfig();
  CLITheme.success(`Provider changed to: ${chalk.green(targetProvider.toUpperCase())}`);

  const checkSpinner = CLITheme.createSpinner(`Checking connection to ${targetProvider}...`);
  checkSpinner.start();
  try {
    const models = await ctx.provider.listModels();
    ctx.availableModels.current = models;
    checkSpinner.succeed(chalk.green('Connection established!'));
    if (models.length > 0 && !models.includes(newConfig.model)) {
      ctx.provider.setCurrentModel(models[0]);
      ctx.configManager.updateActiveModel(models[0]);
      ctx.agent.current = ctx.recreateAgent();
    }
    CLITheme.success(`Active model: ${chalk.green(ctx.provider.getCurrentModel())}`);
    notifyIfUnprofiled(
      ctx.provider.getCurrentModel(),
      ctx.agent.current.getReasoningEffort(),
      ctx.provider.getBaseUrl()
    );
  } catch (err: any) {
    checkSpinner.fail(chalk.red(`Could not verify connection for ${targetProvider}.`));
    CLITheme.warning('Provider configuration updated, but server is not responding.');
  }
}

async function pickProviderForModels(ctx: CommandCtx): Promise<boolean> {
  const currentProvider = ctx.configManager.getActiveProviderName();
  const providerNames = ctx.configManager.getProviderNames();
  console.log();
  const selected = await InteractiveMenu.select<string>(
    'Select the provider whose models you want to use:',
    providerNames.map((name) => ({
      title: `${formatProviderName(name)} ${currentProvider === name ? '(selected)' : ''}`,
      value: name,
    })),
    currentProvider
  );
  if (!selected || !activateProvider(ctx, selected)) return false;
  CLITheme.success(`Provider changed to: ${chalk.green(selected.toUpperCase())}`);
  return pickModel(ctx, false);
}

async function pickModel(
  ctx: CommandCtx,
  offerProviderSwitch = true,
  catalogFilter: ModelCatalogFilter = 'all'
): Promise<boolean> {
  const spinner = CLITheme.createSpinner('Fetching available models...');
  spinner.start();
  try {
    const name = ctx.configManager.getActiveProviderName();
    const scan = await probeProvider(name, ctx.configManager.getActiveProviderConfig(), ctx.configManager.getApiKey());
    const allModels = scan ? scan.models : await ctx.provider.listModels();
    const models = filterOpenRouterModels(name, allModels, catalogFilter, scan?.zeroPricedModels);
    const loadedModel = scan?.loadedModel ?? null;
    ctx.availableModels.current = allModels;
    spinner.succeed(chalk.green('Models retrieved!'));

    if (models.length === 0) {
      if (name === 'openrouter' && catalogFilter === 'free') {
        CLITheme.warning('OpenRouter returned no free models.');
        return pickModel(ctx, offerProviderSwitch, 'all');
      }
      CLITheme.warning('No models available on this server.');
      if (offerProviderSwitch) return pickProviderForModels(ctx);
      return false;
    }

    const current = ctx.provider.getCurrentModel();
    console.log();
    const selectedModel = await InteractiveMenu.select<string>(
      'Select model to activate (use arrow keys):',
      [
        ...(offerProviderSwitch ? [{ title: chalk.cyan('⇄ Change provider…'), value: CHANGE_PROVIDER }] : []),
        ...(name === 'openrouter' ? [{
          title: catalogFilter === 'free'
            ? chalk.cyan('◉ Show all OpenRouter models')
            : chalk.green('○ Free models only'),
          value: catalogFilter === 'free' ? SHOW_ALL_MODELS : SHOW_FREE_MODELS,
        }] : []),
        ...models.map((m) => {
        const tags = [
          m === loadedModel ? chalk.green('● loaded') : '',
          m === current ? chalk.gray('(selected)') : '',
        ].filter(Boolean).join(' ');
        return { title: tags ? `${m} ${tags}` : m, value: m };
        }),
      ],
      current
    );

    if (selectedModel === CHANGE_PROVIDER) return pickProviderForModels(ctx);
    if (selectedModel === SHOW_FREE_MODELS) return pickModel(ctx, offerProviderSwitch, 'free');
    if (selectedModel === SHOW_ALL_MODELS) return pickModel(ctx, offerProviderSwitch, 'all');
    if (selectedModel) {
      const oldModel = ctx.provider.getCurrentModel();
      ctx.provider.setCurrentModel(selectedModel);
      ctx.configManager.updateActiveModel(selectedModel);
      ctx.agent.current = ctx.recreateAgent();
      CLITheme.printModelChanged(oldModel, selectedModel);
      const dynamicCtx = scan?.contextWindow ?? (await detectContextWindow(ctx.configManager.getActiveProviderConfig().baseUrl, ctx.configManager.getApiKey(), selectedModel));
      if (dynamicCtx) {
        ctx.configManager.setRuntimeContextTokens(dynamicCtx);
        CLITheme.info(`Active context window: ${chalk.green(dynamicCtx.toLocaleString())} tokens (detected from server)`);
      }
      await maybeWarmUp(ctx, selectedModel, loadedModel);
      notifyIfUnprofiled(selectedModel, ctx.agent.current.getReasoningEffort(), ctx.provider.getBaseUrl());
      return true;
    }
  } catch (err: any) {
    spinner.fail(chalk.red('Failed to fetch models list.'));
    CLITheme.error(err.message);
    if (offerProviderSwitch) return pickProviderForModels(ctx);
  }
  return false;
}

export async function handleModels(ctx: CommandCtx, arg: string): Promise<void> {
  if (!arg) {
    await pickModel(ctx);
    return;
  }

  const spinner = CLITheme.createSpinner(`Checking model '${arg}'...`);
  spinner.start();
  try {
    const name = ctx.configManager.getActiveProviderName();
    const scan = await probeProvider(name, ctx.configManager.getActiveProviderConfig(), ctx.configManager.getApiKey());
    const models = scan ? scan.models : await ctx.provider.listModels();
    ctx.availableModels.current = models;
    spinner.stop();

    if (models.includes(arg)) {
      const oldModel = ctx.provider.getCurrentModel();
      ctx.provider.setCurrentModel(arg);
      ctx.configManager.updateActiveModel(arg);
      ctx.agent.current = ctx.recreateAgent();
      CLITheme.printModelChanged(oldModel, arg);
      const dynamicCtx = scan?.contextWindow ?? (await detectContextWindow(ctx.configManager.getActiveProviderConfig().baseUrl, ctx.configManager.getApiKey(), arg));
      if (dynamicCtx) {
        ctx.configManager.setRuntimeContextTokens(dynamicCtx);
        CLITheme.info(`Active context window: ${chalk.green(dynamicCtx.toLocaleString())} tokens (detected from server)`);
      }
      await maybeWarmUp(ctx, arg, scan?.loadedModel ?? null);
      notifyIfUnprofiled(arg, ctx.agent.current.getReasoningEffort(), ctx.provider.getBaseUrl());
    } else {
      CLITheme.error(`Model '${arg}' not found on active server.`);
      console.log(chalk.gray(`Use ${chalk.cyan('/models')} without arguments to open interactive menu.`));
    }
  } catch (err: any) {
    spinner.stop();
    const oldModel = ctx.provider.getCurrentModel();
    ctx.provider.setCurrentModel(arg);
    ctx.configManager.updateActiveModel(arg);
    ctx.agent.current = ctx.recreateAgent();
    CLITheme.printModelChanged(oldModel, arg);
    CLITheme.warning(`Model set to '${arg}' (server verification failed).`);
    notifyIfUnprofiled(arg, ctx.agent.current.getReasoningEffort(), ctx.provider.getBaseUrl());
  }
}

export async function handleSearchEngine(ctx: CommandCtx, _arg: string): Promise<void> {
  const currentEngine = ctx.configManager.getWebSearchProvider();
  console.log();
  const selected = await InteractiveMenu.select<'duckduckgo' | 'tavily' | 'google'>(
    'Select web search provider (use arrow keys):',
    [
      { title: `DuckDuckGo ${currentEngine === 'duckduckgo' ? '(selected)' : ''} - (Free, no setup required)`, value: 'duckduckgo' },
      { title: `Google Search ${currentEngine === 'google' ? '(selected)' : ''} - (Requires GOOGLE_SEARCH_API_KEY in .env)`, value: 'google' },
      { title: `Tavily API ${currentEngine === 'tavily' ? '(selected)' : ''} - (Requires TAVILY_API_KEY in .env)`, value: 'tavily' }
    ],
    currentEngine
  );

  if (selected) {
    ctx.configManager.setWebSearchProvider(selected);
    CLITheme.success(`Web search provider updated to: ${chalk.green(selected.toUpperCase())}`);
  }
}

function formatScore(score: number): string {
  const pct = Math.round(score * 100) + '%';
  if (score >= 0.75) return chalk.green(pct);
  if (score >= 0.4) return chalk.yellow(pct);
  return chalk.red(pct);
}

function printProfile(p: ModelProfile): void {
  const tierColor = p.tier === 'large' ? chalk.green : p.tier === 'medium' ? chalk.yellow : chalk.red;
  console.log(`  Effort:          ${chalk.magenta(p.reasoningEffort)}`);
  console.log(`  Measured Tier:   ${tierColor(p.tier.toUpperCase())}`);
  console.log(`  ├─ Instruction following: ${formatScore(p.scores.instruction)}`);
  console.log(`  ├─ Output JSON:           ${formatScore(p.scores.json)}`);
  console.log(`  ├─ Tool calling:          ${formatScore(p.scores.toolCalling)}`);
  console.log(`  ├─ Speed:                 ${chalk.cyan(p.tokensPerSecond + ' tok/s')}`);
  console.log(`  └─ Avg Completion Tokens: ${chalk.cyan(p.avgCompletionTokens)}`);
  if (p.testResults && p.testResults.length > 0) {
    console.log(chalk.gray(`  Tests executed (${p.testResults.length}, from benchmarks/):`));
    for (const t of p.testResults) {
      console.log(`    • ${t.name} ${chalk.gray(`[${t.category}]`)} → ${formatScore(t.score)}`);
    }
  }
}

export async function handleBenchmark(ctx: CommandCtx, arg: string): Promise<void> {
  const currentModel = ctx.provider.getCurrentModel();

  // OpenRouter models are cloud-curated and receive tier large by policy. Avoid a
  // costly five-level sweep, including effort=none requests rejected by endpoints
  // that require reasoning, when the result cannot change tool visibility.
  if (isOpenRouterProvider(ctx.provider.getBaseUrl())) {
    const targetLabel = arg && arg.toLowerCase() !== 'all'
      ? `'${arg}'`
      : arg.toLowerCase() === 'all'
        ? 'all OpenRouter models'
        : `'${currentModel}'`;
    CLITheme.info(
      `OpenRouter cloud policy assigns tier LARGE to ${targetLabel}. ` +
      'No benchmark requests were sent.'
    );
    return;
  }

  let targets: string[] = [];
  if (!arg) {
    targets = [currentModel];
  } else if (arg.toLowerCase() === 'all') {
    const spinner = CLITheme.createSpinner('Retrieving models list...');
    spinner.start();
    try {
      targets = await ctx.provider.listModels();
      spinner.succeed(chalk.green(`${targets.length} model(s) to benchmark.`));
    } catch (err: any) {
      spinner.fail(chalk.red('Failed to retrieve models list.'));
      return;
    }
    if (targets.length === 0) {
      CLITheme.warning('No models available on server.');
      return;
    }
    CLITheme.warning(`Benchmarking ${targets.length} models across 5 effort levels may take several minutes.`);
  } else {
    targets = [arg];
  }

  console.log(chalk.bold('\n📊 [CAPABILITY FINGERPRINTING — Model Benchmark]\n'));

  for (const model of targets) {
    const spinner = CLITheme.createSpinner(`Benchmarking '${model}'...`);
    spinner.start();
    try {
      const { profiles, recommendedEffort } = await runBenchmark(ctx.provider, model, (step) => {
        spinner.text = chalk.cyan(`Benchmarking '${model}' — ${step}`);
      }, ctx.interrupt?.signal);
      if (ctx.interrupt?.aborted) {
        spinner.stop();
        CLITheme.warning('Benchmark interrupted by user. No incomplete profile was saved.');
        return;
      }
      spinner.succeed(chalk.green(`Benchmark completed for '${model}' (${profiles.length} effort levels)`));
      for (const profile of profiles) {
        printProfile(profile);
        console.log();
      }
      if (recommendedEffort) {
        const bestProfile = profiles.find((p) => p.reasoningEffort === recommendedEffort) ?? profiles[0];
        const tierStr = bestProfile?.tier ? bestProfile.tier.toUpperCase() : 'STANDARD';
        const speedStr = bestProfile?.tokensPerSecond ? `${bestProfile.tokensPerSecond} tok/s` : '';
        console.log(chalk.bold(`  🎯 Recommended reasoning effort: ${chalk.magenta(recommendedEffort.toUpperCase())}`));
        console.log(chalk.gray(`     ├─ Rationale: at '${recommendedEffort}' effort, model reaches max tier (${tierStr})`));
        console.log(chalk.gray(`     │  and passes tests with optimal speed${speedStr ? ` (~${speedStr})` : ''}.`));
        console.log(chalk.cyan(`     └─ 👉 Use `) + chalk.bold.green(`/effort ${recommendedEffort}`) + chalk.cyan(` to apply recommended setting.`));
      }
      console.log();
    } catch (err: any) {
      if (ctx.interrupt?.aborted) {
        spinner.stop();
        CLITheme.warning('Benchmark interrupted by user. No incomplete profile was saved.');
        return;
      }
      spinner.fail(chalk.red(`Benchmark failed for '${model}': ${err.message}`));
    }
  }

  CLITheme.success('Profiles saved in models_profile.json. Tool tiers now calibrated from measured capability profiles.');
  ctx.agent.current = ctx.recreateAgent();
  console.log();
}
