/**
 * Architecture boundary checks (T21.2).
 *
 * These checks protect dependency direction without freezing the complete import
 * graph. The named console exceptions are existing lifecycle or logging debt; a
 * new exception must be introduced by a task that explains its ownership.
 */

import * as fs from 'fs';
import * as path from 'path';

const repositoryRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(repositoryRoot, 'src');
let passed = 0;
let failed = 0;

function check(id: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++;
    console.log(`PASS ${id} - ${detail}`);
    return;
  }
  failed++;
  console.log(`FAIL ${id} - ${detail}`);
}

function typescriptFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return typescriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  });
}

function relativeSourcePath(filePath: string): string {
  return path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
}

function importsOf(source: string): string[] {
  const imports: string[] = [];
  const pattern = /(?:from\s+|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) imports.push(match[1]);
  return imports;
}

function resolveRelativeImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return path.resolve(path.dirname(importer), specifier);
}

const coreLayers = ['core', 'tools', 'safety'];
const forbiddenUiDependencies: string[] = [];
const knownDependencyDebt = new Set<string>();

for (const layer of coreLayers) {
  for (const filePath of typescriptFiles(path.join(sourceRoot, layer))) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const specifier of importsOf(source)) {
      const resolved = resolveRelativeImport(filePath, specifier);
      if (!resolved) continue;
      const relative = path.relative(sourceRoot, resolved).replace(/\\/g, '/');
      if (relative === 'cli' || relative.startsWith('cli/') || relative === 'tui' || relative.startsWith('tui/')) {
        const dependency = `${relativeSourcePath(filePath)} -> ${specifier}`;
        if (!knownDependencyDebt.has(dependency)) forbiddenUiDependencies.push(dependency);
      }
    }
  }
}

check(
  'ARCH.1',
  forbiddenUiDependencies.length === 0,
  forbiddenUiDependencies.length === 0
    ? 'core, tools, and safety introduced no new dependencies on CLI or TUI'
    : `forbidden UI dependencies: ${forbiddenUiDependencies.join(', ')}`
);

const frontendConcreteImports: string[] = [];
for (const layer of ['cli', 'tui']) {
  for (const filePath of typescriptFiles(path.join(sourceRoot, layer))) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const specifier of importsOf(source)) {
      if (/core\/(?:provider\/llmProvider|memory\/jsonBackend)(?:$|\.)/.test(specifier.replace(/\\/g, '/'))) {
        frontendConcreteImports.push(`${relativeSourcePath(filePath)} -> ${specifier}`);
      }
    }
  }
}

check(
  'ARCH.2',
  frontendConcreteImports.length === 0,
  frontendConcreteImports.length === 0
    ? 'CLI and TUI use public provider and memory contracts'
    : `concrete backend imports: ${frontendConcreteImports.join(', ')}`
);

const externalTransportImports: string[] = [];
for (const filePath of typescriptFiles(sourceRoot)) {
  const relativeFile = relativeSourcePath(filePath);
  if (relativeFile.startsWith('src/core/mcp/')) continue;
  const source = fs.readFileSync(filePath, 'utf8');
  for (const specifier of importsOf(source)) {
    if (specifier.replace(/\\/g, '/').includes('mcp/stdioTransport')) {
      externalTransportImports.push(`${relativeFile} -> ${specifier}`);
    }
  }
}

check(
  'ARCH.3',
  externalTransportImports.length === 0,
  externalTransportImports.length === 0
    ? 'the stdio transport remains internal to the MCP package'
    : `transport internals escaped the MCP package: ${externalTransportImports.join(', ')}`
);

const allowedDirectConsoleFiles = new Set([
  // These two files own the logging compatibility boundary itself.
  'src/core/logSink.ts',
  'src/core/logBuffer.ts',
]);
const unexpectedConsoleFiles: string[] = [];

for (const layer of ['core', 'tools', 'safety', 'tui']) {
  for (const filePath of typescriptFiles(path.join(sourceRoot, layer))) {
    const relativeFile = relativeSourcePath(filePath);
    const source = fs.readFileSync(filePath, 'utf8');
    const executableSource = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/\bconsole\.(?:log|warn|error)\s*\(/.test(executableSource) && !allowedDirectConsoleFiles.has(relativeFile)) {
      unexpectedConsoleFiles.push(relativeFile);
    }
  }
}

check(
  'ARCH.4',
  unexpectedConsoleFiles.length === 0,
  unexpectedConsoleFiles.length === 0
    ? 'no new direct console output entered protected layers'
    : `unexpected direct console output: ${unexpectedConsoleFiles.join(', ')}`
);

function resolveSourceFile(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importer), specifier);
  if (fs.existsSync(base + '.ts')) return base + '.ts';
  if (fs.existsSync(path.join(base, 'index.ts'))) return path.join(base, 'index.ts');
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  return null;
}

const allSrcFiles = typescriptFiles(sourceRoot);
const graph = new Map<string, string[]>();

for (const filePath of allSrcFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const dependencies: string[] = [];
  for (const specifier of importsOf(source)) {
    const resolved = resolveSourceFile(filePath, specifier);
    if (resolved && resolved.startsWith(sourceRoot)) {
      dependencies.push(resolved);
    }
  }
  graph.set(filePath, dependencies);
}

const visitedState = new Map<string, number>(); // 0: unvisited, 1: visiting, 2: visited
const foundCycles: string[][] = [];

function detectCyclesDfs(node: string, currentStack: string[]): void {
  visitedState.set(node, 1);
  currentStack.push(node);

  for (const neighbor of graph.get(node) || []) {
    const state = visitedState.get(neighbor) || 0;
    if (state === 1) {
      const cycleStartIndex = currentStack.indexOf(neighbor);
      foundCycles.push(currentStack.slice(cycleStartIndex).concat(neighbor));
    } else if (state === 0) {
      detectCyclesDfs(neighbor, currentStack);
    }
  }

  currentStack.pop();
  visitedState.set(node, 2);
}

for (const filePath of allSrcFiles) {
  if (!visitedState.get(filePath)) {
    detectCyclesDfs(filePath, []);
  }
}

const formattedCycles = foundCycles.map(c => c.map(p => relativeSourcePath(p)).join(' -> '));

check(
  'ARCH.5',
  foundCycles.length === 0,
  foundCycles.length === 0
    ? 'zero circular dependencies across all source files in src/'
    : `found circular dependencies: ${formattedCycles.join('; ')}`
);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
