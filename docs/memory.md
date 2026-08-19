# Educational Guide — The Persistent Memory System 🧠

<div align="right">
  <p>Leggi in <a href="memory-it.md">🇮🇹 Italiano</a></p>
</div>

> **Educational Premise**: Large Language Models are stateless functions: every API call begins with a blank slate. To build an agent capable of learning across sessions without suffering from context window bloat or relying on heavy, opaque vector databases, we need a clean mental model and a deterministic storage architecture.  
> This guide explores the design of TSUKA's persistent memory system: the core concepts, the architectural trade-offs, the underlying algorithms, and the practical lessons learned from real-world engineering mistakes.

---

## 1. The Three Tiers of Agent Consciousness

Before diving into algorithms, we must distinguish between the three distinct levels of state in an agentic harness:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Turn History (RAM)                                                       │
│    • Scope: Current conversational turn                                     │
│    • Lifetime: Ephemeral (lost on restart, pruned when context window fills)│
│    • Purpose: Immediate ReAct loop messages (user input, tool calls, logs)  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Run Blackboard (AsyncLocalStorage)                                       │
│    • Scope: Active multi-agent workflow (/team or /goal)                    │
│    • Lifetime: Single workflow run (destroyed upon completion)              │
│    • Purpose: Shared scratchpad for agents to post and read working notes   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Long-Term Persistent Memory (memory/memory.json)                         │
│    • Scope: Cross-session, cross-workspace, shared by all agents            │
│    • Lifetime: Permanent (persisted on disk, governed by score eviction)    │
│    • Purpose: Architectural choices, conventions, and hard-won lessons      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 💡 The Common Engineering Mistake
A frequent beginner trap is treating the chat prompt as a dumping ground for all past execution history.
* **The failure mode**: Small and local models (<30B) quickly experience **attention dilution** — when thousands of tokens of old logs flood the prompt, the model loses track of immediate instructions and hallucinates tool parameters.
* **The architectural rule**: Ephemeral logs stay in turn RAM; collaborative task scratchpads stay in the run Blackboard; only durable, curated insights graduate into Long-Term Memory.

---

## 2. The Memory Ladder — Architectural Choices & Trade-offs

Memory systems in AI are not a binary choice. They exist on a **ladder of trade-offs**, where higher rungs add semantic capabilities at the cost of infrastructure complexity, latency, and determinism:

```
Rung 6: Temporal Knowledge Graphs (Zep, Mem0)      ── Heavy infrastructure, graph engines
Rung 5: Autonomous Self-Editing Memory (Letta)     ── Continuous LLM-in-the-loop curation
Rung 4: Vector Embeddings & Semantic RAG           ── Requires embedding models & vector stores
────────────────────────────────────────────────────────────────────────────────────────────────
Rung 3: Lexical Ranking + Half-Life Decay (TSUKA)  ◄── ZERO dependencies, 100% deterministic & local
────────────────────────────────────────────────────────────────────────────────────────────────
Rung 2: Rolling Context Summaries                  ── Loses precise details, prompt-expensive
Rung 1: Raw Chat History Buffer                    ── Explodes context budget immediately
```

### Why TSUKA Operates at Rung 3

| Feature / Metric | Vector / Semantic Retrieval (Rung 4) | Lexical + Half-Life Decay (TSUKA - Rung 3) |
|---|---|---|
| **External Dependencies** | Requires embedding model + vector DB binaries | **Zero** (Pure TypeScript + `node:fs`) |
| **Latency & Overhead** | 50–500ms per embedding call, extra GPU/CPU RAM | **0ms**, instantaneous CPU string scoring |
| **Determinism & Debugging**| Opaque float vectors, non-deterministic ranking | Plain text JSON file (`memory/memory.json`), `grep`-able |
| **Offline / Local-First** | Can fail if embedding server/model crashes | Fully self-contained, 100% offline |
| **Accepted Trade-off** | Captures paraphrasing ("car" matches "automobile") | Matches exact stems and prefixes ("build", "builder") |

> 🔑 **Key Insight**: In coding and engineering harnesses, queries typically look for **specific file paths, exact error strings, technology names, and concrete rules** rather than poetic synonyms. Lexical BM25 ranking paired with morphological stemming covers ~90% of real-world needs with zero external moving parts.

---

## 3. The Durability Hierarchy (The 4 Memory Kinds)

Not all knowledge has the same shelf life. An execution error from 10 minutes ago is obsolete once resolved, but an architectural standard ("Always use UTF-8 without BOM in PowerShell") must survive indefinitely.

TSUKA organizes memory into **4 distinct durability tiers**:

```
        ▲  ┌───────────────────────────────┐
        │  │  LEZIONE (Lesson)             │  Weight: 3 | Half-life: 30 days
        │  │  "Never disable TLS in prod"  │  (Hard-won rules, safety conventions)
        │  ├───────────────────────────────┤
        │  │  DECISIONE (Decision)         │  Weight: 2 | Half-life: 7 days
        │  │  "We use Vitest, not Jest"    │  (Architectural and tech stack choices)
        │  ├───────────────────────────────┤
DURABILITY │  FATTO (Fact)                 │  Weight: 1 | Half-life: 48 hours
        │  │  "Config is at src/config.ts" │  (System state, environment snapshots)
        │  ├───────────────────────────────┤
        │  │  RUN (Run Note)               │  Weight: 0 | Half-life: 2 hours
        │  │  "Build failed on step 2"     │  (Transient logs, evicted first)
        ▼  └───────────────────────────────┘
```

* **Run Quota Protection**: When memory reaches capacity (`maxFacts = 200`), transient `run` notes are capped at a maximum of 30% of total storage during an eviction pass, preventing a burst of workflow logs from ever starving durable lessons.

---

## 4. Under the Hood — The Memory Life Cycle

```
                  ┌──────────────────────────────┐
                  │ 1. Writing & Deduplication   │  Normalizes content, auto-tags, merges hits
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────▼───────────────┐
                  │ 2. Searching & Retrieval     │  BM25 lexical ranking + morphological stemming
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────▼───────────────┐
                  │ 3. Aging & Eviction          │  Exponential half-life decay; recall refreshes age
                  └──────────────┬───────────────┘
                                 │
                  ┌──────────────▼───────────────┐
                  │ 4. Prompt Injection          │  Task-Aware (BM25) vs General (Retention Score)
                  └──────────────────────────────┘
```

---

### Step 1: Writing, Deduplication & Auto-Tagging

When an agent calls `save_memory`:
1. **Atomic File Safety**: Writing directly to `memory.json` risks file corruption if the user halts the process mid-write. TSUKA writes to a temporary sibling file (`memory.json.tmp`) and performs an **atomic filesystem rename**. If corrupted bytes are ever encountered, they are preserved as `memory.json.corrupt-<timestamp>` before starting fresh.
2. **Normalized Deduplication**: Before inserting a new fact, the system creates a normalized key:
   ```typescript
   key = `${scope} ${content.trim().replace(/\s+/g, ' ').toLowerCase()}`
   ```
3. **Smart Merge**: If a duplicate key already exists:
   - It upgrades the durability `kind` if the new one is higher (e.g. `fatto` $\to$ `decisione`).
   - It increments the existing fact's `hits` count (a fact re-discovered multiple times is a fact that matters).
   - It updates timestamps and merges keyword tags.
4. **Auto-Tagging**: If tags are omitted, the engine automatically extracts up to 5 significant keywords from the content, ignoring common stop words.

---

### Step 2: Searching with BM25 & Stemming

When agents search memory with `recall_memory(query)`:

#### 1. Morphological Stemming
Tokens are normalized to their base linguistic root (e.g. `"running"` $\to$ `"runn"`, `"processi"` $\to$ `"process"`). This allows queries in English and Italian to match inflected words naturally.

#### 2. BM25 Ranking Principles
Instead of a naive substring count, BM25 provides intuitive, mathematically sound ranking:
* **Term Rarity (IDF)**: Common words carry little weight; rare, discriminative words (e.g. `"OAuth"`, `"deadlock"`) dominate the score.
* **Term Frequency Saturation**: Repeating a keyword 10 times in a single note does not multiply its score tenfold. BM25 applies logarithmic saturation, preventing keyword stuffing.
* **Document Length Normalization**: A concise 20-word note matching the keyword scores higher than a 500-word block where the keyword appeared once by accident.

---

### Step 3: Aging & The "Biological" Eviction Engine

When memory exceeds capacity (`maxFacts = 200`), the store must evict the lowest-scoring non-pinned entry:

```
                                  EVICTION SCORE FORMULA
  
  Score = (Kind_Weight × 100)  +  (Time_Decay × 10)  +  Recency_TieBreak  +  Hits_Bonus
                 ▲                         ▲
                 │                         │
         Dominant factor:            Exponential erosion
       Lezione always beats        based on Kind's half-life
            Run notes              (2h, 48h, 7d, 30d)
```

#### The "Touch" Feedback Loop (Use It or Lose It)
* When a memory is returned by `recall_memory(query)`, the engine **touches** it:
  - `hits` is incremented by 1.
  - `lastUsed` timestamp is refreshed to **now**.
* **Result**: Facts that agents actively reference stay permanently fresh and survive eviction indefinitely. Facts that are never used naturally decay and get purged over time.
* **Pinned Facts (`pinned: true`)**: Pinned facts are permanently exempt from decay and eviction.

---

### Step 4: Prompt Injection — Two Distinct Strategies

How does long-term memory reach the agent when building a prompt?

```
Is a specific task or user objective available?
   │
   ├── YES ──► Task-Aware Injection (formatRelevant)
   │           Uses BM25 search against the task text to inject only contextually relevant facts.
   │           (Crucial: This injection does NOT touch hits, preventing artificial popularity).
   │
   └── NO  ──► Retention-Ranked Injection (formatForPrompt)
               Injects the top globally important durable memories (Lessons & Decisions).
```

Each memory is formatted with scannable badges that small models parse effortlessly:
```text
- [2026-08-15][LESSON] (security_auditor) Never disable TLS verification in production scripts.
- [2026-08-16][DECISION] (architect) All custom tools must return structured JSON strings.
```

---

## 5. Agent-Facing Tools & Practical Usage

Agents interact with persistent memory through 4 native tools:

### `save_memory`
Saves a durable fact or lesson into the knowledge base.
```json
{
  "content": "Windows PowerShell requires explicit UTF-8 encoding when piping non-ASCII characters.",
  "summary": "PowerShell UTF-8 encoding rule",
  "kind": "lesson"
}
```

### `recall_memory`
Searches memory using BM25 keyword matching and updates the fact's freshness.
```json
{
  "query": "PowerShell encoding pipe"
}
```

### `update_memory`
Modifies or enriches an existing memory entry.
```json
{
  "id": "mem_j8x19",
  "content": "Updated rule: PowerShell 7 uses UTF-8 natively; Windows PowerShell 5.1 needs chcp 65001.",
  "kind": "lesson"
}
```

### `forget_memory`
Permanently removes an obsolete or incorrect memory entry by ID.
```json
{
  "id": "mem_j8x19"
}
```

---

## 6. Lessons Learned from Development Errors

Building this harness provided several concrete lessons on what *not* to do with agent memory:

### ⚠️ Trap 1: Auto-saving everything into long-term memory
* **What went wrong**: In early versions, every tool output and summary was saved to `memory.json`.
* **The consequence**: Memory rapidly clogged with transient file dumps and error logs. Crucial architectural conventions were evicted within hours.
* **The fix**: Memory must be curated. Only explicit lessons, architectural decisions, and stable facts belong in persistent storage.

### ⚠️ Trap 2: Letting prompt injection refresh memory age
* **What went wrong**: Every time a fact was injected into a prompt, its `hits` was incremented and its `lastUsed` was updated.
* **The consequence**: The first 10 facts saved in a project became permanently immortal because they were injected into every prompt, preventing newer, more relevant facts from surviving.
* **The fix**: Prompt assembly uses `touch: false`. Only deliberate agent searches (`recall_memory`) count as real usage.

### ⚠️ Trap 3: Treating memory as file storage
* **What went wrong**: Agents attempted to save entire source code files via `save_memory`.
* **The consequence**: Hit the 500-character safety limit and consumed context token capacity.
* **The fix**: The workspace filesystem is the single source of truth for code; persistent memory is strictly for **meta-knowledge, rules, and conventions**.
