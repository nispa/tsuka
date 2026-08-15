import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import prompts from 'prompts';
import { getAppHome } from '../core/apphome';
import { probeProvider, scanProviders } from '../core/discovery';
import { ConfigManager } from '../core/config';

export interface InitOptions {
  preset?: 'core' | 'full';
  pack?: string[];
  force?: boolean;
  targetDir?: string;
  interactive?: boolean;
}

export function parseInitArgs(args: string[]): InitOptions {
  const opts: InitOptions = {
    preset: 'core',
    pack: [],
    force: false,
    interactive: args.length === 0
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force' || arg === '-f') {
      opts.force = true;
    } else if (arg === '--preset' && args[i + 1]) {
      const p = args[++i].toLowerCase();
      if (p === 'core' || p === 'full') {
        opts.preset = p as 'core' | 'full';
      }
    } else if (arg.startsWith('--preset=')) {
      const p = arg.split('=')[1].toLowerCase();
      if (p === 'core' || p === 'full') {
        opts.preset = p as 'core' | 'full';
      }
    } else if (arg === '--pack' && args[i + 1]) {
      opts.pack = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith('--pack=')) {
      opts.pack = arg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  return opts;
}

interface PresetManifest {
  name: string;
  roles?: string[];
  traits?: string[];
  characters?: string[];
  teams?: string[];
}

function copyCategoryAssets(
  appHome: string,
  targetTsukaDir: string,
  category: 'roles' | 'traits' | 'characters' | 'teams',
  names: string[]
): void {
  const srcDir = path.join(appHome, category);
  const destDir = path.join(targetTsukaDir, category);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const name of names) {
    const fileName = `${name}.json`;
    const srcFile = path.join(srcDir, fileName);
    const destFile = path.join(destDir, fileName);
    if (fs.existsSync(srcFile)) {
      fs.copyFileSync(srcFile, destFile);
    }
  }
}

function copyAllCategoryAssets(
  appHome: string,
  targetTsukaDir: string,
  category: 'roles' | 'traits' | 'characters' | 'teams'
): void {
  const srcDir = path.join(appHome, category);
  const destDir = path.join(targetTsukaDir, category);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }
}

export async function handleInitCmd(rawArgs: string[] = [], customTargetDir?: string): Promise<boolean> {
  const opts = parseInitArgs(rawArgs);
  const targetDir = customTargetDir || opts.targetDir || process.cwd();
  const tsukaDir = path.join(targetDir, '.tsuka');

  if (opts.interactive && process.stdin.isTTY) {
    console.log(chalk.bold.cyan('\n🚀 TSUKA — Inizializzazione Workspace\n'));
    const response = await prompts([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Inizializzare TSUKA nella cartella corrente (${targetDir})?`,
        initial: true
      },
      {
        type: (prev) => (prev ? 'select' : null),
        name: 'preset',
        message: 'Seleziona il preset iniziale:',
        choices: [
          { title: 'Core (7 personaggi principali, raccomandato)', value: 'core' },
          { title: 'Full (tutti i 23 personaggi ed i 7 team)', value: 'full' }
        ],
        initial: 0
      }
    ]);

    if (!response.confirm) {
      console.log(chalk.gray('Inizializzazione annullata.'));
      return false;
    }
    opts.preset = response.preset || 'core';
  }

  if (fs.existsSync(tsukaDir) && !opts.force) {
    console.log(chalk.yellow(`\n⚠️ La cartella .tsuka/ esiste già in ${targetDir}.`));
    console.log(chalk.gray(`Usa '${chalk.white('tsuka init --force')}' per sovrascrivere la configurazione esistente.\n`));
    return false;
  }

  console.log(chalk.bold.blue(`\n[INIT] Preparazione workspace in: ${chalk.cyan(tsukaDir)}`));

  // Creazione struttura directory
  const subDirs = ['memory', 'workflow_logs', 'output', 'roles', 'traits', 'characters', 'teams'];
  fs.mkdirSync(tsukaDir, { recursive: true });
  for (const dir of subDirs) {
    fs.mkdirSync(path.join(tsukaDir, dir), { recursive: true });
  }

  const appHome = getAppHome();

  // Copia asset in base al preset
  if (opts.preset === 'full') {
    copyAllCategoryAssets(appHome, tsukaDir, 'roles');
    copyAllCategoryAssets(appHome, tsukaDir, 'traits');
    copyAllCategoryAssets(appHome, tsukaDir, 'characters');
    copyAllCategoryAssets(appHome, tsukaDir, 'teams');
    console.log(chalk.green('  ✔ Copiati tutti i ruoli, tratti, personaggi e team (preset full).'));
  } else {
    // Preset core
    const coreManifestPath = path.join(appHome, 'presets', 'core.json');
    if (fs.existsSync(coreManifestPath)) {
      const manifest: PresetManifest = JSON.parse(fs.readFileSync(coreManifestPath, 'utf-8'));
      copyCategoryAssets(appHome, tsukaDir, 'roles', manifest.roles || []);
      copyCategoryAssets(appHome, tsukaDir, 'traits', manifest.traits || []);
      copyCategoryAssets(appHome, tsukaDir, 'characters', manifest.characters || []);
      copyCategoryAssets(appHome, tsukaDir, 'teams', manifest.teams || []);
      console.log(chalk.green(`  ✔ Copiato preset core (${manifest.characters?.length || 0} personaggi).`));
    }
  }

  // Copia eventuali pack specificati
  if (opts.pack && opts.pack.length > 0) {
    for (const packName of opts.pack) {
      const packManifestPath = path.join(appHome, 'presets', 'packs', `${packName}.json`);
      if (fs.existsSync(packManifestPath)) {
        const packManifest: PresetManifest = JSON.parse(fs.readFileSync(packManifestPath, 'utf-8'));
        copyCategoryAssets(appHome, tsukaDir, 'roles', packManifest.roles || []);
        copyCategoryAssets(appHome, tsukaDir, 'traits', packManifest.traits || []);
        copyCategoryAssets(appHome, tsukaDir, 'characters', packManifest.characters || []);
        copyCategoryAssets(appHome, tsukaDir, 'teams', packManifest.teams || []);
        console.log(chalk.green(`  ✔ Copiato pack '${packName}'.`));
      } else {
        console.log(chalk.yellow(`  ⚠️ Pack '${packName}' non trovato in presets/packs/. Saltato.`));
      }
    }
  }

  // Discovery server e generazione config.json
  console.log(chalk.blue('  🔍 Scansione server LLM disponibili...'));
  let bestProvider: string | null = null;
  let bestModel: string | null = null;

  try {
    const candidates = [
      { name: 'unsloth', config: { baseUrl: 'http://127.0.0.1:8888/v1', model: 'unsloth' }, apiKey: 'local' },
      { name: 'ollama', config: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' }, apiKey: 'local' }
    ];
    const found = await scanProviders(candidates, 'unsloth');
    if (found) {
      bestProvider = found.name;
      bestModel = found.loadedModel || found.models[0] || found.config.model;
    }
  } catch {}

  const defaultConfigPath = path.join(appHome, 'tsuka.config.json');
  let baseConfig: any = {
    activeProvider: 'unsloth',
    providers: {
      ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
      openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
      unsloth: { baseUrl: 'http://127.0.0.1:8888/v1', model: 'unsloth' }
    },
    webSearch: { provider: 'duckduckgo' },
    activeRole: 'developer',
    activeTrait: 'professional',
    activeCharacter: 'dev'
  };

  if (fs.existsSync(defaultConfigPath)) {
    try {
      baseConfig = { ...baseConfig, ...JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8')) };
    } catch {}
  }

  if (bestProvider && bestModel) {
    baseConfig.activeProvider = bestProvider;
    if (baseConfig.providers[bestProvider]) {
      baseConfig.providers[bestProvider].model = bestModel;
    }
    console.log(chalk.green(`  ✔ Rilevato server LLM attivo: ${bestProvider} (${bestModel})`));
  } else {
    console.log(chalk.yellow('  ⚠️ Nessun server LLM locale risponde al momento. Configurazione creata con valori predefiniti.'));
  }

  const destConfigPath = path.join(tsukaDir, 'config.json');
  fs.writeFileSync(destConfigPath, JSON.stringify(baseConfig, null, 2), 'utf-8');
  console.log(chalk.green('  ✔ Configurazione salvata in .tsuka/config.json'));

  console.log(chalk.bold.green('\n🎉 Workspace TSUKA inizializzato con successo!'));
  console.log(chalk.bold('\nProssimi passi consigliati:'));
  console.log(`  • Esegui ${chalk.cyan('/benchmark')} per calibrare le capacità del tuo modello.`);
  console.log(`  • Avvia un goal complesso con ${chalk.cyan('/goal "Istruzioni..."')}.`);
  console.log(`  • Configura il tuo provider preferito con ${chalk.cyan('/provider')}.\n`);

  return true;
}
