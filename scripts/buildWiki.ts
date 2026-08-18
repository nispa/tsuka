/**
 * GitHub Wiki generator for TSUKA.
 *
 * The wiki lives in a separate repository (`<repo>.wiki.git`), so nothing there
 * can be kept in sync by the test suite. Rather than maintaining a second copy
 * of the documentation, every page is *derived*: from `docs/`, from sections of
 * the READMEs, or from the command table itself.
 *
 *   npm run wiki:build -- --out ../tsuka.wiki [--push]
 *
 * The wiki repository must already exist: GitHub creates it only when the first
 * page is saved from the web UI, and no API can do it for you.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { TUI_COMMANDS } from '../src/tui/commands';

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_SLUG = 'nispa/tsuka';
const BRANCH = 'main';

// ── Page table ────────────────────────────────────────────────────────────────

type PageSource =
  /** A whole document of docs/, copied with its links rewritten. */
  | { kind: 'doc'; file: string }
  /** Selected top-level sections of a README. */
  | { kind: 'sections'; file: string; headings: string[] }
  /** Content produced by the generator itself. */
  | { kind: 'generated'; build: () => string };

interface WikiPage {
  /** Page name: also the file name (`Architecture` -> `Architecture.md`). */
  name: string;
  /** Label used in the sidebar and in the index. */
  title: string;
  lang: 'en' | 'it';
  /** Same page in the other language. */
  counterpart?: string;
  /** One line describing the page in the Home index. */
  summary: string;
  source: PageSource;
}

const PAGES: WikiPage[] = [
  {
    name: 'Home',
    title: 'Home',
    lang: 'en',
    summary: 'Landing page and index',
    source: { kind: 'generated', build: () => buildHome() },
  },
  {
    name: 'Quickstart',
    title: 'Quickstart',
    lang: 'en',
    counterpart: 'Guida-Rapida',
    summary: 'Install, initialize a workspace and run the first turn',
    source: { kind: 'sections', file: 'README.md', headings: ['## ⚡ Quickstart', '## 🚀 Installation'] },
  },
  {
    name: 'Guida-Rapida',
    title: 'Guida rapida',
    lang: 'it',
    counterpart: 'Quickstart',
    summary: 'Installazione, inizializzazione della workspace e primo turno',
    source: { kind: 'sections', file: 'README-it.md', headings: ['## ⚡ Guida Rapida in 60 Secondi', '## 🚀 Installazione e Setup'] },
  },
  {
    name: 'TUI-Dashboard',
    title: 'TUI Dashboard',
    lang: 'en',
    counterpart: 'Dashboard-TUI',
    summary: 'The full-screen interactive dashboard: panels, keys, mouse',
    source: { kind: 'sections', file: 'README.md', headings: ['## 🖥️ Interactive Terminal UI'] },
  },
  {
    name: 'Dashboard-TUI',
    title: 'Dashboard TUI',
    lang: 'it',
    counterpart: 'TUI-Dashboard',
    summary: 'La dashboard interattiva a schermo intero: pannelli, tasti, mouse',
    source: { kind: 'sections', file: 'README-it.md', headings: ['## 🖥️ TUI Interattiva a Schermo Intero'] },
  },
  {
    name: 'Slash-Commands',
    title: 'Slash commands',
    lang: 'en',
    summary: 'Every command, its aliases and what it does — generated from the code',
    source: { kind: 'generated', build: () => buildCommandsPage() },
  },
  {
    name: 'Architecture',
    title: 'Architecture',
    lang: 'en',
    counterpart: 'Architettura',
    summary: 'ReAct loop, layers, tool registry, TUI rendering',
    source: { kind: 'doc', file: 'docs/architecture.md' },
  },
  {
    name: 'Architettura',
    title: 'Architettura',
    lang: 'it',
    counterpart: 'Architecture',
    summary: 'Ciclo ReAct, strati, registro dei tool, rendering della TUI',
    source: { kind: 'doc', file: 'docs/architecture-it.md' },
  },
  {
    name: 'Multi-Agent-Workflows',
    title: 'Multi-agent workflows',
    lang: 'en',
    counterpart: 'Workflow-Multi-Agente',
    summary: 'Conferences, teams with four strategies, goal orchestrator',
    source: { kind: 'doc', file: 'docs/multi-agent.md' },
  },
  {
    name: 'Workflow-Multi-Agente',
    title: 'Workflow multi-agente',
    lang: 'it',
    counterpart: 'Multi-Agent-Workflows',
    summary: 'Conferenze, team con quattro strategie, orchestratore di obiettivi',
    source: { kind: 'doc', file: 'docs/multi-agent-it.md' },
  },
  {
    name: 'Security',
    title: 'Security',
    lang: 'en',
    counterpart: 'Sicurezza',
    summary: 'Permission tiers, workspace jail, sandbox for self-authored tools',
    source: { kind: 'doc', file: 'docs/security.md' },
  },
  {
    name: 'Sicurezza',
    title: 'Sicurezza',
    lang: 'it',
    counterpart: 'Security',
    summary: 'Livelli di permesso, workspace jail, sandbox dei tool auto-creati',
    source: { kind: 'doc', file: 'docs/security-it.md' },
  },
  {
    name: 'Use-Cases',
    title: 'Use cases',
    lang: 'en',
    counterpart: 'Casi-d-Uso',
    summary: 'Recipes and prompts across characters, roles and teams',
    source: { kind: 'doc', file: 'docs/use-cases.md' },
  },
  {
    name: 'Casi-d-Uso',
    title: "Casi d'uso",
    lang: 'it',
    counterpart: 'Use-Cases',
    summary: 'Ricette e prompt su personaggi, ruoli e team',
    source: { kind: 'doc', file: 'docs/use-cases-it.md' },
  },
  {
    name: 'Educational-Guide',
    title: 'Educational guide',
    lang: 'en',
    counterpart: 'Guida-Didattica',
    summary: 'Building an agentic harness from scratch, milestone by milestone',
    source: { kind: 'doc', file: 'docs/educational-guide.md' },
  },
  {
    name: 'Guida-Didattica',
    title: 'Guida didattica',
    lang: 'it',
    counterpart: 'Educational-Guide',
    summary: 'Costruire un harness agentico da zero, milestone per milestone',
    source: { kind: 'doc', file: 'docs/guida-didattica.md' },
  },
];

/** Source document -> wiki page, to turn cross-references into wiki links. */
const PAGE_BY_SOURCE = new Map<string, string>(
  PAGES.flatMap((p) => (p.source.kind === 'doc' ? [[p.source.file, p.name] as [string, string]] : []))
);

// ── Link rewriting ────────────────────────────────────────────────────────────

function blobUrl(slug: string, repoPath: string): string {
  const clean = repoPath.replace(/^\.\//, '').replace(/^\//, '');
  const kind = clean.endsWith('/') ? 'tree' : 'blob';
  return `https://github.com/${slug}/${kind}/${BRANCH}/${clean.replace(/\/$/, '')}`;
}

/**
 * Resolves one link of a source document into something valid on the wiki,
 * which lives in another repository: cross-references become wiki pages,
 * anything else pointing at the codebase becomes an absolute blob URL.
 */
export function rewriteLink(target: string, sourceFile: string, slug: string = DEFAULT_SLUG): string {
  const trimmed = target.trim();

  // External links and in-page anchors are already fine
  if (/^(https?:|mailto:)/i.test(trimmed) || trimmed.startsWith('#')) return trimmed;

  // Absolute local paths left behind by an editor (file:///…/harness/src/x.ts)
  const localMatch = trimmed.match(/^file:\/\/\/.*?\/harness\/(.+)$/i);
  if (localMatch) return blobUrl(slug, localMatch[1]);

  const [pathPart, anchor] = trimmed.split('#');
  const sourceDir = path.posix.dirname(sourceFile.replace(/\\/g, '/'));
  const repoPath = path.posix.normalize(path.posix.join(sourceDir === '.' ? '' : sourceDir, pathPart));

  const page = PAGE_BY_SOURCE.get(repoPath);
  if (page) return anchor ? `${page}#${anchor}` : page;

  return blobUrl(slug, repoPath) + (anchor ? `#${anchor}` : '');
}

/** Rewrites every Markdown and HTML link of a document. */
function rewriteLinks(markdown: string, sourceFile: string, slug: string): string {
  return markdown
    .replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (_m, target: string, title: string = '') =>
      `](${rewriteLink(target, sourceFile, slug)}${title || ''})`)
    .replace(/(<a\s+[^>]*href=")([^"]+)(")/gi, (_m, before: string, target: string, after: string) =>
      `${before}${rewriteLink(target, sourceFile, slug)}${after}`);
}

// ── Page assembly ─────────────────────────────────────────────────────────────

function readSource(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8').replace(/\r\n/g, '\n');
}

/** Extracts the requested top-level sections, in the order they are asked for. */
export function extractSections(markdown: string, headings: string[]): string {
  const lines = markdown.split('\n');
  const starts: number[] = [];
  lines.forEach((l, i) => { if (l.startsWith('## ')) starts.push(i); });

  const blocks = starts.map((start, idx) => ({
    heading: lines[start],
    body: lines.slice(start, idx + 1 < starts.length ? starts[idx + 1] : lines.length),
  }));

  return headings
    .map((wanted) => {
      const found = blocks.find((b) => b.heading.startsWith(wanted));
      if (!found) throw new Error(`Section "${wanted}" not found`);
      return found.body.join('\n').trimEnd();
    })
    .join('\n\n');
}

/** Header of every page: language switch plus where the content comes from. */
function pageHeader(page: WikiPage, sourceLabel: string, slug: string): string {
  const other = page.counterpart ? PAGES.find((p) => p.name === page.counterpart) : undefined;
  const switchLine = other
    ? `${page.lang === 'en' ? '🇬🇧 English' : '🇮🇹 Italiano'} · [${other.lang === 'en' ? '🇬🇧 English' : '🇮🇹 Italiano'}](${other.name})`
    : '';

  const origin = sourceLabel
    ? `<sub>Generated from [\`${sourceLabel}\`](${blobUrl(slug, sourceLabel)}) — edit that file in the repository, not this page.</sub>`
    : '<sub>Generated by <code>npm run wiki:build</code> — edit the generator, not this page.</sub>';

  return [switchLine, origin].filter(Boolean).join('\n\n') + '\n\n---\n\n';
}

function buildHome(): string {
  const index = (lang: 'en' | 'it') =>
    PAGES.filter((p) => p.lang === lang && p.name !== 'Home')
      .map((p) => `| [${p.title}](${p.name}) | ${p.summary} |`)
      .join('\n');

  return [
    '# TSUKA — Wiki',
    '',
    '**TSUKA** (TypeScript Unified Kit for Agents) is a lightweight, educational multi-agent framework and',
    'agentic CLI in TypeScript, for local models (Ollama, llama.cpp/llama-server, Unsloth) and cloud gateways',
    '(OpenRouter).',
    '',
    '## 🇬🇧 English',
    '',
    '| Page | What it covers |',
    '|---|---|',
    index('en'),
    '',
    '## 🇮🇹 Italiano',
    '',
    '| Pagina | Contenuto |',
    '|---|---|',
    index('it'),
    '',
  ].join('\n');
}

/**
 * The commands page is built from the command table itself, so it cannot claim
 * a command that no longer exists nor miss an alias.
 */
function buildCommandsPage(): string {
  const rows = TUI_COMMANDS
    .filter((c) => !c.hidden)
    .map((c) => {
      const aliases = (c.aliases || []).map((a) => `\`${a}\``).join(', ') || '—';
      return `| \`${c.name}\` | ${aliases} | ${c.description} |`;
    });

  const hidden = TUI_COMMANDS
    .filter((c) => c.hidden)
    .map((c) => `\`${c.name}\``)
    .join(', ');

  return [
    '# Slash commands',
    '',
    'Available in the CLI REPL and in the TUI. Aliases behave exactly like the command they point to.',
    '',
    '| Command | Aliases | Description |',
    '|---|---|---|',
    ...rows,
    '',
    `Power-user commands kept out of the menu: ${hidden}.`,
    '',
  ].join('\n');
}

function renderPage(page: WikiPage, slug: string): string {
  if (page.source.kind === 'generated') {
    return pageHeader(page, '', slug) + page.source.build();
  }

  const file = page.source.file;
  const raw = page.source.kind === 'doc'
    ? readSource(file)
    : extractSections(readSource(file), page.source.headings);

  return pageHeader(page, file, slug) + rewriteLinks(raw, file, slug).trimEnd() + '\n';
}

function buildSidebar(): string {
  const section = (lang: 'en' | 'it', title: string) => [
    `**${title}**`,
    '',
    ...PAGES.filter((p) => p.lang === lang && p.name !== 'Home').map((p) => `- [${p.title}](${p.name})`),
    '',
  ];

  return [
    '### [TSUKA](Home)',
    '',
    ...section('en', '🇬🇧 English'),
    ...section('it', '🇮🇹 Italiano'),
  ].join('\n');
}

function buildFooter(slug: string): string {
  const version = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')).version;
  return `TSUKA v${version} · [Repository](https://github.com/${slug}) · ` +
    `[Issues](https://github.com/${slug}/issues) · MIT License`;
}

/** Renders the whole wiki into `outDir`; returns the file names written. */
export function buildWiki(outDir: string, slug: string = DEFAULT_SLUG): string[] {
  fs.mkdirSync(outDir, { recursive: true });

  const written: string[] = [];
  for (const page of PAGES) {
    const file = `${page.name}.md`;
    fs.writeFileSync(path.join(outDir, file), renderPage(page, slug), 'utf-8');
    written.push(file);
  }

  fs.writeFileSync(path.join(outDir, '_Sidebar.md'), buildSidebar(), 'utf-8');
  fs.writeFileSync(path.join(outDir, '_Footer.md'), buildFooter(slug), 'utf-8');
  written.push('_Sidebar.md', '_Footer.md');

  return written;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

/** owner/name of the origin remote, so links point at the right fork. */
function detectSlug(): string {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
    const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/i);
    return match ? match[1] : DEFAULT_SLUG;
  } catch {
    return DEFAULT_SLUG;
  }
}

function flagValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function main(): void {
  const slug = flagValue('--repo') || detectSlug();
  const outDir = path.resolve(REPO_ROOT, flagValue('--out') || path.join('..', 'tsuka.wiki'));

  const written = buildWiki(outDir, slug);
  console.log(`Wiki generated for ${slug}: ${written.length} files in ${outDir}`);

  if (!process.argv.includes('--push')) {
    console.log('Review, then push with --push (or commit manually from the wiki clone).');
    return;
  }

  if (!fs.existsSync(path.join(outDir, '.git'))) {
    console.error(
      `${outDir} is not a git clone. Create the first wiki page from the browser, then:\n` +
      `  git clone https://github.com/${slug}.wiki.git ${outDir}`
    );
    process.exitCode = 1;
    return;
  }

  const git = (...args: string[]) => execFileSync('git', args, { cwd: outDir, stdio: 'inherit' });
  git('add', '-A');
  try {
    git('commit', '-m', 'docs(wiki): regenerate from repository documentation');
  } catch {
    console.log('Nothing to commit: the wiki already matches the documentation.');
    return;
  }
  git('push');
  console.log('Wiki published.');
}

if (require.main === module) {
  main();
}
