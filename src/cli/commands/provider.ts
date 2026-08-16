import { CommandCtx } from './types';
import { runBenchmark, ModelProfile } from '../../core/modelProfile';
import { probeProvider, warmUpModel, isLocalUrl, detectContextWindow } from '../../core/discovery';
import { CLITheme, InteractiveMenu } from '../ui';
import { notifyIfUnprofiled } from '../shared';
import chalk from 'chalk';
import prompts from 'prompts';

async function maybeWarmUp(ctx: CommandCtx, selectedModel: string, loadedModel: string | null): Promise<void> {
  const baseUrl = ctx.provider.getBaseUrl();
  if (!isLocalUrl(baseUrl) || !loadedModel || loadedModel === selectedModel) return;

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

  const spinner = CLITheme.createSpinner(`Loading '${selectedModel}' on server...`);
  spinner.start();
  const ok = await warmUpModel(baseUrl, ctx.configManager.getApiKey(), selectedModel);
  if (ok) {
    spinner.succeed(chalk.green(`Model '${selectedModel}' loaded and ready.`));
  } else {
    spinner.fail(chalk.red('Warm up request failed (timeout or server error).'));
    CLITheme.warning('Server will attempt loading upon first chat request.');
  }
}

export async function handleProvider(ctx: CommandCtx, arg: string): Promise<void> {
  let targetProvider = arg.toLowerCase();

  if (!targetProvider) {
    const currentProvider = ctx.configManager.getActiveProviderName();
    console.log();
    const selected = await InteractiveMenu.select<'ollama' | 'openrouter' | 'unsloth' | string>(
      'Select active provider (use arrow keys):',
      [
        { title: `Ollama ${currentProvider === 'ollama' ? '(selected)' : ''}`, value: 'ollama' },
        { title: `OpenRouter ${currentProvider === 'openrouter' ? '(selected)' : ''}`, value: 'openrouter' },
        { title: `Unsloth Studio ${currentProvider === 'unsloth' ? '(selected)' : ''}`, value: 'unsloth' }
      ],
      currentProvider
    );
    if (!selected) return;
    targetProvider = selected;
  }

  if (targetProvider !== 'ollama' && targetProvider !== 'openrouter' && targetProvider !== 'unsloth') {
    CLITheme.error('Please specify a valid provider: /provider ollama, openrouter, or unsloth');
    return;
  }

  const target = targetProvider as 'ollama' | 'openrouter' | 'unsloth';
  ctx.configManager.setActiveProvider(target);
  const newConfig = ctx.configManager.getActiveProviderConfig();

  ctx.provider.reconfigure(newConfig.baseUrl, ctx.configManager.getApiKey(), newConfig.model);

  ctx.agent.current = ctx.recreateAgent();
  CLITheme.success(`Provider changed to: ${chalk.green(target.toUpperCase())}`);

  const checkSpinner = CLITheme.createSpinner(`Checking connection to ${target}...`);
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
    notifyIfUnprofiled(ctx.provider.getCurrentModel(), ctx.agent.current.getReasoningEffort());
  } catch (err: any) {
    checkSpinner.fail(chalk.red(`Could not verify connection for ${target}.`));
    CLITheme.warning('Provider configuration updated, but server is not responding.');
  }
}

async function pickModel(ctx: CommandCtx): Promise<boolean> {
  const spinner = CLITheme.createSpinner('Fetching available models...');
  spinner.start();
  try {
    const name = ctx.configManager.getActiveProviderName();
    const scan = await probeProvider(name, ctx.configManager.getActiveProviderConfig(), ctx.configManager.getApiKey());
    const models = scan ? scan.models : await ctx.provider.listModels();
    const loadedModel = scan?.loadedModel ?? null;
    ctx.availableModels.current = models;
    spinner.succeed(chalk.green('Models retrieved!'));

    if (models.length === 0) {
      CLITheme.warning('No models available on this server.');
      return false;
    }

    const current = ctx.provider.getCurrentModel();
    console.log();
    const selectedModel = await InteractiveMenu.select<string>(
      'Select model to activate (use arrow keys):',
      models.map((m) => {
        const tags = [
          m === loadedModel ? chalk.green('● loaded') : '',
          m === current ? chalk.gray('(selected)') : '',
        ].filter(Boolean).join(' ');
        return { title: tags ? `${m} ${tags}` : m, value: m };
      }),
      current
    );

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
      notifyIfUnprofiled(selectedModel, ctx.agent.current.getReasoningEffort());
      return true;
    }
  } catch (err: any) {
    spinner.fail(chalk.red('Failed to fetch models list.'));
    CLITheme.error(err.message);
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
      notifyIfUnprofiled(arg, ctx.agent.current.getReasoningEffort());
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
    notifyIfUnprofiled(arg, ctx.agent.current.getReasoningEffort());
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
    CLITheme.warning(`Benchmarking ${targets.length} models across 4 effort levels may take several minutes.`);
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
      });
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
      spinner.fail(chalk.red(`Benchmark failed for '${model}': ${err.message}`));
    }
  }

  CLITheme.success('Profiles saved in models_profile.json. Tool tiers now calibrated from measured capability profiles.');
  ctx.agent.current = ctx.recreateAgent();
  console.log();
}
