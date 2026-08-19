# Persistent Memory System 🧠

<div align="right">
  <p>Leggi in <a href="memory-it.md">🇮🇹 Italiano</a></p>
</div>

TSUKA implements a persistent, shared long-term memory layer that survives across sessions, workspaces, and agents. Unlike the ephemeral turn history (RAM) and the run-scoped blackboard, persistent memory is designed to accumulate project knowledge over time — conventions, architectural decisions, and hard-won lessons — without requiring external infrastructure.

> **Source**: [`src/core/memory.ts`](../src/core/memory.ts) · **Tools**: `save_memory`, `recall_memory` · **Storage**: `memory/memory.json`

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MemoryStore (Singleton)                         │
│                                                                         │
│   filePath: memory/memory.json     scope: workspace root hash           │
│   maxFacts: 200 (configurable)     reload: mtime-based hot-reload       │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │  run     │  │  fatto   │  │ decisione│  │ lezione  │   ← kinds      │
│  │ weight:0 │  │ weight:1 │  │ weight:2 │  │ weight:3 │                │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘                │
│                                                                         │
│  Dedup on write (T14.15) · Keyword search with stemming                 │
│  Eviction by kind × recency × hits · Pinned facts exempt                │
└─────────────────────────────────────────────────────────────────────────┘
```

### MemoryFact Structure

Every stored fact is a typed object with rich metadata:

```typescript
interface MemoryFact {
  id: string;          // Stable unique ID (base36 timestamp + random)
  content: string;     // Full text (max 500 chars enforced by save_memory)
  summary: string;     // Short label (max 72 chars) — what you'd see in a list
  source: string;      // Author name ('agent', 'goal_orchestrator', 'user', etc.)
  timestamp: string;   // ISO 8601 creation time
  scope: string;       // Workspace slug or 'globale'
  kind: MemoryKind;    // 'fatto' | 'decisione' | 'lezione' | 'run'
  tags?: string[];     // Optional keywords for search boosting
  pinned?: boolean;    // If true, exempt from eviction
  hits: number;        // Incremented each time search() retrieves this fact
  lastUsed: string;    // ISO 8601 of last search() retrieval
}
```

### Storage on Disk

Facts are persisted in `memory/memory.json` as a flat JSON array under a `facts` key. The file is:

- **Read** at singleton construction and re-read whenever the file's `mtime` changes (hot-reload for multi-process safety).
- **Written** atomically on every `addFact`, `remove`, `clear`, or `search` (when `touch` is enabled).
- **Scoped** by workspace root: `scopeFromWorkspaceRoot()` derives a stable slug from the workspace path + SHA1 hash, so facts from different projects never leak into each other.

---

## 2. Four Kinds — Graduated Durability

Every fact has a `kind` that determines its eviction priority. The system treats kinds as a durability ladder:

| Kind | Weight | Eviction Priority | Typical Content |
|---|---|---|---|
| `run` | 0 | Evicted **first** | Condensed turn notes, intermediate execution logs |
| `fatto` | 1 | Evicted second | Observed facts, state snapshots, file contents |
| `decisione` | 2 | Evicted third | Architectural choices, API selections, tool preferences |
| `lezione` | 3 | Evicted **last** | Hard-won lessons, anti-patterns, permanent conventions |

**Design rationale**: When an agent says "we decided to use X over Y", that's a `decisione` — it should outlive the `run` notes that recorded the comparison. When an agent learns "never do Z because it breaks W", that's a `lezione` — it should survive the longest, because re-learning it costs tokens and time.

The `run` kind is typically assigned automatically by the goal orchestrator and history compression, while agents assign `fatto`, `decisione`, or `lezione` explicitly via the `save_memory` tool.

---

## 3. Scoping — Workspace Isolation with Global Fallthrough

```
┌───────────────────────────────────────┐
│  GLOBAL_SCOPE ('globale')             │  ← visible to ALL workspaces
│  (lezione, decisione shareable)       │
├───────────────────────────────────────┤
│  Workspace Scope (SHA1-derived slug)  │  ← visible only to this project
│  ('myproject-a1b2c3d4')               │
└───────────────────────────────────────┘
```

### How Scoping Works

- **Write-time**: `addFact()` assigns the current workspace scope by default, or `GLOBAL_SCOPE` if the agent explicitly requests `global: true`.
- **Read-time**: `visibleFacts()` returns only facts matching the current scope **or** `GLOBAL_SCOPE`.
- **Source filtering**: `filterBySource()` further restricts visibility by author name, but **always includes** shareable kinds (`lezione` and `decisione`) regardless of source — because lessons and decisions are inherently valuable to every agent.

### Why This Matters

A developer working on Project A doesn't want to see Project B's temporary `run` notes cluttering their prompt. But if Project B learned a permanent lesson ("TypeScript strict mode breaks X"), every project should benefit from it. The scope + kind system achieves this without requiring agents to manually curate what's shared.

---

## 4. Write-Time Deduplication (T14.15)

**Problem**: Without dedup, repeating the same fact ten times would consume ten eviction slots, crowding out real knowledge.

**Solution**: Before inserting, `addFact()` computes a normalized key:

```typescript
private static factKey(content: string, scope: string): string {
  return `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`;
}
```

If a matching key exists, the incoming fact is **merged** into the existing one:

- **Kind**: upgraded if the incoming kind is more durable (e.g., `fatto` → `decisione`)
- **Timestamps**: freshest wins
- **Hits**: summed (a fact repeated ten times is one fact that mattered ten times)
- **Tags**: union of both sets
- **Pinned**: `true` propagates (pinning is one-way)
- **Summary**: freshest wins

The `save_memory` tool rejects duplicate content explicitly — a caller who skips the summary is exactly the caller who needs to be told to stop and think of one.

---

## 5. Search & Retrieval — Keyword Scoring with Stemming

### Token Normalization

Before matching, every word goes through morphological normalization:

```typescript
function normalizeToken(token: string): string {
  let s = token.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (s.length > 3) {
    const last = s.charAt(s.length - 1);
    if (last === 's' || FINAL_VOWELS.has(last)) {
      s = s.slice(0, -1);  // strip trailing 's' or vowel
    }
  }
  return s;
}
```

This is lightweight stemming: "running" → "runn", "decisions" → "decision", "lessons" → "lesson". It's not Porter or Snowball — it's intentionally minimal, optimized for the typical vocabulary of software engineering prompts.

### Search Scoring

`search(query)` splits the query into keywords, normalizes each, drops functional stop
words, then scores every visible fact (T15.1 tuning for local models):

```
coverage        = matched meaningful query tokens / total meaningful query tokens
hitsScore       = min(hits, 20) / 20
score           = matches × 1000  +  (coverage ≥ 0.75 ? 500 : 0)  +  hitsScore
```

**Token matching** goes beyond exact equality: a query token also matches when it is a
**prefix** of a fact token of sufficient length (`mem` → `memoria`, `corsi` → `corso`).
Only the forward direction is used — the reverse (`TypeScript` matching `type`) is exactly
the spurious OR hit `test_memory_scope.ts` documents as noise, not recall.

**Stop words** (`the`, `di`, `per`, `che`, … in EN+IT) are ignored on the query side, so
`il server usa postgres` and `server postgres` are equally specific queries. Stop words in a
fact's own content are never stripped — they are its content, not noise.

**Coverage boost**: a fact that satisfies ≥ 75% of the meaningful tokens gets a secondary
bonus, so a fact matching almost everything ranks above one matching a single word. Hits and
recency remain tertiary factors.

Results are returned most-recent-first when scores are equal, which favors freshly accessed facts.

### Auto-Tags

When a caller does **not** pass tags, `addFact` derives up to 5 auto-tags from the content
(T15.4): the first significant tokens (no stop words, no 1–2 char stems), keeping the
original word while de-duplicating on its normalized form. Auto-tags flow into the same
`content + tags` haystack used at search time.

### Touch Mechanics

When `touch: true` (default), every fact returned by `search()` gets:
- `hits += 1`
- `lastUsed = now`
- `useOrder` updated

This creates a feedback loop: frequently recalled facts accumulate hits, which boosts their eviction score, which makes them survive longer. The system learns what matters by what agents actually look up.

---

## 6. Eviction Engine — Score-Based Retention with Time Decay

When `facts.length > maxFacts`, the store evicts the **lowest-scoring** non-pinned fact.
Before the general competition (T15.5), a **run-quota pass** drops excess transient facts:
`run` notes may occupy at most 30% of `maxFacts` during an overflow, so a burst of condensed
turn logs can never starve the durable kinds. The general scoring formula:

```typescript
evictionScore(fact, recencyRank, totalCandidates) {
  const hitsScore  = Math.min(fact.hits, 20) / 20;
  const kindScore  = KIND_WEIGHT[fact.kind] / 3;       // normalized to 0..1
  const timeScore  = retentionDecay(fact) * 10;        // exponential decay, see below
  const recencyScore = recencyRank / (totalCandidates - 1) * 2;
  return kindScore * 100 + timeScore + recencyScore + hitsScore;
}
```

**Time decay (T15.2)**: a fact's retention value erodes exponentially with a **half-life per
kind** measured from `lastUsed`:

| Kind | Half-life | Meaning |
|---|---|---|
| `run` | 2 hours | turn-scoped, fades fast |
| `fatto` | 48 hours | general knowledge |
| `decisione` | 7 days | project decisions |
| `lezione` | 30 days | lasting teachings |

Every `search()` success refreshes `lastUsed`, so a reused fact is young again. Pinned facts
are exempt from decay entirely (and from the candidate set), and `lezione` (100) always
outranks `run` (0).

**Component weights**:

| Component | Range | Weight | Purpose |
|---|---|---|---|
| `kindScore × 100` | 0–100 | Dominant | Ensures `lezione` always outranks `run` |
| `timeScore` | 0–10 | Secondary | 9 hours vs 9 days now differ — actual elapsed time, not just relative order |
| `recencyScore` | 0–2 | Tie-break | Among same-kind, equally fresh facts, the last-used chain still orders |
| `hitsScore` | 0–1 | Tertiary | Frequently recalled facts get a small bonus |

**What gets evicted**: The fact with the lowest composite score. In practice:
1. `run` notes beyond the quota, and `run` with low hits (score ~0–10)
2. Old `fatto` facts with no hits follow (score ~10–15)
3. `decisione` facts survive longer (score ~20–30)
4. `lezione` facts survive longest (score ~30–100+)

**Pinned facts** are never evicted — they're excluded from the candidate set entirely.

---

## 7. Prompt Injection — Dual Ranking Pipeline

TSUKA uses two different methods to inject memory into prompts, depending on context.

### `formatForPrompt(limit, maxChars, sources)` — Default

Used when no specific task is provided (e.g., the initial prompt assembly).

1. Ranks all visible facts by **retention value** (same formula as eviction)
2. Selects top N facts (default: 10)
3. Formats each as `- [when][BADGE] (source) content`
4. Caps at `maxChars` (default: 600)
5. Appends a hint about `recall_memory` if facts were omitted

**Badges (T15.8)**: the `[when]` slot is `PINNED` for pinned facts, otherwise the compact
`YYYY-MM-DD` date; the `[BADGE]` slot is `LESSON` / `DECISION` / `FACT` / `RUN` from the
fact's kind. Small local models are bad at inferring type and freshness from a bare
sentence — the badge gives them the same signal at a glance, and the memory line is still a
single scannable line.

**Why retention ranking?** The facts most worth protecting from eviction are also the most
important to surface in a prompt. A `lezione` fact with 15 hits should appear before a `run`
note with 0 hits.

### `formatRelevant(taskText, limit, maxChars, sources)` — Task-Aware

Used when the user's task text is available (e.g., `/goal` orchestration, `spawn_agent`).

1. **Searches** memory using keyword scoring against `taskText`
2. Formats matching facts with the same `- [when][BADGE] (source) content` template
3. Caps at `maxChars`

**Trade-off**: This uses keyword relevance rather than retention value, so the most "important" facts (by eviction score) might not be the most "relevant" ones (by keyword match). The system prioritizes **contextual relevance** over **general importance** when a specific task is known.

### When Each Is Used

```
User provides task text? ──Yes──► formatRelevant(taskText)
         │                              (keyword-relevant facts)
         No
         │
         ▼
    formatForPrompt()            (retention-ranked facts)
```

---

## 8. Tools — Agent-Facing API

### `save_memory` (riskLevel: SAFE)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | Full fact text (max 500 chars) |
| `summary` | string | no | Short label (max 72 chars — like a commit subject); auto-derived from content when omitted (T15.3) |
| `kind` | string | no | English kind token: `facts` / `run` / `decision` / `lesson` (default `facts`) |
| `global` | boolean | no | If `true`, saves to `GLOBAL_SCOPE` |

**Behavior**: Adds the fact after mapping the English `kind` token to the store's internal
kind, deduplicates against existing entries, evicts if over capacity, persists to disk.

**Why the summary is optional now (T15.3)?** Before T14.20 the system auto-derived summaries
and produced identical-looking entries; T14.20 made `summary` mandatory to force distinct
labels. T15.3 relaxes that: the derivation (`deriveSummary`) is deterministic and recognizes
the system's own content formats first, so a caller that skips the summary still gets a
meaningful label — while one that writes its own (including anything overly long) is capped
downstream at 72 chars, never a second rejection policy.

### `recall_memory` (riskLevel: SAFE)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Keywords to search (coverage scoring, prefix match) |
| `limit` | number | no | Max results (default 10, max 50) |

**Behavior**: If `query` is provided, performs keyword search. Otherwise, returns recent facts. Increments `hits` and updates `lastUsed` for all returned facts (unless `touch: false`).

### `update_memory` (riskLevel: SAFE) — T15.7

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the fact to edit (from `save_memory` / `recall_memory`) |
| `content` | string | no | New fact text (max 500 chars) |
| `summary` | string | no | New short label |
| `kind` | string | no | English kind token, as in `save_memory` |
| `tags` | string[] | no | Extra tags merged into the fact's existing tags |

**Behavior**: Edits the fact in place, refreshes `timestamp`/`lastUsed`, re-runs the dedup
rule (an edit that makes a fact duplicate another collapses them instead of piling up), and
persists. Responds with JSON `{ ok, id, summary, kind, content, tags }`.

### `forget_memory` (riskLevel: SAFE) — T15.7

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Id of the fact to remove |

**Behavior**: Permanently removes the fact and responds with JSON `{ ok, removed: id }`.
Throws a clear error when the id does not exist.

---

## 9. Configuration

| Setting | Default | Description |
|---|---|---|
| `memoryMaxFacts` | 200 | Maximum facts before eviction triggers |
| `memoryMaxChars` | 600 | Maximum characters injected into system prompt |

Behavioral knobs (not configuration keys, part of the engine):

- **Time decay**: half-life per kind (2 h / 48 h / 7 d / 30 d), see §6 — re-reading a fact refreshes it.
- **Run quota**: `run` facts may fill at most 30% of `maxFacts` during an overflow, §6.

Configured via `tsuka.config.json`:

```json
{
  "memoryMaxFacts": 200,
  "memoryMaxChars": 600
}
```

---

## 10. Architectural Rationale — Why Not Vector Search?

The most common question about TSUKA's memory design: why use keyword search with a flat JSON file instead of embeddings, vector databases, or LLM-based retrieval?

### The Pragmatic Choice

| Factor | JSON + Keywords | Vector DB / Embeddings |
|---|---|---|
| **Latency** | 0ms (in-memory scan) | 50–200ms (index lookup + similarity) |
| **Dependencies** | Zero (Node.js `fs` only) | Requires model for embedding + vector store |
| **Cost** | Zero (runs on CPU) | Token cost per embedding call |
| **Reliability** | Deterministic, inspectable | Model-dependent, opaque scoring |
| **Debuggability** | `grep` the JSON file | Need vector DB tooling |
| **Local-first** | Works offline, no network | May require external embedding service |

### When This Trade-off Breaks Down

The keyword approach has known limitations:

- **Synonymy**: "deploy" and "ship" won't match each other without stemming overlap. T15.1's
  prefix matching and stop-word filtering narrow this gap for the small local models TSUKA
  targets, without the cost or opacity of embeddings.
- **Semantic distance**: "we should use React" and "frontend framework decision" relate but share no keywords
- **Scale**: beyond ~500 facts, linear scan becomes noticeable (though eviction keeps this in check)

For a local CLI harness targeting models under 30B parameters, these limitations are acceptable. The goal is not to build a knowledge graph — it's to remember that "we use tabs not spaces" and "the API key goes in .env, never in code" without re-learning them every session.

### The Feedback Loop Advantage

The `hits` + `lastUsed` feedback loop means the system self-organizes: facts that agents actually recall become more durable, while facts nobody looks up gradually fade. T15.2's
half-life decays translate "gradually fade" from a relative ordering into an actual clock: a
fact untouched for a week is objectively stale, not just behind fresher ones. This is an
empirical, usage-driven importance signal that doesn't require any external intelligence —
just the act of searching.

---

## 11. Integration Points

Memory is woven throughout the TSUKA lifecycle:

| Component | How It Uses Memory |
|---|---|
| **`agent.ts`** | Persists compressed turn history as `run` facts; saves reasoning traces |
| **`goal.ts`** | Stores goal orchestrator summaries as `fatto` with `goal_orchestrator` source |
| **`spawnAgent.ts`** | Passes `memorySources` to sub-agents for scoped visibility |
| **`shared.ts` (CLI)** | Injects memory into system prompt via `formatForPrompt` / `formatRelevant` |
| **TUI modals** | Memory inspector modal lists facts with kind, source, and date |
| **`/memory` command** | CLI command for listing, querying, and clearing persistent memory |
| **`save_memory`/`recall_memory`/`update_memory`/`forget_memory`** | The four tools agents use to read and write the store |

---

## Summary

TSUKA's memory system is designed around three principles:

1. **Durability hierarchy**: not all facts are equal — lessons outlast decisions, which outlast observations, which outlast session notes
2. **Write-time deduplication**: one fact stated ten times is one fact that mattered ten times, not ten facts
3. **Usage-driven retention**: the act of recalling a fact makes it more durable, creating a self-organizing knowledge store

This is not a general-purpose vector database. It's a purpose-built, zero-dependency, deterministic memory layer optimized for the specific needs of local LLM agents: fast, inspectable, and resilient across sessions.
