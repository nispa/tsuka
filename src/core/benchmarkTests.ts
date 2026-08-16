import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homePath } from './apphome';
import { repairJsonString, sanitizeToolCallArguments } from '../tools/jsonRepair';
import type { ILLMProvider, ChatOptions } from './provider';

/**
 * File-driven benchmark: capability fingerprinting tests live in `benchmarks/*.json`
 * and can be customized or added without code changes. Each file declares prompts,
 * offered tools, and declarative weighted checks producing a 0..1 score.
 *
 * The test suite hash is saved inside model profiles: altering benchmark files
 * automatically invalidates previous benchmark runs.
 */

export type BenchCategory = 'instruction' | 'json' | 'toolCalling';

export interface BenchCheck {
  /** Verification type (see CHECK_TYPES) */
  type: string;
  /** Expected value (word, number, regex pattern, tool name, etc.) */
  value?: any;
  /** For tool_arg_* checks: argument name of the tool call */
  arg?: string;
  /** For json_path_* checks: object path in parsed JSON (e.g. "items[0].name") */
  path?: string;
  /** Regex flags (default "i" for contains/not_contains, "" for regex) */
  flags?: string;
  /** Check weight in overall test score (default: 1) */
  weight?: number;
}

export interface BenchStep {
  /** User message initiating the step */
  prompt?: string;
  /** Tool result content to return for previous step's tool call */
  toolResult?: string;
  checks: BenchCheck[];
}

export interface BenchTest {
  name: string;
  description?: string;
  category: BenchCategory;
  /** Weight of the test within its category average (default: 1) */
  weight?: number;
  /** Tools (OpenAI schema) provided to the model during the test */
  tools?: any[];
  /** Short form: single prompt + checks */
  prompt?: string;
  checks?: BenchCheck[];
  /** Extended form: multi-turn tool calling steps */
  steps?: BenchStep[];
}

export interface BenchTestResult {
  name: string;
  category: BenchCategory;
  score: number; // 0..1
}

export const CHECK_TYPES = [
  'word_count', 'line_count', 'first_word', 'last_word',
  'contains', 'not_contains', 'regex', 'not_regex', 'not_empty',
  'json_valid', 'json_path_equals', 'json_path_type', 'json_path_length',
  'tool_called', 'tool_not_called', 'tool_arg_equals', 'tool_arg_regex',
] as const;

const CATEGORIES: BenchCategory[] = ['instruction', 'json', 'toolCalling'];
const BENCH_DIR = homePath('benchmarks');

// ── Test loading and suite hashing ──

/**
 * Loads and validates all tests from benchmarks/*.json (sorted by filename).
 * Throws a descriptive error on the first malformed test.
 */
export function loadBenchmarkTests(dir: string = BENCH_DIR): BenchTest[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const tests: BenchTest[] = [];
  for (const file of files) {
    const full = path.join(dir, file);
    let test: BenchTest;
    try {
      test = JSON.parse(fs.readFileSync(full, 'utf-8'));
    } catch (e: any) {
      throw new Error(`Malformed benchmark test file (${file}): ${e.message}`);
    }
    validateTest(test, file);
    tests.push(test);
  }
  return tests;
}

function validateTest(test: BenchTest, file: string): void {
  const fail = (msg: string) => { throw new Error(`Invalid benchmark test (${file}): ${msg}`); };
  if (!test.name || typeof test.name !== 'string') fail('missing "name" field');
  if (!CATEGORIES.includes(test.category)) fail(`"category" must be one of: ${CATEGORIES.join(', ')}`);
  const steps = normalizeSteps(test);
  if (steps.length === 0) fail('must provide "prompt"+"checks" or "steps"');
  if (!steps[0].prompt) fail('first step must include a "prompt"');
  for (const step of steps) {
    if (!step.prompt && !step.toolResult) fail('each step requires "prompt" or "toolResult"');
    if (!Array.isArray(step.checks) || step.checks.length === 0) fail('each step requires at least one check');
    for (const c of step.checks) {
      if (!CHECK_TYPES.includes(c.type as any)) fail(`unknown check type: "${c.type}"`);
    }
  }
}

export function normalizeSteps(test: BenchTest): BenchStep[] {
  if (test.steps && test.steps.length > 0) return test.steps;
  if (test.prompt && test.checks) return [{ prompt: test.prompt, checks: test.checks }];
  return [];
}

/**
 * Short hash (8 hex chars) of all test files to detect test suite changes.
 */
let hashCache: { key: string; hash: string } | null = null;
export function getBenchmarkTestsHash(dir: string = BENCH_DIR): string {
  try {
    if (!fs.existsSync(dir)) return 'none';
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    if (files.length === 0) return 'none';
    const key = files.map((f) => f + ':' + fs.statSync(path.join(dir, f)).mtimeMs).join('|');
    if (hashCache && hashCache.key === key) return hashCache.hash;
    const h = crypto.createHash('md5');
    for (const f of files) {
      h.update(f);
      h.update(fs.readFileSync(path.join(dir, f), 'utf-8'));
    }
    const hash = h.digest('hex').slice(0, 8);
    hashCache = { key, hash };
    return hash;
  } catch {
    return 'none';
  }
}

// ── Check evaluations ──

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter((w) => w.length > 0);
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Strips edge punctuation from a word (e.g. "blue." -> "blue"). */
function stripEdgePunct(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Extracts and parses the first JSON block from text with auto-repair. */
export function extractJson(text: string): any | null {
  try {
    const outcome = repairJsonString(text);
    return outcome ? outcome.parsed : null;
  } catch {
    return null;
  }
}

/** Navigates nested path notation like "items[0].name" within an object. */
export function deepGet(obj: any, pathStr: string): any {
  const tokens = pathStr.split('.').flatMap((seg) => seg.split(/[\[\]]/).filter((t) => t.length > 0));
  let cur = obj;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[/^\d+$/.test(t) ? Number(t) : t];
  }
  return cur;
}

function parseArgs(tc: any): any {
  if (!tc || !tc.function) return {};
  const raw = tc.function.arguments;
  return typeof raw === 'string' ? sanitizeToolCallArguments(raw).parsed : (raw || {});
}

/** Lenient equality: compares numbers as numbers, other types as string values. */
function looseEquals(actual: any, expected: any): boolean {
  if (typeof expected === 'number') return Number(actual) === expected;
  return String(actual) === String(expected);
}

export function checkPasses(check: BenchCheck, content: string, toolCalls?: any[]): boolean {
  const text = content.trim();
  const firstCall = toolCalls?.[0];
  switch (check.type) {
    case 'word_count': return words(text).length === check.value;
    case 'line_count': return nonEmptyLines(text).length === check.value;
    case 'first_word': return stripEdgePunct(words(text)[0] ?? '') === String(check.value);
    case 'last_word': {
      const ws = words(text);
      return stripEdgePunct(ws[ws.length - 1] ?? '') === String(check.value);
    }
    case 'contains': return new RegExp(escapeRegex(String(check.value)), check.flags ?? 'i').test(text);
    case 'not_contains': return !new RegExp(escapeRegex(String(check.value)), check.flags ?? 'i').test(text);
    case 'regex': return new RegExp(String(check.value), check.flags ?? '').test(text);
    case 'not_regex': return !new RegExp(String(check.value), check.flags ?? '').test(text);
    case 'not_empty': return text.length > 0;
    case 'json_valid': return extractJson(text) !== null;
    case 'json_path_equals': {
      const obj = extractJson(text);
      return obj !== null && looseEquals(deepGet(obj, check.path ?? ''), check.value);
    }
    case 'json_path_type': {
      const obj = extractJson(text);
      if (obj === null) return false;
      const v = deepGet(obj, check.path ?? '');
      return check.value === 'array' ? Array.isArray(v) : typeof v === check.value;
    }
    case 'json_path_length': {
      const obj = extractJson(text);
      if (obj === null) return false;
      const v = deepGet(obj, check.path ?? '');
      return Array.isArray(v) && v.length === check.value;
    }
    case 'tool_called': return !!firstCall && firstCall.function.name === check.value;
    case 'tool_not_called': return !toolCalls || toolCalls.length === 0;
    case 'tool_arg_equals': return !!firstCall && looseEquals(parseArgs(firstCall)[check.arg ?? ''], check.value);
    case 'tool_arg_regex':
      return !!firstCall && new RegExp(String(check.value), check.flags ?? 'i').test(String(parseArgs(firstCall)[check.arg ?? ''] ?? ''));
    default: return false;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Test execution ──

export interface BenchRunOutcome {
  score: number; // 0..1
  tokensPerSecond?: number;
  /** Average completion tokens across executed steps (T8.10). */
  avgCompletionTokens?: number;
}

/**
 * Executes a single benchmark test against the provider.
 */
export async function runBenchTest(provider: ILLMProvider, test: BenchTest, chatOptions?: ChatOptions): Promise<BenchRunOutcome> {
  const steps = normalizeSteps(test);
  const messages: any[] = [];
  let gained = 0;
  let total = 0;
  let tokensPerSecond: number | undefined;
  let completionTokensSum = 0;
  let completionTokensCount = 0;
  let prevToolCall: any = null;
  let chainBroken = false;

  for (const step of steps) {
    const stepWeight = step.checks.reduce((s, c) => s + (c.weight ?? 1), 0);
    total += stepWeight;
    if (chainBroken) continue;

    if (step.toolResult !== undefined) {
      if (!prevToolCall) { chainBroken = true; continue; }
      messages.push({ role: 'assistant', content: null, tool_calls: [prevToolCall] });
      messages.push({
        role: 'tool',
        tool_call_id: prevToolCall.id,
        name: prevToolCall.function.name,
        content: step.toolResult
      });
    }
    if (step.prompt) {
      messages.push({ role: 'user', content: step.prompt });
    }

    const r = await provider.chatWithTools(messages, test.tools && test.tools.length > 0 ? test.tools : undefined, undefined, undefined, chatOptions);
    tokensPerSecond ??= r.stats?.tokensPerSecond;
    if (typeof r.stats?.tokenCount === 'number') {
      completionTokensSum += r.stats.tokenCount;
      completionTokensCount++;
    }
    prevToolCall = r.toolCalls?.[0] ?? null;
    if (!prevToolCall && r.content) {
      messages.push({ role: 'assistant', content: r.content });
    }

    for (const check of step.checks) {
      if (checkPasses(check, r.content, r.toolCalls)) {
        gained += check.weight ?? 1;
      }
    }
  }

  return {
    score: total > 0 ? gained / total : 0,
    tokensPerSecond,
    avgCompletionTokens: completionTokensCount > 0 ? completionTokensSum / completionTokensCount : undefined
  };
}
