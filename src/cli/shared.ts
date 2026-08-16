import * as fs from 'fs';
import * as path from 'path';
import { homePath } from '../core/apphome';
import { TeamConfig } from '../core/types';

// TeamConfig vive in core/types.ts (T4.1, PLANNING-QUALITA.md): riesportato qui per
// compatibilità con gli importatori esistenti (cli/index.ts, cli/commands/types.ts).
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
  role?: string;        // Legacy: 1 ruolo
  roles?: string[];     // Multi-skill: lista ruoli/skill sbloccate
  activeRole?: string;  // Skill correntemente equipaggiata
  trait: string;
  description: string;
  signature?: string;   // Firma sintetica opzionale per l'orchestrator
  reasoningEffort?: string;
  creativity?: string;
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

/** Chiave di confronto per i nomi: minuscolo e senza separatori (`Deanna_Troi` → `deannatroi`). */
function normalizeName(name: string): string {
  return (name || '').toLowerCase().replace(/[\s_\-]/g, '');
}

export function loadCharacter(charName: string): CharacterConfig | null {
  if (charName === 'custom') return null;
  const charData = loadJsonFile<CharacterConfig>(homePath('characters', `${charName}.json`));
  if (!charData) return null;

  // Inizializzazione Multi-Skill per retro-compatibilità
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

/** Team effettivamente installati in `teams/` (dipende dal preset scelto a `tsuka init`). */
export function listAvailableTeams(): TeamConfig[] {
  return listAvailableItems('teams', loadTeam);
}

/**
 * Risolve un riferimento a un agente, dal più specifico al più generico:
 * nome file → nome visibile (aiName) → MESTIERE (ruolo).
 *
 * L'ultimo livello è il punto: si può chiamare un agente per la competenza che
 * serve (`@security_auditor`) invece che per nome proprio. Il nome è solo
 * l'handle di chi quel mestiere lo esercita — e con il multi-skill (T9.1) lo
 * stesso handle risponde a più mestieri, evitando un passaggio di consegne
 * fatto solo per raggiungere il tool di un altro ruolo.
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

  // Ultimo livello: il riferimento è un mestiere. Preferisce chi ce l'ha come
  // ruolo attivo, poi chi lo possiede fra le skill sbloccate (multi-skill).
  const byActiveRole = catalog.find((c) => normalizeName(c.role || '') === target);
  if (byActiveRole) return byActiveRole;
  return catalog.find((c) => (c.roles || []).some((r) => normalizeName(r) === target)) || null;
}

import type { CreativityLevel } from '../core/provider';

/**
 * Risolve il livello di creatività (campionamento) seguendo la cascata:
 * personaggio -> ruolo attivo -> default di configurazione.
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

// ── Assemblaggio System Prompt ──

import { MemoryStore } from '../core/memory';
import { ToolRegistry } from '../tools/registry';

// ...

export function loadSystemPrompt(
  role: RoleConfig,
  trait: TraitConfig,
  modelName: string,
  registry?: ToolRegistry,
  character?: CharacterConfig | null,
  taskText?: string,
  // T8.12 (coda di T8.10): effort con cui il modello girerà davvero, per elencare nel
  // prompt lo stesso set di tool che Agent.run() renderà poi eseguibile (vedi agent.ts).
  // Opzionale e in coda per non rompere le chiamate esistenti: omesso, registry.listForLLM
  // ricade sul default prudente di getModelTier (comportamento identico a prima).
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

  // Iniezione della memoria (T6.1): se è disponibile un testo di task, la sezione
  // è basata sulla rilevanza al compito corrente (formatRelevant) invece che
  // semplicemente sui fatti più recenti; formatForPrompt() resta il fallback.
  //
  // Filtro per agente in lettura (T8.2): attivo solo quando è noto un `character.aiName`
  // (l'identità dell'agente che sta per ricevere questo prompt) — un agente vede i propri
  // fatti più quelli condivisibili per costruzione (lezione/decisione) di chiunque altro,
  // escluso lo scarto di run altrui. Senza character (es. chat "custom" senza personaggio),
  // nessun filtro: comportamento identico a prima.
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
      // T8.9 (Ridurre il costo fisso del prompt): i tool viaggiano già come array
      // `tools` nella richiesta API (provider.ts) — per un modello con function
      // calling nativo MISURATO come affidabile (hasNativeFunctionCalling,
      // registry.ts), riscriverli qui come elenco testuale è puro spreco di
      // contesto pagato a ogni chiamata. Per qualunque altro caso (nessun profilo,
      // o profilo sotto soglia) l'elenco resta: comportamento identico a prima,
      // rete di sicurezza per un modello di cui non sappiamo se legge bene l'array.
      if (!hasNativeFunctionCalling(modelName, effort)) {
        prompt += `\n\nAvailable tools:\n`;
        for (const t of tools) {
          prompt += `- **${t.function.name}**: ${t.function.description}\n`;
        }
      }
      // Nota d'uso su save_memory/recall_memory: NON è un elenco di tool, va
      // conservata a prescindere dall'elenco testuale sopra (Fuori scope di T8.9).
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
 * Avvisa se il modello attivo non ha un profilo di capacità misurato
 * (models_profile.json): in tal caso il tier dei tool è stimato con
 * l'euristica sul nome e può nascondere tool al modello. Suggerisce /benchmark.
 * Chiamata all'avvio e a ogni cambio di modello o provider.
 *
 * `effort` (T8.12, coda di T8.10): livello con cui il modello girerà, per verificare
 * la presenza del profilo alla chiave giusta ("modello@effort", vedi modelProfile.ts)
 * invece che sempre a 'xhigh'. Opzionale e in coda: omesso, comportamento identico a
 * prima (default prudente 'xhigh' dentro getModelProfile/getModelTier).
 */
export function notifyIfUnprofiled(model: string, effort?: ReasoningEffort): void {
  if (!model) return;
  const profile = getModelProfile(model, effort);
  if (profile) {
    const recommended = getRecommendedEffort(model);
    if (recommended) {
      const matchHint = effort && effort === recommended ? chalk.green('(già attivo)') : chalk.cyan(`usa /effort ${recommended} per impostarlo`);
      CLITheme.info(`💡 Profilo benchmark attivo: sforzo consigliato ${chalk.magenta.bold(recommended.toUpperCase())} (${matchHint})`);
    }
    return;
  }
  const estimated = getModelTier(model, effort);
  CLITheme.warning(
    `Modello non ancora profilato: tier stimato dal nome = '${estimated}' (i tool di tier superiore restano nascosti).`
  );
  CLITheme.info(`Lancia ${chalk.cyan('/benchmark')} per misurare le capacità reali e usare il tier corretto.`);
}
