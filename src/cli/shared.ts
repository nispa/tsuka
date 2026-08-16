import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../core/apphome';
import { TeamConfig } from '../core/types';

export type { TeamConfig };

export interface RoleConfig {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  reasoningEffort?: string;
  creativity?: string;
}

export interface TraitConfig {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
}

export interface CharacterConfig {
  name: string;
  displayName: string;
  aiName: string;
  role?: string;        // Legacy: 1 role
  roles?: string[];     // Multi-skill: unlocked roles/skills list
  activeRole?: string;  // Currently active skill
  trait: string;
  description: string;
  signature?: string;   // Optional signature summary for orchestrator
  reasoningEffort?: string;
  creativity?: string;
}

// ── JSON file loading helpers ──

const jsonFileCache = new Map<string, { mtimeMs: number; value: any }>();

export function loadJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = jsonFileCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.value as T;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const value = JSON.parse(raw) as T;
    jsonFileCache.set(filePath, { mtimeMs, value });
    return value;
  } catch (err: any) {
    console.error(`Error loading '${path.basename(filePath)}': ${err.message}`);
    return null;
  }
}

export function listAvailableItems<T>(dirName: string, loadFn: (name: string) => T | null): T[] {
  const items: T[] = [];
  try {
    const dir = homePath(dirName);
    if (fs.existsSync(dir)) {
      for (const file of fs.readdirSync(dir)) {
        if (file.endsWith('.json')) {
          const item = loadFn(path.basename(file, '.json'));
          if (item) items.push(item);
        }
      }
    }
  } catch (err: any) {
    console.error(`Error scanning '${dirName}': ${err.message}`);
  }
  return items;
}

// ── Roles, traits, characters, teams loaders ──

export function loadRole(roleName?: string): RoleConfig {
  if (!roleName) {
    return {
      name: 'developer',
      displayName: '💻 Sviluppatore Software',
      description: 'Focused on programming and workspace management.',
      systemPrompt: 'You are an expert Software Engineer. Analyze, write, and modify code in the workspace.',
      allowedTools: ['read_file', 'write_file', 'edit_file', 'list_dir']
    };
  }
  const role = loadJsonFile<RoleConfig>(homePath('roles', `${roleName}.json`));
  if (role) return role;
  return {
    name: 'developer',
    displayName: '💻 Sviluppatore Software',
    description: 'Focused on programming and workspace management.',
    systemPrompt: 'You are an expert Software Engineer. Analyze, write, and modify code in the workspace.',
    allowedTools: ['read_file', 'write_file', 'edit_file', 'list_dir']
  };
}

export function loadTrait(traitName?: string): TraitConfig {
  if (!traitName) {
    return {
      name: 'professional',
      displayName: '👔 Professionale / Standard',
      description: 'Sober, clear, balanced tone focused on technical facts.',
      prompt: 'Professional, balanced, sober tone. Technical details and precise data only. No personal comments or emotional digressions.'
    };
  }
  const trait = loadJsonFile<TraitConfig>(homePath('traits', `${traitName}.json`));
  if (trait) return trait;
  return {
    name: 'professional',
    displayName: '👔 Professionale / Standard',
    description: 'Sober, clear, balanced tone focused on technical facts.',
    prompt: 'Professional, balanced, sober tone. Technical details and precise data only. No personal comments or emotional digressions.'
  };
}

function normalizeName(name: string): string {
  return (name || '').toLowerCase().replace(/[\s_\-]/g, '');
}

export function loadCharacter(charName: string): CharacterConfig | null {
  if (charName === 'custom') return null;
  const charData = loadJsonFile<CharacterConfig>(homePath('characters', `${charName}.json`));
  if (!charData) return null;

  // Multi-skill backward compatibility initialization
  if (Array.isArray(charData.roles) && charData.roles.length > 0) {
    if (!charData.activeRole || !charData.roles.includes(charData.activeRole)) {
      charData.activeRole = charData.roles[0];
    }
  } else if (charData.role) {
    charData.roles = [charData.role];
    charData.activeRole = charData.role;
  }
  charData.role = charData.activeRole || charData.role || (charData.roles && charData.roles[0]) || 'developer';
  return charData;
}

export function loadTeam(teamName: string): TeamConfig | null {
  return loadJsonFile<TeamConfig>(homePath('teams', `${teamName}.json`));
}

export function listAvailableCharacters(): CharacterConfig[] {
  return listAvailableItems('characters', loadCharacter);
}

export function listAvailableTeams(): TeamConfig[] {
  return listAvailableItems('teams', loadTeam);
}

export function listAvailableRoles(): RoleConfig[] {
  return listAvailableItems('roles', loadRole);
}

/**
 * Resolves an agent identifier: file name -> aiName -> role / skill name.
 */
export function resolveCharacter(nameOrAiName: string): CharacterConfig | null {
  const direct = loadCharacter(nameOrAiName);
  if (direct) return direct;

  const target = normalizeName(nameOrAiName);
  if (!target) return null;

  const catalog = listAvailableCharacters();
  for (const charObj of catalog) {
    if (normalizeName(charObj.aiName) === target || normalizeName(charObj.name) === target) return charObj;
  }

  // Resolve by active role or multi-skill role
  const byActiveRole = catalog.find((c) => normalizeName(c.role || '') === target);
  if (byActiveRole) return byActiveRole;
  return catalog.find((c) => (c.roles || []).some((r) => normalizeName(r) === target)) || null;
}

import type { CreativityLevel } from '../core/provider';

/**
 * Resolves creativity sampling level: character -> active role -> config default.
 */
export function resolveCreativity(
  character: CharacterConfig | null | undefined,
  role: RoleConfig | null | undefined,
  configDefault?: CreativityLevel
): CreativityLevel | undefined {
  if (character?.creativity) {
    return character.creativity.toLowerCase() as CreativityLevel;
  }
  if (role?.creativity) {
    return role.creativity.toLowerCase() as CreativityLevel;
  }
  return configDefault;
}

// ── System Prompt Assembly ──

import { MemoryStore } from '../core/memory';
import { ToolRegistry } from '../tools/registry';

export function loadSystemPrompt(
  role: RoleConfig,
  trait: TraitConfig,
  modelName: string,
  registry?: ToolRegistry,
  character?: CharacterConfig | null,
  taskText?: string,
  effort?: ReasoningEffort
): string {
  let prompt = '';

  if (character) {
    prompt += `You are ${character.aiName}. Always respond, express yourself, and act as ${character.aiName}.\n\n`;
  }

  prompt += role.systemPrompt;
  prompt += `\n\nPersonality and communication style:\n${trait.prompt}`;
  prompt += `\n\nGeneral agent guidelines:
- Always use the appropriate tool when one exists (browse_url for web pages, web_search for online searches, read_file for files, etc.). Never output code or text when a tool can do it.
- Write/edit files incrementally when possible.
- Be cautious: only run system shell commands when strictly necessary and no other tool covers the task.
- Cite sources when doing web research or browsing URLs.`;

  const trimmedTask = (taskText || '').trim();
  const memorySources = character?.aiName ? [character.aiName] : undefined;
  const memorySection = trimmedTask
    ? MemoryStore.getInstance().formatRelevant(trimmedTask, 10, undefined, memorySources)
    : MemoryStore.getInstance().formatForPrompt(10, undefined, memorySources);
  if (memorySection) {
    prompt += `\n\nPersistent shared memory (facts from you and other agents, valid beyond this session):\n${memorySection}`;
  }

  if (registry) {
    const tools = registry.listForLLM(modelName, role.allowedTools, effort);
    if (tools.length > 0) {
      if (!hasNativeFunctionCalling(modelName, effort)) {
        prompt += `\n\nAvailable tools:\n`;
        for (const t of tools) {
          prompt += `- **${t.function.name}**: ${t.function.description}\n`;
        }
      }
      if (tools.some((t: any) => t.function.name === 'save_memory')) {
        prompt += `\nNote: you have persistent shared memory. Use **save_memory** for important facts to keep across sessions and **recall_memory** to retrieve them.`;
      }
    }
  }

  return prompt;
}

import chalk from 'chalk';
import { CLITheme } from './ui';
import { getModelProfile, getRecommendedEffort } from '../core/modelProfile';
import { getModelTier, hasNativeFunctionCalling } from '../tools/registry';
import type { ReasoningEffort } from '../core/provider';

/**
 * Warns if the active model lacks a benchmark capability profile.
 */
export function notifyIfUnprofiled(model: string, effort?: ReasoningEffort): void {
  if (!model) return;
  const profile = getModelProfile(model, effort);
  if (profile) {
    const recommended = getRecommendedEffort(model);
    if (recommended) {
      const matchHint = effort && effort === recommended ? chalk.green('(already active)') : chalk.cyan(`use /effort ${recommended} to configure`);
      CLITheme.info(`💡 Active benchmark profile: recommended effort ${chalk.magenta.bold(recommended.toUpperCase())} (${matchHint})`);
    }
    return;
  }
  const estimated = getModelTier(model, effort);
  CLITheme.warning(
    `Model not yet profiled: tier estimated by name = '${estimated}' (higher-tier tools remain hidden).`
  );
  CLITheme.info(`Run ${chalk.cyan('/benchmark')} to measure real capabilities and calibrate tier.`);
}
