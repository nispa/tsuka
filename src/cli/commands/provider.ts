import { CommandCtx } from './types';
import { LLMProvider } from '../../core/provider';
import { runBenchmark, ModelProfile } from '../../core/modelProfile';
import { CLITheme, InteractiveMenu } from '../ui';
import { notifyIfUnprofiled } from '../shared';
import chalk from 'chalk';

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

  const newProvider = new LLMProvider(newConfig.baseUrl, ctx.configManager.getApiKey(), newConfig.model);
  // Aggiorna il provider nel contesto (mutazione dell'oggetto condiviso)
  Object.assign(ctx.provider, newProvider);

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
    const models = await ctx.provider.listModels();
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
      models.map((m) => ({
        title: m === current ? `${m} (selezionato)` : m,
        value: m,
      })),
      current
    );

    if (selectedModel) {
      const oldModel = ctx.provider.getCurrentModel();
      ctx.provider.setCurrentModel(selectedModel);
      ctx.configManager.updateActiveModel(selectedModel);
      ctx.agent.current = ctx.recreateAgent();
      CLITheme.printModelChanged(oldModel, selectedModel);
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
    const models = await ctx.provider.listModels();
    ctx.availableModels.current = models;
    spinner.stop();

    if (models.includes(arg)) {
      const oldModel = ctx.provider.getCurrentModel();
      ctx.provider.setCurrentModel(arg);
      ctx.configManager.updateActiveModel(arg);
      ctx.agent.current = ctx.recreateAgent();
      CLITheme.printModelChanged(oldModel, arg);
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

function printProfile(p: ModelProfile): void {
  const tierColor = p.tier === 'large' ? chalk.green : p.tier === 'medium' ? chalk.yellow : chalk.red;
  console.log(`  Modello:     ${chalk.cyan(p.model)}`);
  console.log(`  Tier misurato: ${tierColor(p.tier.toUpperCase())}`);
  console.log(`  ├─ Instruction following: ${p.scores.instruction ? chalk.green('OK') : chalk.red('FALLITO')}`);
  console.log(`  ├─ Output JSON:           ${p.scores.json ? chalk.green('OK') : chalk.red('FALLITO')}`);
  console.log(`  ├─ Function calling:      ${p.scores.toolCalling === 1 ? chalk.green('OK') : p.scores.toolCalling === 0.5 ? chalk.yellow('PARZIALE') : chalk.red('FALLITO')}`);
  console.log(`  └─ Velocità:              ${chalk.cyan(p.tokensPerSecond + ' tok/s')}`);
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
    CLITheme.warning(`Il benchmark di ${targets.length} modelli richiede 3 chiamate LLM per modello: può durare diversi minuti.`);
  } else {
    targets = [arg];
  }

  console.log(chalk.bold('\n📊 [CAPABILITY FINGERPRINTING — Benchmark oggettivo del modello]\n'));

  for (const model of targets) {
    const spinner = CLITheme.createSpinner(`Benchmark di '${model}'...`);
    spinner.start();
    try {
      const profile = await runBenchmark(ctx.provider, model, (step) => {
        spinner.text = chalk.cyan(`Benchmark di '${model}' — ${step}`);
      });
      spinner.succeed(chalk.green(`Benchmark completato per '${model}'`));
      printProfile(profile);
      console.log();
    } catch (err: any) {
      spinner.fail(chalk.red(`Benchmark fallito per '${model}': ${err.message}`));
    }
  }

  CLITheme.success('Profilo salvato in models_profile.json. Il tier dei tool ora usa le capacità MISURATE del modello.');

  // Ricrea l'agente: il system prompt e i tool disponibili possono cambiare col nuovo tier
  ctx.agent.current = ctx.recreateAgent();
  console.log();
}
