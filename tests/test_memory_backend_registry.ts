/**
 * Tests for the pluggable memory subsystem (AGENTS.md directive 8).
 * Run: npx tsx tests/test_memory_backend_registry.ts
 *
 * Verifies that:
 * - the JSON backend is the built-in default behind the MemoryBackend contract;
 * - third-party backends can register a factory and get selected through configuration
 *   (TSUKA_MEMORY_BACKEND / config `memoryBackend`) without touching call sites;
 * - an unknown backend name fails loudly instead of silently falling back;
 * - the MemoryStore facade keeps full backward compatibility (explicit file paths,
 *   persistence across instances).
 */
import './isolateMemory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  MemoryStore,
  MemoryBackend,
  MemoryFact,
  registerMemoryBackend,
  createMemoryBackend,
  listMemoryBackends,
  resolveMemoryBackendName,
} from '../src/core/memory';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string) {
  if (condition) {
    passed++;
    console.log(`✔ ${id} PASS — ${detail}`);
  } else {
    failed++;
    console.log(`✘ ${id} FAIL — ${detail}`);
  }
}

/**
 * Minimal in-memory backend used to prove the contract is genuinely swappable:
 * no disk, no BM25 — just enough semantics for the facade to delegate every call.
 */
class VolatileBackend implements MemoryBackend {
  readonly name = 'volatile';
  private facts: MemoryFact[] = [];
  private seq = 0;

  addFact(content: string, source: string): MemoryFact {
    const fact: MemoryFact = {
      id: `v-${this.seq++}`,
      content: content.trim(),
      summary: content.trim().slice(0, 72),
      source,
      timestamp: new Date().toISOString(),
      scope: 'globale',
      kind: 'fatto',
      hits: 0,
      lastUsed: new Date().toISOString(),
    };
    this.facts.push(fact);
    return fact;
  }

  getRecent(limit: number = 10): MemoryFact[] {
    return [...this.facts].reverse().slice(0, limit);
  }

  search(query: string, limit: number = 10): MemoryFact[] {
    const q = query.toLowerCase();
    return this.facts.filter((f) => f.content.toLowerCase().includes(q)).slice(0, limit);
  }

  remove(id: string): boolean {
    const before = this.facts.length;
    this.facts = this.facts.filter((f) => f.id !== id);
    return this.facts.length !== before;
  }

  updateFact(id: string, patch: { content?: string }): MemoryFact | null {
    const target = this.facts.find((f) => f.id === id);
    if (!target) return null;
    if (patch.content && patch.content.trim().length > 0) target.content = patch.content.trim();
    return target;
  }

  clear(): void {
    this.facts = [];
  }

  count(): number {
    return this.facts.length;
  }

  selectForPrompt(limit: number = 10): { facts: MemoryFact[]; available: number } {
    return { facts: this.getRecent(limit), available: this.facts.length };
  }
}

function main() {
  console.log('=== Test pluggable memory backend registry ===\n');

  // --- MB1: the JSON implementation is registered and is the default ---
  check('MB1a', listMemoryBackends().includes('json'), `'json' registered by default (registered: ${listMemoryBackends().join(', ')})`);
  const def = createMemoryBackend();
  check('MB1b', def.name === 'json', `default backend resolves to 'json' (got '${def.name}')`);

  // --- MB2: name resolution precedence (env > config argument > default) ---
  const prevEnv = process.env.TSUKA_MEMORY_BACKEND;
  delete process.env.TSUKA_MEMORY_BACKEND;
  check('MB2a', resolveMemoryBackendName() === 'json', 'no config, no env -> json');
  check('MB2b', resolveMemoryBackendName('Volatile') === 'volatile', 'configured name wins over default (case-insensitive)');
  process.env.TSUKA_MEMORY_BACKEND = 'json';
  check('MB2c', resolveMemoryBackendName('volatile') === 'json', 'env variable overrides the configured name');
  if (prevEnv === undefined) delete process.env.TSUKA_MEMORY_BACKEND; else process.env.TSUKA_MEMORY_BACKEND = prevEnv;

  // --- MB3: registering a plugin backend makes it creatable ---
  registerMemoryBackend('volatile', () => new VolatileBackend());
  check('MB3a', listMemoryBackends().includes('volatile'), 'plugin backend appears in the registry');
  const volatileInstance = createMemoryBackend('volatile');
  check('MB3b', volatileInstance.name === 'volatile' && volatileInstance.count() === 0, 'plugin backend instantiable through the factory');

  // --- MB4: unknown backend names fail loudly ---
  let threw = false;
  try {
    createMemoryBackend('does-not-exist');
  } catch (err: any) {
    threw = err.message.includes('does-not-exist') && err.message.includes('json') && err.message.includes('volatile');
  }
  check('MB4a', threw, "unknown backend name throws listing the registered alternatives");

  // --- MB5: the MemoryStore facade delegates to the active plugin backend ---
  process.env.TSUKA_MEMORY_BACKEND = 'volatile';
  try {
    const volatileStore = new MemoryStore();
    volatileStore.addFact('The volatile backend stores facts without touching disk', 'tester');
    volatileStore.addFact('Second fact about retrieval', 'tester');
    check('MB5a', volatileStore.activeBackend.name === 'volatile', 'facade binds the selected plugin backend');
    check('MB5b', volatileStore.count() === 2, `addFact/count forwarded to the plugin (${volatileStore.count()})`);
    check('MB5c', volatileStore.search('retrieval').length === 1, 'search forwarded to the plugin');
    const recentId = volatileStore.getRecent(1)[0].id;
    check('MB5d', volatileStore.remove(recentId) && volatileStore.count() === 1, 'remove forwarded to the plugin');
    check('MB5e', volatileStore.formatForPrompt().includes('volatile backend'), 'the facade formats the plugin selection');
    // T24.4: the plugin implements no budget at all, yet its section is capped by the facade.
    for (let i = 0; i < 20; i++) volatileStore.addFact(`Filler fact number ${i} with some words to take room`, 'tester');
    const capped = volatileStore.formatForPrompt(20, 200);
    check('MB5e2', capped.length <= 200 && capped.includes('more memories available'), `a backend without any cap logic still yields a capped section (${capped.length} chars)`);
    volatileStore.clear();
    check('MB5f', volatileStore.count() === 0, 'clear forwarded to the plugin');
  } finally {
    if (prevEnv === undefined) delete process.env.TSUKA_MEMORY_BACKEND; else process.env.TSUKA_MEMORY_BACKEND = prevEnv;
  }

  // --- MB6: backward compatibility of the facade with the JSON backend ---
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-mem-backend-'));
  try {
    const tmpFile = path.join(tmpDir, 'memory.json');
    const store1 = new MemoryStore(tmpFile, 50, 'scope-registry');
    store1.addFact('Persistence still works through the facade', 'tester', { kind: 'lezione' });
    const store2 = new MemoryStore(tmpFile, 50, 'scope-registry'); // simulates a new session
    check('MB6a', store2.count() === 1 && store2.search('persistence').length === 1, 'JSON persistence unchanged behind the facade');
    check('MB6b', store2.getRecent(1)[0].kind === 'lezione', 'kind metadata preserved end-to-end');

    // The singleton keeps working against the configured default (TSUKA_MEMORY_FILE from
    // isolateMemory/run_tests points it at a sandbox file — never the real user memory).
    const singleton = MemoryStore.getInstance();
    check('MB6c', singleton.activeBackend.name === 'json', 'singleton defaults to the JSON backend');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
