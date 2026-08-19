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
│  Dedup on write · BM25 keyword search with stemming                     │
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
- **Written atomically** on every `addFact`, `remove`, `clear`, or `search` (when `touch` is enabled): the store writes a sibling `.tmp` file and then renames it onto the real path. A rename on the same filesystem is atomic, so an interruption mid-write can never leave a half-written `memory.json` — the worst case is an orphaned `.tmp`.
- **Never reset silently on corruption**: if the JSON fails to parse, the bytes are preserved under `memory.json.corrupt-<timestamp>` and a warning names the backup, *then* the store starts empty. Losing memory quietly to a truncated file would be indistinguishable from having none.
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

## 4. Write-Time Deduplication

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

### Search Scoring — BM25

`search(query)` splits the query into keywords, normalizes each, drops functional stop
words, then ranks every visible fact with **BM25** — the standard lexical ranking
function, implemented in ~20 lines with zero dependencies:

```
idf(t)   = ln(1 + (N - n(t) + 0.5) / (n(t) + 0.5))      N = visible facts, n(t) = facts containing t
score(f) = Σ  idf(t) × ( tf(t,f) × (k1 + 1) )
           t∈q          -----------------------------------------
                        tf(t,f) + k1 × (1 - b + b × len(f)/avgLen)

k1 = 1.2   (term-frequency saturation)
b  = 0.75  (document-length normalization)
```

Three properties come out of that formula, and they are the reason BM25 replaced the earlier
`matches × 1000 + coverage bonus` scoring:

- **IDF — rarity is weight.** A token every fact shares carries almost no signal; a token in
  one fact out of a hundred dominates the ranking. This is the whole point: a query is
  answered by its *discriminating* words, not by its longest ones.
- **Term-frequency saturation (`k1`).** Repeating a word helps, with diminishing returns.
  Ten occurrences do not score ten times one — a fact cannot win by keyword stuffing.
- **Length normalization (`b`).** A short fact matching a token beats a long one matching the
  same token, so padding is not rewarded.

**Token matching** goes beyond exact equality: a query token also matches when it is a
**prefix** of a fact token of sufficient length (`mem` → `memoria`, `corsi` → `corso`).
Only the forward direction is used — the reverse (`TypeScript` matching `type`) is exactly
the spurious OR hit `test_memory_scope.ts` documents as noise, not recall. Prefix matching
feeds both the term frequency of a fact and the document frequency behind its IDF.

**Stop words** (`the`, `di`, `per`, `che`, … in EN+IT) are ignored on the query side, so
`il server usa postgres` and `server postgres` are equally specific queries. Stop words in a
fact's own content are never stripped — they are its content, not noise.

**Hits and recency stay tertiary**: they only break ties between facts BM25 scores equally.
Facts scoring zero (no query token matched at all) are dropped rather than returned with a
weak score, so an unrelated query returns nothing instead of noise.

### Auto-Tags

When a caller does **not** pass tags, `addFact` derives up to 5 auto-tags from the content:
the first significant tokens (no stop words, no 1–2 char stems), keeping the
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
Before the general competition, a **run-quota pass** drops excess transient facts:
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

**Time decay**: a fact's retention value erodes exponentially with a **half-life per
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

**Badges**: the `[when]` slot is `PINNED` for pinned facts, otherwise the compact
`YYYY-MM-DD` date; the `[BADGE]` slot is `LESSON` / `DECISION` / `FACT` / `RUN` from the
fact's kind. Small local models are bad at inferring type and freshness from a bare
sentence — the badge gives them the same signal at a glance, and the memory line is still a
single scannable line.

**Why retention ranking?** The facts most worth protecting from eviction are also the most
important to surface in a prompt. A `lezione` fact with 15 hits should appear before a `run`
note with 0 hits.

### `formatRelevant(taskText, limit, maxChars, sources)` — Task-Aware

Used when the user's task text is available (e.g., `/goal` orchestration, `spawn_agent`).

1. **Searches** memory with BM25 (§5) against `taskText`
2. Formats matching facts with the same `- [when][BADGE] (source) content` template
3. Caps at `maxChars`

**Trade-off**: This uses lexical relevance rather than retention value, so the most "important" facts (by eviction score) might not be the most "relevant" ones (by BM25 score). The system prioritizes **contextual relevance** over **general importance** when a specific task is known.

**Injection does not count as a use**: this search runs with `touch: false`, so building a prompt never inflates `hits` or refreshes `lastUsed`. Only a deliberate `recall_memory` call does. Otherwise every fact injected into every turn would look permanently "popular" and the usage signal behind retention would mean nothing.

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
| `summary` | string | no | Short label (max 72 chars — like a commit subject); auto-derived from content when omitted |
| `kind` | string | no | English kind token: `facts` / `run` / `decision` / `lesson` (default `facts`) |
| `global` | boolean | no | If `true`, saves to `GLOBAL_SCOPE` |

**Behavior**: Adds the fact after mapping the English `kind` token to the store's internal
kind, deduplicates against existing entries, evicts if over capacity, persists to disk.

**Why is the summary optional?** It went through three stages, and the middle one is worth
knowing about. Originally there was no summary at all: listings truncated `content` at ~40
characters, and because most facts share a long prefix (`[Goal] `, `AGENTE: `, …) the part
that would tell two entries apart was exactly the part being cut — every row looked the same.
The first fix made `summary` **mandatory**, forcing the caller to write a distinct label.
That worked, but it rejected otherwise valid saves over a missing field. Today the derivation
(`deriveSummary`) is deterministic and recognizes the system's own content formats first, so
a caller that omits the summary still gets a meaningful label instead of a truncation. A
caller that writes its own is simply capped at 72 characters downstream — never a second
rejection policy.

### `recall_memory` (riskLevel: SAFE)

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | no | Keywords to search (BM25 ranking, prefix match) |
| `limit` | number | no | Max results (default 10, max 50) |

**Behavior**: If `query` is provided, performs keyword search. Otherwise, returns recent facts. Increments `hits` and updates `lastUsed` for all returned facts (unless `touch: false`).

### `update_memory` (riskLevel: SAFE)

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

### `forget_memory` (riskLevel: SAFE)

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

## 10. The Memory Landscape — Where TSUKA Sits

> This project is a teaching instrument, and this section is the lesson. Agent memory is not a
> single thing: it is a **ladder**, and every rung trades away determinism and self-containment
> for capability. TSUKA stops at a specific rung **on purpose** — the point of this section is to
> show the whole ladder, mark which rung we chose and why, and name the limits we accept.

### The Ladder

| Rung | Approach | Representative systems | What it adds over the rung below | What it costs |
|---|---|---|---|---|
| 1 | Raw transcript | LangChain `ConversationBufferMemory` | Verbatim recall | Bounded by the context window; forgets as it scrolls off |
| 2 | Rolling summary | LangChain `ConversationSummaryMemory` | Condenses the transcript | Loses detail; the summary is model-generated |
| 3 | **Lexical facts + scoring** | **TSUKA** | Cross-session persistence, dedup, eviction, time-decay | Matches *words*, not *meaning* |
| 4 | Vector / semantic retrieval | RAG, LangChain vector retriever, LlamaIndex | Retrieves by *meaning* (synonyms, paraphrase) | Embedding model + vector store; opaque scoring |
| 5 | Memory hierarchy + self-editing | MemGPT / Letta | The model writes, edits and forgets its own memory | LLM in the loop; less deterministic |
| 6 | Temporal knowledge graph | Zep | Entities + relations + time; decay and timeline queries | Graph store; heavier infrastructure |
| 7 | Managed graph + semantic | Mem0 | Embeddings + graph + entity extraction, often SaaS | External dependency |

Each rung is a superset of the idea below it, and each is what a real system does in production.

### What the higher rungs buy that TSUKA does not have

- **Semantic retrieval** (rung 4+). "We decided to use React" and "frontend framework choice"
  share no token, so TSUKA's `search()` will not connect them; an embedding model will, because
  they mean the same thing. This is the single largest gap.
- **Relationship reasoning** (rung 6+). "Module A depends on B" and "B was removed" are two
  unrelated facts in a flat store; a knowledge graph traverses the edge and infers "A is now
  broken". TSUKA stores facts, not edges.
- **Autonomous self-editing** (rung 5). Letta maintains its own memory: it decides what to
  promote to the system prompt and what to archive. TSUKA exposes `update_memory`/`forget_memory`
  (§8) and leaves the *decision* to the model — a first, deliberate step onto this rung, but
  not the full loop.
- **Temporal queries** (rung 6). Zep can answer "when did we switch from X to Y?" because time is
  a first-class dimension. TSUKA has timestamps and half-life decay (§6), but no index over time.

### Why TSUKA stops at rung 3

| Factor | Rung 3 (lexical, this repo) | Rung 4+ (vector / graph / managed) |
|---|---|---|
| **Dependencies** | Zero (`node:fs` only) | Embedding model + vector/graph store |
| **Latency & cost** | 0ms, CPU, no tokens | Embedding call + index lookup |
| **Determinism** | Fully inspectable, `grep`-able | Model-dependent, opaque |
| **Offline / local-first** | Yes, by construction | Often needs a service or a heavier model |
| **Failure mode** | Misses synonyms and paraphrase | Silent semantic drift, harder to debug |

For a local harness that runs small models (<30B) with no external services, rung 3 is the
**highest rung reachable without giving up determinism**. That is the trade-off — and naming it
is the point: a vector store is not "better", it is *different*, buying semantic recall at the
cost of opacity and dependency.

### What rung 3 still gets right

Two ideas are borrowed from the higher rungs and implemented without their cost:

- **Time decay** is rung 6's core insight (facts erode by age), reduced to a per-kind half-life
  (§6).
- **Usage-driven retention** — the `hits` + `lastUsed` feedback loop — means facts the agents
  actually look up become more durable. The system self-organizes from the act of searching,
  with no external intelligence (§5, Touch Mechanics).

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

## 12. A Learning Path Beyond This Design

The ladder in §10 is also a syllabus. If you want to move TSUKA up one rung at a time, this is
the route, ordered by value-to-cost:

> **Step 1 of this list is already done.** BM25 / TF-IDF weighting is what §5 now documents —
> still lexical, still zero-dependency, still deterministic, but a token is weighted by how
> *discriminating* it is across the store. What follows is the route from here.

1. **Local embeddings, opt-in (rung 4).** Add an optional embedding path using a local model
   (e.g. `nomic-embed-text` via Ollama) and cosine similarity. Keeps the system offline; flips
   retrieval from "spelling" to "meaning".
2. **Hybrid retrieval (best of 3 + 4).** Merge lexical and semantic rankings with reciprocal
   rank fusion, the standard production-RAG recipe, so a synonym-only match and an
   exact-keyword match both surface.
3. **Knowledge graph (rung 6).** Store entities and relations as edges, enabling multi-hop
   "what depends on what" reasoning.
4. **Self-editing memory (rung 5).** A Letta-style split into a small "core" memory kept in the
   system prompt and an "archival" store the model manages itself.

Each step is a lesson in its own right; the harness exists to teach them, not to reach the top.

---

## Summary

TSUKA's memory system is designed around three principles:

1. **Durability hierarchy**: not all facts are equal — lessons outlast decisions, which outlast observations, which outlast session notes
2. **Write-time deduplication**: one fact stated ten times is one fact that mattered ten times, not ten facts
3. **Usage-driven retention**: the act of recalling a fact makes it more durable, creating a self-organizing knowledge store

This is not a general-purpose vector database. Read with §10 and §12, it is a deliberate stop
on a larger ladder: a *lexical*, *zero-dependency*, *deterministic* memory layer — the highest
rung that does not sacrifice inspectability — and a map of the rungs above it (semantic
retrieval, knowledge graphs, self-editing memory) that other systems already occupy.
