/**
 * Unit tests for memory codec and storage modules (T21.7).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  normalizeSummary,
  deriveSummary,
  normalizeFact,
  factKey,
  mergeDuplicate,
  dedupeFacts,
  formatFactLine,
  renderMemorySection,
} from '../src/core/memory/codec';
import {
  safeLoadJsonMemoryFile,
  atomicSaveJsonMemoryFile,
  readMemoryMtime,
} from '../src/core/memory/storage';
import type { MemoryFact } from '../src/core/memory';

let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`PASS ${id} - ${detail}`);
  } else {
    failed++;
    console.log(`FAIL ${id} - ${detail}`);
  }
}

async function runTests(): Promise<void> {
  console.log('--- Memory Codec & Storage Tests (T21.7) ---');

  // Group 1: Summary Normalization & Derivation
  check('CODEC.1', normalizeSummary('   ') === undefined, 'collapses empty summary to undefined');
  check('CODEC.2', normalizeSummary('Short summary') === 'Short summary', 'preserves short summary');
  const longSummary = 'A'.repeat(100);
  const capped = normalizeSummary(longSummary);
  check('CODEC.3', !!capped && capped.length === 72 && capped.endsWith('…'), 'caps long summary to 72 chars');

  const goalSummary = deriveSummary('[Goal] researcher: Output collected from analysis');
  check('CODEC.4', goalSummary.includes("researcher's output condensed"), 'derives summary from goal pattern');

  // Group 2: Fact Normalization & Dedup
  const rawFact = {
    id: 'f1',
    content: 'Server is at port 3000',
    source: 'agent',
    timestamp: '2026-08-25T10:00:00Z',
  };
  const normalized = normalizeFact(rawFact);
  check('CODEC.5', normalized.kind === 'fatto', 'defaults missing kind to fatto');
  check('CODEC.6', normalized.summary === 'Server is at port 3000', 'derives summary when missing');

  const key1 = factKey('Hello   World  ', 'ws');
  const key2 = factKey('hello world', 'ws');
  check('CODEC.7', key1 === key2, 'normalizes whitespace and case in factKey');

  const fA: MemoryFact = {
    id: '1',
    content: 'Important rule',
    source: 'agent',
    timestamp: '2026-08-25T10:00:00Z',
    scope: 'ws',
    kind: 'fatto',
    hits: 2,
    lastUsed: '2026-08-25T10:00:00Z',
  };
  const fB: MemoryFact = {
    id: '2',
    content: 'Important rule',
    source: 'agent',
    timestamp: '2026-08-25T11:00:00Z',
    scope: 'ws',
    kind: 'decisione',
    hits: 3,
    lastUsed: '2026-08-25T11:00:00Z',
  };

  mergeDuplicate(fA, fB);
  check('CODEC.8', fA.kind === 'decisione', 'upgrades kind to stronger decision');
  check('CODEC.9', fA.hits === 5, 'sums hit counts across duplicate merge');
  check('CODEC.10', fA.timestamp === '2026-08-25T11:00:00Z', 'takes freshest timestamp');

  const dedupRes = dedupeFacts([fA, fB]);
  check('CODEC.11', dedupRes.facts.length === 1 && dedupRes.removed === 1, 'dedupes facts array');

  // Group 3: Formatting
  const line = formatFactLine(fA);
  check('CODEC.12', line.includes('[DECISION]') && line.includes('Important rule'), 'formats fact line with kind badge');

  const section = renderMemorySection([fA], 5, 200, 'memories');
  check('CODEC.13', section.includes('Important rule') && section.includes('4 more memories available'), 'renders section with recall footer');

  // Group 4: Storage Operations
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuka-mem-storage-test-'));
  const testFile = path.join(tempDir, 'memory.json');

  try {
    const saveMtime = atomicSaveJsonMemoryFile(testFile, [fA]);
    check('STORAGE.1', saveMtime > 0 && fs.existsSync(testFile), 'atomically saves memory.json');

    const mtime = readMemoryMtime(testFile);
    check('STORAGE.2', mtime === saveMtime, 'reads accurate mtime');

    const loaded = safeLoadJsonMemoryFile(testFile);
    check('STORAGE.3', loaded.facts.length === 1 && loaded.facts[0].content === 'Important rule', 'loads saved facts');

    // Test corruption recovery
    fs.writeFileSync(testFile, '{ corrupt json invalid', 'utf-8');
    const corruptLoaded = safeLoadJsonMemoryFile(testFile);
    check('STORAGE.4', corruptLoaded.facts.length === 0, 'corrupt file yields empty memory');

    const files = fs.readdirSync(tempDir);
    const backupExists = files.some((f) => f.startsWith('memory.json.corrupt-'));
    check('STORAGE.5', backupExists, 'corrupt file backed up with timestamped suffix');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
