# Capability Fingerprinting & Benchmarks 📊

<div align="right">
  <p>Leggi in <a href="benchmark-it.md">🇮🇹 Italiano</a></p>
</div>

TSUKA does not guess a model's abilities from its filename. It **measures** them: the `/benchmark` command runs a file-driven suite of declarative tests against the live backend and stores the result as a *capability profile*. That profile — not the name string — decides which tools a model may see (tier gating) and which reasoning-effort level is worth the cost.

> **Source**: [`src/core/benchmarkTests.ts`](../src/core/benchmarkTests.ts) · [`src/core/modelProfile.ts`](../src/core/modelProfile.ts) · **Fixtures**: [`benchmarks/`](../benchmarks/) · **Storage**: `models_profile.json`

---

## 1. Why Measure Instead of Guess

Model names are a poor predictor of real behaviour, especially under 30B parameters, where two checkpoints of the same family can differ wildly in instruction-following, JSON compliance, and tool-calling. The failure modes that matter for running agents — dropping a negative constraint, hallucinating a tool argument, calling a tool it was told not to call — are exactly what the suite exercises. Measuring them turns "is this model trustworthy enough for `DANGEROUS` tools?" into a number, not a feeling.

## 2. The Command

```
/benchmark [model|all]
```

- `/benchmark <model>` runs the full suite on one model.
- `/benchmark all` (or no argument) sweeps every model known to the provider.
- A single run **sweeps all four reasoning-effort levels** and stores one profile per level (see §6).

The result is saved to `models_profile.json` and consumed immediately by the tool registry.

## 3. The Three Categories

Every test belongs to one of three categories, each producing its own 0..1 score:

| Category | What it measures | Example failure it catches |
|---|---|---|
| `instruction` | Exact adherence to constrained instructions | Writing the forbidden word anyway |
| `json` | Structured JSON output, selection and computation | Emitting a plausible-but-wrong field |
| `toolCalling` | Tool selection, argument fidelity across turns, abstention | Propagating the wrong ID across a chain |

A test can carry a `weight` (default 1) so that harder traps count more in the category average; a tool-calling test can span multiple steps to prove the model holds a parameter across turns.

## 4. The Test DSL

Tests are plain JSON files in `benchmarks/`, loaded and validated at runtime — adding or editing one requires no code change. Each file declares:

```typescript
interface BenchTest {
  name: string;
  category: 'instruction' | 'json' | 'toolCalling';
  weight?: number;                 // within the category average (default 1)
  tools?: any[];                   // OpenAI function schemas offered during the test
  prompt?: string;  checks?: BenchCheck[];   // short form: one shot
  steps?: BenchStep[];                          // long form: multi-turn
}
interface BenchStep {
  prompt?: string;     // user message for this step
  toolResult?: string; // result injected for the previous step's tool call
  checks: BenchCheck[];
}
interface BenchCheck {
  type: string;        // see the table below
  value?: any;         // expected word / number / regex / tool name
  arg?: string;        // for tool_arg_* : argument name
  path?: string;       // for json_path_* : dotted path ("items[0].name")
  flags?: string;      // regex flags
  weight?: number;     // default 1
}
```

### Check types

| Type | Asserts |
|---|---|
| `word_count` / `line_count` | exact number of words / non-empty lines |
| `first_word` / `last_word` | exact first / last word (edge punctuation stripped) |
| `contains` / `not_contains` | substring present / absent (case-insensitive by default) |
| `regex` / `not_regex` | pattern matches / does not match |
| `not_empty` | non-empty output |
| `json_valid` | output contains parseable JSON (auto-repaired before parse) |
| `json_path_equals` / `json_path_type` / `json_path_length` | value / type / array length at a dotted path |
| `tool_called` / `tool_not_called` | the (first) tool call is / is not a given name |
| `tool_arg_equals` / `tool_arg_regex` | a tool-call argument equals / matches a value |

## 5. Scoring and Tier Derivation

Each check is binary; a test's score is the weighted fraction of passing checks. A category score is the weighted average of its tests' scores, and the three category scores form the profile:

```typescript
interface ModelScores { instruction: number; json: number; toolCalling: number; }
```

`computeTier` maps those scores to a tool tier:

| Tier | Condition |
|---|---|
| `large` | `toolCalling ≥ 0.9` and `instruction ≥ 0.85` and `json ≥ 0.85` |
| `medium` | `toolCalling ≥ 0.6` and `json ≥ 0.5` |
| `small` | everything else |

The tier is what the tool registry uses: in `ToolRegistry.listForLLM`, a tool whose `requiredTier` is above the model's measured tier is simply not offered to the model. A benchmark therefore has a direct safety consequence, not just an informational one.

## 6. Reasoning-Effort Sweep

Capability depends on how hard the model is asked to think. `/benchmark` runs the suite once per level of `['none', 'low', 'medium', 'xhigh']` and stores a separate profile per level, keyed `"model@effort"` — so a profile measured at `low` is never mistaken for one measured at `xhigh`. Each profile also records `avgCompletionTokens`, which exposes over-thinking that `tokensPerSecond` alone cannot: a model that pads its output with wasted reasoning scores fast but costs tokens.

The run closes with a **recommendation**: the cheapest effort level that reaches the highest tier observed. Runtime effort (`/effort`) and the benchmark are coupled — changing effort can change the effective tier, and with it the set of visible tools.

## 7. Profile Storage and Invalidation

Profiles live in `models_profile.json`. A profile is considered valid only if two guards match:

1. `benchmarkVersion` equals the current `BENCHMARK_VERSION` (bumped when the meaning of a score changes).
2. `testsHash` equals `getBenchmarkTestsHash()` — an 8-character digest of the fixture files.

Editing any file under `benchmarks/` changes the hash and silently invalidates every existing profile, forcing a re-run rather than trusting a score measured against a different suite.

## 8. Fixture Inventory

| File | Name | Category | Form |
|---|---|---|---|
| `10_instruction_frase.json` | `frase_8_parole` | instruction | single prompt, 4 checks |
| `11_instruction_lista.json` | `lista_vincoli_negativi` | instruction | single prompt, 3 checks |
| `20_json_prodotti.json` | `json_prodotti` | json | single prompt, 7 checks |
| `21_json_annidato.json` | `json_annidato` | json | single prompt, 11 checks |
| `30_tool_catena.json` | `catena_tool_distrattori` | toolCalling · weight 2 | 2 steps |
| `31_tool_trappola.json` | `trappola_astensione` | toolCalling | single prompt, 2 checks |
| `32_tool_write_append.json` | `tool_write_append` | toolCalling · weight 2 | 2 steps |

## 9. Related Reading

- Tool tiering and the permission model: [Security & Permissions](security.md).
- How the tier reaches the model prompt: [System Architecture](architecture.md).
- The full milestone narrative: [Educational Guide](educational-guide.md).
