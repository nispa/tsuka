import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homePath } from './apphome';
import type { ILLMProvider, ChatOptions } from './provider';

/**
 * Benchmark guidato da file: i test di capability fingerprinting vivono in
 * `benchmarks/*.json` (home dell'app) e si possono aggiungere/modificare al
 * volo senza toccare il codice. Ogni file è un test con prompt (o passi
 * concatenati), tool offerti al modello e una lista di check dichiarativi
 * pesati che producono un punteggio 0..1.
 *
 * L'hash del set di test è salvato nel profilo del modello: modificare un
 * test invalida automaticamente i profili misurati col set precedente.
 */

export type BenchCategory = 'instruction' | 'json' | 'toolCalling';

export interface BenchCheck {
  /** Tipo di verifica (vedi CHECK_TYPES) */
  type: string;
  /** Valore atteso (parola, numero, pattern regex, nome tool, ...) */
  value?: any;
  /** Per i check tool_arg_*: nome dell'argomento della tool call */
  arg?: string;
  /** Per i check json_path_*: percorso nel JSON, es. "economici[0].nome" */
  path?: string;
  /** Flag regex (default "i" per contains/not_contains, "" per regex) */
  flags?: string;
  /** Peso del check nel punteggio del test (default 1) */
  weight?: number;
}

export interface BenchStep {
  /** Messaggio utente che apre il passo */
  prompt?: string;
  /** In alternativa: risultato (contenuto del messaggio 'tool') da restituire
   *  alla tool call del passo precedente. Se il passo precedente non ha
   *  emesso tool call, il passo è saltato e i suoi check valgono 0. */
  toolResult?: string;
  checks: BenchCheck[];
}

export interface BenchTest {
  name: string;
  description?: string;
  category: BenchCategory;
  /** Peso del test nella media della sua categoria (default 1) */
  weight?: number;
  /** Tool (schema OpenAI) offerti al modello durante il test */
  tools?: any[];
  /** Forma breve: prompt singolo + checks (equivale a steps con un solo passo) */
  prompt?: string;
  checks?: BenchCheck[];
  /** Forma estesa: passi concatenati (catene di tool multi-turno) */
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

// ── Caricamento e hash del set di test ──

/**
 * Carica e valida tutti i test da benchmarks/*.json (ordinati per nome file).
 * Lancia un errore descrittivo (con nome file) sul primo test malformato.
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
      throw new Error(`Test di benchmark malformato (${file}): ${e.message}`);
    }
    validateTest(test, file);
    tests.push(test);
  }
  return tests;
}

function validateTest(test: BenchTest, file: string): void {
  const fail = (msg: string) => { throw new Error(`Test di benchmark non valido (${file}): ${msg}`); };
  if (!test.name || typeof test.name !== 'string') fail('campo "name" mancante');
  if (!CATEGORIES.includes(test.category)) fail(`"category" deve essere una tra: ${CATEGORIES.join(', ')}`);
  const steps = normalizeSteps(test);
  if (steps.length === 0) fail('serve "prompt"+"checks" oppure "steps"');
  if (!steps[0].prompt) fail('il primo passo deve avere un "prompt"');
  for (const step of steps) {
    if (!step.prompt && !step.toolResult) fail('ogni passo deve avere "prompt" o "toolResult"');
    if (!Array.isArray(step.checks) || step.checks.length === 0) fail('ogni passo deve avere almeno un check');
    for (const c of step.checks) {
      if (!CHECK_TYPES.includes(c.type as any)) fail(`tipo di check sconosciuto: "${c.type}"`);
    }
  }
}

export function normalizeSteps(test: BenchTest): BenchStep[] {
  if (test.steps && test.steps.length > 0) return test.steps;
  if (test.prompt && test.checks) return [{ prompt: test.prompt, checks: test.checks }];
  return [];
}

/**
 * Hash breve (8 hex) del contenuto di tutti i file di test: cambia se un test
 * viene aggiunto, rimosso o modificato. Cache su nomi+mtime.
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

// ── Valutazione dei check ──

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter((w) => w.length > 0);
}

function nonEmptyLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Rimuove la punteggiatura ai bordi di una parola (es. "blu." → "blu"). */
function stripEdgePunct(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** Estrae il primo blocco JSON {...} dal testo e lo parsa (null se invalido). */
export function extractJson(text: string): any | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

/** Naviga un percorso tipo "economici[0].nome" dentro un oggetto. */
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
  try { return JSON.parse(tc.function.arguments); } catch { return {}; }
}

/** Confronto tollerante: numeri confrontati come numeri, il resto come stringhe. */
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

// ── Esecuzione di un test ──

export interface BenchRunOutcome {
  score: number; // 0..1
  tokensPerSecond?: number;
  /** Media dei token di completamento sui passi eseguiti (T8.10): a differenza di
   *  tokensPerSecond, questa metrica rileva l'over-thinking — a effort più alto la
   *  velocità di generazione può restare identica, ma i token emessi per arrivare
   *  alla stessa risposta sono molti di più. undefined se nessun passo ha girato. */
  avgCompletionTokens?: number;
}

/**
 * Esegue un singolo test contro il provider: passi in sequenza, con i
 * risultati tool dichiarati nel test restituiti alla tool call del passo
 * precedente. Punteggio = somma pesata dei check superati / peso totale.
 * `chatOptions` (T8.10) viaggia invariato ad ogni passo: serve al chiamante
 * (runBenchmark) per far girare l'intero test a un dato livello di reasoning_effort.
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
    if (chainBroken) continue; // i check del passo pesano comunque (valgono 0)

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
