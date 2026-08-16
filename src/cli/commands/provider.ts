import { CommandCtx } from './types';
import { runBenchmark, ModelProfile } from '../../core/modelProfile';
import { probeProvider, warmUpModel, isLocalUrl, detectContextWindow } from '../../core/discovery';
import { CLITheme, InteractiveMenu } from '../ui';
import { notifyIfUnprofiled } from '../shared';
import chalk from 'chalk';
import prompts from 'prompts';

/**
 * Se il modello scelto è su un server locale e non è quello caricato in RAM,
 * propone di caricarlo subito (richiesta minima da 1 token): il server con
 * caricamento just-in-time fa lo swap ora, invece che a sorpresa alla prima
 * chat. `loadedModel` = modello attualmente in RAM (null se non rilevabile).
 */
async function maybeWarmUp(ctx: CommandCtx, selectedModel: string, loadedModel: string | null): Promise<void> {
  const baseUrl = ctx.provider.getBaseUrl();
  if (!isLocalUrl(baseUrl) || !loadedModel || loadedModel === selectedModel) return;

  console.log();
  const confirm = await prompts({
    type: 'confirm',
    name: 'ok',
    message: chalk.yellow(`Sul server è caricato '${loadedModel}'. Caricare adesso '${selectedModel}'? (lo swap può richiedere minuti)`),
    initial: true
  });
  if (!confirm.ok) {
    CLITheme.info('Il modello verrà caricato dal server alla prima richiesta.');
    return;
  }

  const spinner = CLITheme.createSpinner(`Caricamento di '${selectedModel}' sul server...`);
  spinner.start();
  const ok = await warmUpModel(baseUrl, ctx.configManager.getApiKey(), selectedModel);
  if (ok) {
    spinner.succeed(chalk.green(`Modello '${selectedModel}' caricato e pronto.`));
  } else {
    spinner.fail(chalk.red('Caricamento non riuscito (timeout o errore del server).'));
    CLITheme.warning('Il server proverà comunque a caricarlo alla prima richiesta.');
  }
}

export async function handleProvider(ctx: CommandCtx, arg: string): Promise<void> {
  let targetProvider = arg.toLowerCase();

  if (!targetProvider) {
    const currentProvider = ctx.configManager.getActiveProviderName();
    console.log();
    const selected = await InteractiveMenu.select<'ollama' | 'openrouter' | 'unsloth' | string>(
      'Seleziona il provider attivo (usa le frecce):',
      [
        { title: `Ollama ${currentProvider === 'ollama' ? '(selezionato)' : ''}`, value: 'ollama' },
        { title: `OpenRouter ${currentProvider === 'openrouter' ? '(selezionato)' : ''}`, value: 'openrouter' },
        { title: `Unsloth Studio ${currentProvider === 'unsloth' ? '(selezionato)' : ''}`, value: 'unsloth' }
      ],
      currentProvider
    );
    if (!selected) return;
    targetProvider = selected;
  }

  if (targetProvider !== 'ollama' && targetProvider !== 'openrouter' && targetProvider !== 'unsloth') {
    CLITheme.error('Specificare un provider valido: /provider ollama, openrouter o unsloth');
    return;
  }

  const target = targetProvider as 'ollama' | 'openrouter' | 'unsloth';
  ctx.configManager.setActiveProvider(target);
  const newConfig = ctx.configManager.getActiveProviderConfig();

  // Ripunta l'istanza condivisa al nuovo endpoint: i riferimenti esistenti restano validi
  ctx.provider.reconfigure(newConfig.baseUrl, ctx.configManager.getApiKey(), newConfig.model);

  ctx.agent.current = ctx.recreateAgent();
  CLITheme.success(`Provider cambiato a: ${chalk.green(target.toUpperCase())}`);

  const checkSpinner = CLITheme.createSpinner(`Verifica connessione a ${target}...`);
  checkSpinner.start();
  try {
    const models = await ctx.provider.listModels();
    ctx.availableModels.current = models;
    checkSpinner.succeed(chalk.green('Connessione stabilita!'));
    if (models.length > 0 && !models.includes(newConfig.model)) {
      ctx.provider.setCurrentModel(models[0]);
      ctx.configManager.updateActiveModel(models[0]);
      ctx.agent.current = ctx.recreateAgent();
    }
    CLITheme.success(`Modello attivo: ${chalk.green(ctx.provider.getCurrentModel())}`);
    notifyIfUnprofiled(ctx.provider.getCurrentModel());
  } catch (err: any) {
    checkSpinner.fail(chalk.red(`Impossibile verificare la connessione per ${target}.`));
    CLITheme.warning('Il provider è stato aggiornato, ma il server non risponde.');
  }
}

async function pickModel(ctx: CommandCtx): Promise<boolean> {
  const spinner = CLITheme.createSpinner('Recupero dei modelli...');
  spinner.start();
  try {
    // probeProvider fornisce sia la lista sia il modello caricato in RAM
    // (flag "loaded" di Unsloth/LM Studio, /api/ps di Ollama)
    const name = ctx.configManager.getActiveProviderName();
    const scan = await probeProvider(name, ctx.configManager.getActiveProviderConfig(), ctx.configManager.getApiKey());
    const models = scan ? scan.models : await ctx.provider.listModels();
    const loadedModel = scan?.loadedModel ?? null;
    ctx.availableModels.current = models;
    spinner.succeed(chalk.green('Modelli trovati!'));

    if (models.length === 0) {
      CLITheme.warning('Nessun modello disponibile su questo server.');
      return false;
    }

    const current = ctx.provider.getCurrentModel();
    console.log();
    const selectedModel = await InteractiveMenu.select<string>(
      'Seleziona il modello da utilizzare (usa le frecce):',
      models.map((m) => {
        const tags = [
          m === loadedModel ? chalk.green('● caricato') : '',
          m === current ? chalk.gray('(selezionato)') : '',
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
        CLITheme.info(`Finestra di contesto attiva: ${chalk.green(dynamicCtx.toLocaleString())} token (rilevata dal server)`);
      }
      await maybeWarmUp(ctx, selectedModel, loadedModel);
      notifyIfUnprofiled(selectedModel);
      return true;
    }
  } catch (err: any) {
    spinner.fail(chalk.red('Errore nel recupero della lista modelli.'));
    CLITheme.error(err.message);
  }
  return false;
}

export async function handleModels(ctx: CommandCtx, _arg: string): Promise<void> {
  await pickModel(ctx);
}

export async function handleUse(ctx: CommandCtx, arg: string): Promise<void> {
  if (!arg) {
    console.log(chalk.gray('Nessun modello specificato. Mostro la lista interattiva...'));
    await pickModel(ctx);
    return;
  }

  const spinner = CLITheme.createSpinner(`Controllo del modello '${arg}'...`);
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
        CLITheme.info(`Finestra di contesto attiva: ${chalk.green(dynamicCtx.toLocaleString())} token (rilevata dal server)`);
      }
      await maybeWarmUp(ctx, arg, scan?.loadedModel ?? null);
      notifyIfUnprofiled(arg);
    } else {
      CLITheme.error(`Il modello '${arg}' non è presente su questo server.`);
      console.log(chalk.gray(`Usa ${chalk.cyan('/models')} per vedere l'elenco.`));
    }
  } catch (err: any) {
    spinner.stop();
    const oldModel = ctx.provider.getCurrentModel();
    ctx.provider.setCurrentModel(arg);
    ctx.configManager.updateActiveModel(arg);
    ctx.agent.current = ctx.recreateAgent();
    CLITheme.printModelChanged(oldModel, arg);
    CLITheme.warning(`Modello impostato forzatamente a '${arg}' (errore di verifica server).`);
    notifyIfUnprofiled(arg);
  }
}

export async function handleSearchEngine(ctx: CommandCtx, _arg: string): Promise<void> {
  const currentEngine = ctx.configManager.getWebSearchProvider();
  console.log();
  const selected = await InteractiveMenu.select<'duckduckgo' | 'tavily' | 'google'>(
    'Seleziona il motore di ricerca web (usa le frecce):',
    [
      { title: `DuckDuckGo ${currentEngine === 'duckduckgo' ? '(selezionato)' : ''} - (Gratuito, nessun setup)`, value: 'duckduckgo' },
      { title: `Google Search ${currentEngine === 'google' ? '(selezionato)' : ''} - (Richiede GOOGLE_SEARCH_API_KEY in .env)`, value: 'google' },
      { title: `Tavily API ${currentEngine === 'tavily' ? '(selezionato)' : ''} - (Richiede TAVILY_API_KEY in .env)`, value: 'tavily' }
    ],
    currentEngine
  );

  if (selected) {
    ctx.configManager.setWebSearchProvider(selected);
    CLITheme.success(`Motore di ricerca web cambiato a: ${chalk.green(selected.toUpperCase())}`);
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
  console.log(`  Effort:      ${chalk.magenta(p.reasoningEffort)}`);
  console.log(`  Tier misurato: ${tierColor(p.tier.toUpperCase())}`);
  console.log(`  ├─ Instruction following: ${formatScore(p.scores.instruction)}`);
  console.log(`  ├─ Output JSON:           ${formatScore(p.scores.json)}`);
  console.log(`  ├─ Tool calling:          ${formatScore(p.scores.toolCalling)}`);
  console.log(`  ├─ Velocità:              ${chalk.cyan(p.tokensPerSecond + ' tok/s')}`);
  console.log(`  └─ Token di completamento medi: ${chalk.cyan(p.avgCompletionTokens)}`);
  if (p.testResults && p.testResults.length > 0) {
    console.log(chalk.gray(`  Test eseguiti (${p.testResults.length}, da benchmarks/):`));
    for (const t of p.testResults) {
      console.log(`    • ${t.name} ${chalk.gray(`[${t.category}]`)} → ${formatScore(t.score)}`);
    }
  }
}

export async function handleBenchmark(ctx: CommandCtx, arg: string): Promise<void> {
  const currentModel = ctx.provider.getCurrentModel();

  // Determina i modelli da testare
  let targets: string[] = [];
  if (!arg) {
    targets = [currentModel];
  } else if (arg.toLowerCase() === 'all') {
    const spinner = CLITheme.createSpinner('Recupero lista modelli...');
    spinner.start();
    try {
      targets = await ctx.provider.listModels();
      spinner.succeed(chalk.green(`${targets.length} modelli da testare.`));
    } catch (err: any) {
      spinner.fail(chalk.red('Impossibile recuperare la lista modelli.'));
      return;
    }
    if (targets.length === 0) {
      CLITheme.warning('Nessun modello disponibile sul server.');
      return;
    }
    CLITheme.warning(`Il benchmark di ${targets.length} modelli richiede più chiamate LLM per modello (l'intero set di test × 4 livelli di reasoning_effort): può durare diversi minuti.`);
  } else {
    targets = [arg];
  }

  console.log(chalk.bold('\n📊 [CAPABILITY FINGERPRINTING — Benchmark oggettivo del modello]\n'));

  for (const model of targets) {
    const spinner = CLITheme.createSpinner(`Benchmark di '${model}'...`);
    spinner.start();
    try {
      const { profiles, recommendedEffort } = await runBenchmark(ctx.provider, model, (step) => {
        spinner.text = chalk.cyan(`Benchmark di '${model}' — ${step}`);
      });
      spinner.succeed(chalk.green(`Benchmark completato per '${model}' (${profiles.length} livelli di reasoning_effort)`));
      for (const profile of profiles) {
        printProfile(profile);
        console.log();
      }
      if (recommendedEffort) {
        console.log(chalk.bold(`  🎯 Raccomandazione: ${chalk.magenta(recommendedEffort)}`) +
          chalk.gray(' — il livello più basso che raggiunge il tier più alto misurato.'));
      }
      console.log();
    } catch (err: any) {
      spinner.fail(chalk.red(`Benchmark fallito per '${model}': ${err.message}`));
    }
  }

  CLITheme.success('Profili salvati in models_profile.json (uno per livello di reasoning_effort). Il tier dei tool ora usa le capacità MISURATE del modello, alla condizione in cui gira davvero.');

  // Ricrea l'agente: il system prompt e i tool disponibili possono cambiare col nuovo tier
  ctx.agent.current = ctx.recreateAgent();
  console.log();
}
