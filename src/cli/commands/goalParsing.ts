import { PlanStep } from '../../core/types';
import { CharacterConfig } from '../shared';

export interface PlanGroup {
  mode: 'sequential' | 'parallel';
  steps: PlanStep[];
  label: string;
}

export interface ParseResult {
  groups: PlanGroup[];
  flatSteps: number;
}

function normalizeCharName(name: string): string {
  return (name || '').toLowerCase().replace(/[\s_\-]/g, '');
}

function lookupValidName(name: string, validMap?: Map<string, string> | (CharacterConfig | string)[]): string | null {
  if (!validMap) return name;
  const normalized = normalizeCharName(name);
  if (validMap instanceof Map) {
    return validMap.get(normalized) || null;
  }
  if (Array.isArray(validMap)) {
    for (const item of validMap) {
      if (typeof item === 'string') {
        if (normalizeCharName(item) === normalized) return item;
      } else if (item && typeof item === 'object') {
        if (item.name && normalizeCharName(item.name) === normalized) return item.name;
        if (item.aiName && normalizeCharName(item.aiName) === normalized) return item.name;
      }
    }
  }
  return null;
}

/** Parses an AGENTE: / AGENT: / @name line across varying formatting. */
export function parseAgentLine(
  lines: string[],
  startIdx: number,
  validMap?: Map<string, string> | (CharacterConfig | string)[]
): { realName: string; name: string; task: string; consumed: number } | null {
  const rawLine = lines[startIdx].trim();
  const cleanLine = rawLine
    .replace(/^(?:\d+\.|\*|-)\s*/, '')
    .replace(/\*\*/g, '')
    .trim();

  const FLEXIBLE_RE = /^(?:AGENTE|AGENT)?:\s*@?([a-zA-Z0-9_\-\s]+?)\s*(?:[—–\-:]|->|=>|\|)\s*(.*)/i;
  const AT_DIRECT_RE = /^@([a-zA-Z0-9_\-\s]+?)\s*(?:[—–\-:]|->|=>|\|)\s*(.*)/i;

  let match = cleanLine.match(FLEXIBLE_RE);
  if (!match) {
    match = cleanLine.match(AT_DIRECT_RE);
  }

  if (!match) return null;

  const rawName = match[1].trim();
  const realName = lookupValidName(rawName, validMap);
  if (!realName) return null;

  let task = match[2]?.trim() || '';
  let consumed = 1;

  if (!task || /^[—–\-:]\s*$/.test(task)) {
    const taskLines: string[] = [];
    for (let j = startIdx + 1; j < lines.length; j++) {
      const nextRaw = lines[j].trim();
      const nextClean = nextRaw.replace(/^(?:\d+\.|\*|-)\s*/, '').replace(/\*\*/g, '').trim();
      if (/^(?:AGENTE|AGENT)?:\s*@/i.test(nextClean) || /^PARALLELO/i.test(nextClean) || /^FINE\b/i.test(nextClean)) break;
      taskLines.push(nextClean);
      consumed++;
    }
    task = taskLines.filter(Boolean).join(' ').trim();
  }

  return { realName, name: realName, task, consumed };
}

export function parsePlan(
  content: string,
  allCharacters: (CharacterConfig | string)[],
  parallelEnabled: boolean = true
): ParseResult {
  const groups: PlanGroup[] = [];
  const lines = content.split('\n');
  const validMap = new Map<string, string>();
  for (const item of allCharacters) {
    if (typeof item === 'string') {
      validMap.set(normalizeCharName(item), item);
    } else if (item && typeof item === 'object') {
      if (item.name) validMap.set(normalizeCharName(item.name), item.name);
      if (item.aiName) validMap.set(normalizeCharName(item.aiName), item.name);
    }
  }

  let flatSteps = 0;
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i].trim();
    const line = rawLine.replace(/^(?:\d+\.|\*|-)\s*/, '').replace(/\*\*/g, '').trim();

    // Parallel block
    if (/^PARALLELO/i.test(line)) {
      i++;
      const parallelSteps: PlanStep[] = [];
      while (i < lines.length) {
        const subLine = lines[i].trim().replace(/^(?:\d+\.|\*|-)\s*/, '').replace(/\*\*/g, '').trim();
        if (/^FINE\s*PARALLELO/i.test(subLine)) break;

        const step = parseAgentLine(lines, i, validMap);
        if (step) {
          parallelSteps.push({ agentName: step.realName, task: step.task });
          i += step.consumed;
        } else {
          i++;
        }
      }
      if (parallelSteps.length > 0) {
        if (parallelEnabled) {
          groups.push({
            mode: 'parallel',
            steps: parallelSteps,
            label: `Parallelo (${parallelSteps.map((s) => s.agentName).join(' + ')})`
          });
        } else {
          for (const step of parallelSteps) {
            groups.push({ mode: 'sequential', steps: [step], label: step.task });
          }
        }
        flatSteps += parallelSteps.length;
      }
      i++;
      continue;
    }

    // Single agent step
    const step = parseAgentLine(lines, i, validMap);
    if (step) {
      groups.push({
        mode: 'sequential',
        steps: [{ agentName: step.realName, task: step.task }],
        label: step.realName
      });
      flatSteps++;
      i += step.consumed;
    } else {
      i++;
    }
  }

  return { groups, flatSteps };
}
