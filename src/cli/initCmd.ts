import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import prompts from 'prompts';
import { getAppHome } from '../core/apphome';
import { scanProviders } from '../core/discovery';
import { loadProviderCatalog } from '../core/providerCatalog';
import { defaultAppConfig } from '../core/config';
import { logSink } from '../core/logSink';

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
    logSink.log(chalk.bold.cyan('\n🚀 TSUKA — Workspace Initialization\n'));
    const response = await prompts([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Initialize TSUKA in current workspace (${targetDir})?`,
        initial: true
      },
      {
        type: (prev) => (prev ? 'select' : null),
        name: 'preset',
        message: 'Select preset:',
        choices: [
          { title: 'Core (recommended default set)', value: 'core' },
          { title: 'Full (all characters and teams)', value: 'full' }
        ],
        initial: 0
      }
    ]);

    if (!response.confirm) {
      logSink.log(chalk.gray('Initialization canceled.'));
      return false;
    }
    opts.preset = response.preset || 'core';
  }

  if (fs.existsSync(tsukaDir) && !opts.force) {
    logSink.log(chalk.yellow(`\n⚠️ Directory .tsuka/ already exists in ${targetDir}.`));
    logSink.log(chalk.gray(`Use '${chalk.white('tsuka init --force')}' to overwrite existing configuration.\n`));
    return false;
  }

  logSink.log(chalk.bold.blue(`\n[INIT] Setting up workspace in: ${chalk.cyan(tsukaDir)}`));

  // Directory scaffolding
  const subDirs = ['memory', 'workflow_logs', 'output', 'roles', 'traits', 'characters', 'teams'];
  fs.mkdirSync(tsukaDir, { recursive: true });
  for (const dir of subDirs) {
    fs.mkdirSync(path.join(tsukaDir, dir), { recursive: true });
  }

  const appHome = getAppHome();
  fs.copyFileSync(path.join(appHome, 'providers.json'), path.join(tsukaDir, 'providers.json'));

  // Copy assets based on chosen preset
  if (opts.preset === 'full') {
    copyAllCategoryAssets(appHome, tsukaDir, 'roles');
    copyAllCategoryAssets(appHome, tsukaDir, 'traits');
    copyAllCategoryAssets(appHome, tsukaDir, 'characters');
    copyAllCategoryAssets(appHome, tsukaDir, 'teams');
    logSink.log(chalk.green('  ✔ Copied all roles, traits, characters, and teams (preset full).'));
  } else {
    const coreManifestPath = path.join(appHome, 'presets', 'core.json');
    if (fs.existsSync(coreManifestPath)) {
      const manifest: PresetManifest = JSON.parse(fs.readFileSync(coreManifestPath, 'utf-8'));
      copyCategoryAssets(appHome, tsukaDir, 'roles', manifest.roles || []);
      copyCategoryAssets(appHome, tsukaDir, 'traits', manifest.traits || []);
      copyCategoryAssets(appHome, tsukaDir, 'characters', manifest.characters || []);
      copyCategoryAssets(appHome, tsukaDir, 'teams', manifest.teams || []);
      logSink.log(chalk.green(`  ✔ Copied core preset (${manifest.characters?.length || 0} characters).`));
    }
  }

  // Copy additional packs if requested
  if (opts.pack && opts.pack.length > 0) {
    for (const packName of opts.pack) {
      const packManifestPath = path.join(appHome, 'presets', 'packs', `${packName}.json`);
      if (fs.existsSync(packManifestPath)) {
        const packManifest: PresetManifest = JSON.parse(fs.readFileSync(packManifestPath, 'utf-8'));
        copyCategoryAssets(appHome, tsukaDir, 'roles', packManifest.roles || []);
        copyCategoryAssets(appHome, tsukaDir, 'traits', packManifest.traits || []);
        copyCategoryAssets(appHome, tsukaDir, 'characters', packManifest.characters || []);
        copyCategoryAssets(appHome, tsukaDir, 'teams', packManifest.teams || []);
        logSink.log(chalk.green(`  ✔ Copied pack '${packName}'.`));
      } else {
        logSink.log(chalk.yellow(`  ⚠️ Pack '${packName}' not found in presets/packs/. Skipped.`));
      }
    }
  }

  // Probe server discovery and generate config.json
  logSink.log(chalk.blue('  🔍 Scanning for available LLM servers...'));
  let bestProvider: string | null = null;
  let bestModel: string | null = null;

  try {
    const catalog = loadProviderCatalog(path.join(appHome, 'providers.json'));
    const candidates = Object.entries(catalog).map(([name, definition]) => ({
      name,
      config: {
        baseUrl: definition.baseUrl,
        model: definition.defaultModel,
        class: definition.class,
        displayName: definition.displayName,
        apiKeyEnv: definition.apiKeyEnv,
        capabilities: definition.capabilities,
      },
      apiKey: definition.apiKeyEnv ? process.env[definition.apiKeyEnv] ?? '' : 'local',
    }));
    const found = await scanProviders(candidates, candidates[0]?.name ?? '');
    if (found) {
      bestProvider = found.name;
      bestModel = found.loadedModel || found.models[0] || found.config.model;
    }
  } catch {}

  const defaultConfigPath = path.join(appHome, 'tsuka.config.json');
  let baseConfig: any = defaultAppConfig();

  if (fs.existsSync(defaultConfigPath)) {
    try {
      baseConfig = { ...baseConfig, ...JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8')) };
    } catch {}
  }

  if (bestProvider && bestModel) {
    baseConfig.activeProvider = bestProvider;
    baseConfig.providerOverrides ??= {};
    baseConfig.providerOverrides[bestProvider] = { model: bestModel };
    logSink.log(chalk.green(`  ✔ Detected active LLM server: ${bestProvider} (${bestModel})`));
  } else {
    logSink.log(chalk.yellow('  ⚠️ No local LLM server reachable at the moment. Created default configuration.'));
  }

  const destConfigPath = path.join(tsukaDir, 'config.json');
  fs.writeFileSync(destConfigPath, JSON.stringify(baseConfig, null, 2), 'utf-8');
  logSink.log(chalk.green('  ✔ Configuration saved in .tsuka/config.json'));

  logSink.log(chalk.bold.green('\n🎉 TSUKA workspace initialized successfully!'));
  logSink.log(chalk.bold('\nRecommended next steps:'));
  logSink.log(`  • Run ${chalk.cyan('/benchmark')} to profile model performance.`);
  logSink.log(`  • Launch an agent goal with ${chalk.cyan('/goal "Instructions..."')}.`);
  logSink.log(`  • Configure providers via ${chalk.cyan('/provider')}.\n`);

  return true;
}
