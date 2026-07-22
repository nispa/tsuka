import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../core/apphome';

export interface RoleConfig {
  name: string;
  displayName: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
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
  role: string;
  trait: string;
  description: string;
}

export interface TeamConfig {
  name: string;
  displayName: string;
  description: string;
  members: string[];
}

// ── Helpers di caricamento JSON ──

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
    console.error(`Errore nel caricamento di '${path.basename(filePath)}': ${err.message}`);
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
    console.error(`Errore nella scansione di '${dirName}': ${err.message}`);
  }
  return items;
}

// ── Caricamento ruoli, tratti, personaggi, team ──

export function loadRole(roleName: string): RoleConfig {
  const role = loadJsonFile<RoleConfig>(homePath('roles', `${roleName}.json`));
  if (role) return role;
  return {
    name: 'developer',
    displayName: '💻 Sviluppatore Software',
    description: 'Focalizzato su programmazione e workspace.',
    systemPrompt: 'Sei un Ingegnere del Software esperto. Il tuo compito è analizzare, scrivere e modificare codice nel workspace.',
    allowedTools: ['read_file', 'write_file', 'edit_file', 'list_dir']
  };
}

export function loadTrait(traitName: string): TraitConfig {
  const trait = loadJsonFile<TraitConfig>(homePath('traits', `${traitName}.json`));
  if (trait) return trait;
  return {
    name: 'professional',
    displayName: '👔 Professionale / Standard',
    description: 'Tono sobrio, chiaro ed equilibrato.',
    prompt: 'Adotta un tono di risposta strettamente professionale, equilibrato e sobrio. Evita divagazioni emotive.'
  };
}

export function loadCharacter(charName: string): CharacterConfig | null {
  if (charName === 'custom') return null;
  return loadJsonFile<CharacterConfig>(homePath('characters', `${charName}.json`));
}

export function loadTeam(teamName: string): TeamConfig | null {
  return loadJsonFile<TeamConfig>(homePath('teams', `${teamName}.json`));
}

export function listAvailableCharacters(): CharacterConfig[] {
  return listAvailableItems('characters', loadCharacter);
}

export function resolveCharacter(nameOrAiName: string): CharacterConfig | null {
  const direct = loadCharacter(nameOrAiName);
  if (direct) return direct;
  const target = nameOrAiName.toLowerCase();
  for (const charObj of listAvailableCharacters()) {
    if (charObj.aiName.toLowerCase() === target) return charObj;
  }
  return null;
}

// ── Assemblaggio System Prompt ──

import { MemoryStore } from '../core/memory';
import { ToolRegistry } from '../tools/registry';

// ...

export function loadSystemPrompt(
  role: RoleConfig,
  trait: TraitConfig,
  modelName: string,
  registry?: ToolRegistry,
  character?: CharacterConfig | null
): string {
  let prompt = '';

  if (character) {
    prompt += `Il tuo nome è ${character.aiName}. Rispondi sempre presentandoti, esprimendoti o agendo con il nome di ${character.aiName}.\n\n`;
  }

  prompt += role.systemPrompt;
  prompt += `\n\nAttitudine e stile comunicativo da adottare obbligatoriamente:\n${trait.prompt}`;
  prompt += `\n\nLinee guida generali per l'Agente:
- REGOLA FONDAMENTALE: se esiste un tool adatto al compito richiesto (es. browse_url per leggere un sito web, web_search per cercare online, read_file per leggere un file), usalo SEMPRE. Non rispondere MAI con script o codice testuale per compiti che un tool disponibile può svolgere direttamente.
- Quando scrivi o modifichi file nel workspace, fallo in modo incrementale per quanto possibile.
- Sii prudente: esegui comandi shell di sistema solo quando strettamente necessario per la richiesta e non coperti da altri tool.
- Se devi fare ricerche su internet o navigare indirizzi web, cita sempre le fonti informative utili.`;

  const memorySection = MemoryStore.getInstance().formatForPrompt();
  if (memorySection) {
    prompt += `\n\nMemoria condivisa persistente (fatti salvati da te e dagli altri agenti, validi anche oltre questa sessione):\n${memorySection}`;
  }

  if (registry) {
    const tools = registry.listForLLM(modelName, role.allowedTools);
    if (tools.length > 0) {
      prompt += `\n\nStrumenti (tool) utilizzabili in questa sessione:\n`;
      for (const t of tools) {
        prompt += `- **${t.function.name}**: ${t.function.description}\n`;
      }
      if (tools.some((t: any) => t.function.name === 'save_memory')) {
        prompt += `\nNota: hai una memoria condivisa persistente. Usa **save_memory** per fatti importanti da conservare oltre la sessione e **recall_memory** per ritrovarli.`;
      }
    }
  }

  return prompt;
}

import chalk from 'chalk';
import { CLITheme } from './ui';
import { getModelProfile } from '../core/modelProfile';
import { getModelTier } from '../tools/registry';

/**
 * Avvisa se il modello attivo non ha un profilo di capacità misurato
 * (models_profile.json): in tal caso il tier dei tool è stimato con
 * l'euristica sul nome e può nascondere tool al modello. Suggerisce /benchmark.
 * Chiamata all'avvio e a ogni cambio di modello o provider.
 */
export function notifyIfUnprofiled(model: string): void {
  if (!model) return;
  if (getModelProfile(model)) return;
  const estimated = getModelTier(model);
  CLITheme.warning(
    `Modello non ancora profilato: tier stimato dal nome = '${estimated}' (i tool di tier superiore restano nascosti).`
  );
  CLITheme.info(`Lancia ${chalk.cyan('/benchmark')} per misurare le capacità reali e usare il tier corretto.`);
}
