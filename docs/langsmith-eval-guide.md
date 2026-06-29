# LangSmith Eval Guide

How to create, run, and interpret LangSmith-based evaluations for the chatbot backend.

## Overview

The eval system runs isolated, reproducible evaluations and reports structured results to LangSmith. It covers three modes:

| Mode | Entry | What runs |
| --- | --- | --- |
| **Validator-only** (`eval_mode` omitted or `"default"`) | `input_draft` present | `runResponseValidator` on a fixed draft — no retrieval or generation |
| **Retrieval-only** (`eval_mode: "retrieval"`) | `runRetrievalEvalForScenario` | Query rewrite + Tier-3 canon retrieval — no generation |
| **Full agent turn** (`eval_mode: "agent_turn"`) | `runAgentEval` | Normal `runCharacterTurn` pipeline inside an isolated `eval_*` session, synchronous post-turn job, snapshot capture, cleanup |

Metrics captured in agent-turn mode include retrieval (including **memory rerank** decisions), validation ladder, memory writes, token usage, and latency — without touching real user sessions.

### What's implemented

- **Eval snapshot capture** (`src/eval/evalSnapshots.ts`) — side-channel data collection using Node.js `AsyncLocalStorage`. During an eval run, orchestration, validation, and memory layers record structured snapshots without changing normal function signatures.
- **Isolated eval sessions** (`src/eval/langsmith/seedEvalSession.ts`) — creates temporary sessions, messages, memories, StructMem entries, and consolidations with `eval_`-prefixed IDs.
- **Cleanup** (`src/eval/langsmith/cleanupEvalSession.ts`) — deletes all seeded data after the eval completes, even on errors.
- **Full-turn runner** (`src/eval/langsmith/runAgentEval.ts`) — seeds, runs a turn through `runCharacterTurn`, executes the post-turn job synchronously when enqueued, captures `AgentEvalOutput`, and cleans up.
- **Usage tracking** — LLM token counts and estimated cost are captured per span and aggregated.
- **Deterministic assertions** (`src/eval/evalAssertions.ts`) — reply checks, validator field checks, canon/retrieval checks, and **rerank-specific** assertion types.
- **Rerank evaluators** (`src/eval/evaluators/rerankEvaluators.ts`) — precision/recall/rejection/context-mode LangSmith evaluators (registered in `runLangSmithExperiment.ts`).
- **Rerank scenario library** (`src/eval/datasets/rerankScenarios.ts`) — labeled scenarios for memory-rerank behavior (separate from `scenarios.json`; not pushed by default).
- **Emotional-axis eval** (`src/eval/runEmotionalAxisCli.ts`, `src/eval/datasets/emotionalAxisScenarios.ts`) — covers the emotional engine (post-turn axis update, couplings, bands) and the render block, with a dedicated snapshot, 43-scenario set, axis assertion types, and five A/B variants. See [Emotional-Axis Eval](#emotional-axis-eval-engine-update--render-block).

### What's not yet implemented

- CI integration, online feedback, and multi-dataset milestone automation.
- Variant guardrails for context planner (`no_rewrite`, `structured_query`) and validator (`lightweight`) — these are recognized but fail fast with a clear error until implemented.

## Prerequisites

1. **LangSmith account** — API key from [smith.langchain.com](https://smith.langchain.com).
2. **PostgreSQL** — running with the schema migrated (`npm run db:migrate`) and canon data populated.
3. **LLM provider keys** — at minimum `OPENAI_API_KEY` (embeddings) plus generation, validator, extractor, and rerank model provider keys.
4. **Node.js** — 20+.

## Environment Setup

Add these to your `.env` (see `.env.example` for all options):

```bash
# Required for LangSmith
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=zuoran-chatbot-phase1
LANGSMITH_ENDPOINT=https://api.smith.langchain.com

# Required for eval experiments
LANGSMITH_EVAL_DATASET=zuoran-phase1-eval

# Emotional-axis eval (see the Emotional-Axis Eval section). Both default OFF;
# EMOTIONAL_ENGINE_ENABLED=true is required for the update side, plus
# EMOTIONAL_RENDER_ENABLED=true for the render side. The push writes to a dedicated
# dataset (LANGSMITH_EMOTIONAL_AXIS_EVAL_DATASET, default emotional-axis-${LANGSMITH_EVAL_DATASET});
# point LANGSMITH_EVAL_DATASET at it to run the experiment.
EMOTIONAL_ENGINE_ENABLED=true
EMOTIONAL_RENDER_ENABLED=true
# LANGSMITH_EMOTIONAL_AXIS_EVAL_DATASET=emotional-axis-zuoran-phase1-eval

# Experiment naming prefix (default: "zuoran")
# LANGSMITH_EXPERIMENT_PREFIX=zuoran

# Trace metadata (auto-attached to every run)
TRACE_ENVIRONMENT=development   # or staging / production
APP_VERSION=dev                 # your app version tag
GIT_SHA=unknown                 # set to $(git rev-parse HEAD) for CI
TRACE_PLAYER_HASH_SALT=zuoran-local-trace-salt

# Memory rerank (used during agent_turn evals)
MEMORY_RERANK_MODEL=EXTRACTOR_MODEL
MEMORY_RERANK_MAX_CANDIDATES=24
MEMORY_RERANK_MAX_SELECTED=8
MEMORY_RERANK_TIMEOUT_MS=30000

# Tier-4 attribution judge scenarios (optional)
# VALIDATOR_STRICT_ATTRIBUTION=1

# LLM judge evaluation (optional, default: disabled)
# EVAL_ENABLE_LLM_JUDGE=0

# Attribution judge model (optional, defaults to extractor model)
# VALIDATOR_ATTRIBUTION_JUDGE_MODEL=deepseek:deepseek-chat
```

Verify your config works:

```bash
npm run typecheck
```

## Architecture

### Eval flow (agent_turn mode)

```
LangSmith example (from dataset)
  │
  ▼
normalizeAgentEvalInput()      ← parse + validate input fields
  │
  ▼
seedEvalSession()              ← insert eval_* rows into DB
  │
  ▼
createAgentEvalCapture()       ← start AsyncLocalStorage context
  │
  ▼
withTraceContext({ eval: true })
  │
  ▼
runCharacterTurn()             ← normal pipeline inside capture
  │  ├── classifyTurnRoute()
  │  ├── resolveContext()      → planContext, retrieval, llm.memory_rerank
  │  │                           → recordRetrievalSnapshot() (incl. rerank)
  │  ├── generateAndValidate() → recordValidationAttempt/Snapshot()
  │  └── llm calls             → recordLlmUsageSnapshot() (via tracing)
  │
  ▼
postTurnRunner.runJobByIdForEval()  ← synchronous post-turn (roleplay_turn only)
  │  ├── writeInteractiveMemory()   → incrementDurableMemoryStatus()
  │  ├── writeSessionMemoryChunk()  → incrementSessionChunkWrite()
  │  ├── writeStructMemTurn()       → recordMemoryWriteSnapshot()
  │  └── maybeCompactSessionSummary() → recordMemoryWriteSnapshot()
  │
  ▼
buildAgentEvalOutput()         ← aggregate all snapshots
  │
  ▼
cleanupEvalSession()            ← DELETE all eval_* rows
  │
  ▼
LangSmith evaluators           ← assertionsEvaluator, retrievalQualityEvaluator
```

Post-turn jobs are enqueued only when the persisted route is `roleplay_turn`. App-command and unsupported eval routes skip background memory work.

### Snapshot types captured

| Snapshot | What it captures | Recorded by |
| --- | --- | --- |
| `RetrievalEvalSnapshot` | Retrieved vs injected IDs per source, drop reasons, query intent, timings, **rerank selected/rejected/finalContextMode/fallbackUsed** | `orchestration/context/resolveContext.ts` |
| `ValidationEvalSnapshot` | Each validation attempt, final pass/rewrite/deflection state | `orchestration/generation/generateAndValidate.ts` |
| `MemoryWriteEvalSnapshot` | Post-turn job status, extraction counts, write plan, durable/session/structmem write counts, summary compaction | `jobs/postTurnRunner.ts`, memory write modules, `orchestration/persistence/turnPersistence.ts` |
| `UsageEvalSnapshot` | Per-LLM-span input/output tokens, estimated cost, aggregated totals | `observability/langsmithTracing.ts` |
| `EmotionalAxisEvalSnapshot` | **Update side:** classified `event`, `eventDeltas`, `couplingsFired`, `axesBefore`/`axesAfter`, `bandsAfter`, `effectiveBaselines`, `conditionTransitions`, `tick`, `scope`. **Render side:** `render.{source, renderRuleIds, renderBlock, tier, bands}` | post-turn graph (update) + prompt-context render (render); see [Emotional-Axis Eval](#emotional-axis-eval-engine-update--render-block) |

### Isolation guarantees

- **Session IDs** — prefixed with `eval_<scenarioId>_<uuid>`.
- **Player IDs** — prefixed with `eval_<scenarioId>_<uuid>`.
- **Memory namespaces** — use the isolated player ID (retrieval never crosses into real user data).
- **`source: "eval_seed"`** — seeded StructMem rows carry this metadata marker.
- **Cleanup always runs** — `cleanupEvalSession` deletes eval rows even when the turn throws.

## Running Unit Tests

```bash
npm run test:unit
```

Relevant test files:

| Test file | Covers |
| --- | --- |
| `src/eval/evalSnapshots.unit.ts` | Snapshot capture, retrieval (incl. rerank), validation recording, LLM usage accumulation, `buildAgentEvalOutput` |
| `src/eval/langsmith/runAgentEval.unit.ts` | `normalizeAgentEvalInput` — legacy snake_case fields, `primed_memories` alias |
| `src/orchestration/retrieval/memoryRerank.unit.ts` | Rerank prompt, parsing, timeout, empty-selection guard |
| `src/orchestration/retrieval/retrievalDiagnostics.unit.ts` | Diagnostics payload including rerank timing |
| `src/observability/traceMetadata.unit.ts` | Trace metadata construction, player ID hashing |
| `src/observability/traceTags.unit.ts` | Tag generation and sanitization |

Run a single test file:

```bash
npx tsx --test src/eval/evalSnapshots.unit.ts
```

## Creating Eval Scenarios

Primary scenarios live in `src/eval/scenarios.json` (currently **v2.1**). Each scenario defines seed data and assertions.

Rerank-focused scenarios are maintained separately in `src/eval/datasets/rerankScenarios.ts` for future dataset integration.

### Validator-only scenario (default mode)

Uses `input_draft` — no live generation. This is what most rows in `scenarios.json` use today.

```json
{
  "id": "no_ai_claim",
  "description": "Character must not claim to be an AI or assistant",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world"
  },
  "messages": [
    { "role": "user", "content": "你是AI吗?" }
  ],
  "assertions": [
    {
      "type": "not_contains",
      "value": "AI",
      "description": "Reply must not contain the word AI"
    },
    {
      "type": "validator_pass",
      "field": "in_character",
      "description": "Validator must score in_character=true"
    }
  ]
}
```

For validator-only rows without `input_draft`, `npm run eval` prints a stub message and cannot check reply content. LangSmith `evalTarget` returns `mode: "skipped"` for those rows.

### Tier-4 attribution judge scenario

Requires `VALIDATOR_STRICT_ATTRIBUTION=1`. LangSmith skips `tier4_attribution_unsupported_first_visit` when strict mode is off.

```json
{
  "id": "tier4_attribution_unsupported_first_visit",
  "group": "tier4_attribution_judge",
  "description": "Unsupported first-visit agency claim should force rewrite",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_engaged",
    "continuity_family": "main_world"
  },
  "input_draft": "第一次是她临时起意拉他去的。",
  "validator_retrieved_canon": "（评测固件）枫河露营公园：两人首次同往为临时出行…",
  "assertions": [
    {
      "type": "validator_field",
      "field": "canon_consistent",
      "expected": false,
      "description": "Unsupported attribution should mark canon_consistent false"
    },
    {
      "type": "validator_field",
      "field": "needs_rewrite",
      "expected": true,
      "description": "Unsupported attribution should request rewrite"
    }
  ]
}
```

### Scenario with eval_mode: "retrieval"

Skips generation — tests Tier-3 canon retrieval only.

```json
{
  "id": "canon_retrieval_tier3_scene_1",
  "description": "Tier 3 retrieval should find a specific canon scene",
  "group": "retrieval",
  "eval_mode": "retrieval",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world"
  },
  "messages": [
    { "role": "user", "content": "Tell me about the first time we met at the cafe" }
  ],
  "retrieval_expected_needle": "cafe_first_meeting",
  "assertions": [
    {
      "type": "retrieval_min_anchors",
      "min_scenes": 1,
      "description": "At least 1 canon scene should be found"
    },
    {
      "type": "canon_contains_all",
      "values": ["expected_substring"],
      "description": "Retrieved canon must contain required needles"
    }
  ]
}
```

### Scenario with eval_mode: "agent_turn"

Runs the full isolated pipeline. Add `"eval_mode": "agent_turn"` to the scenario and push to LangSmith (not currently present in `scenarios.json` v2.1, but supported by `runAgentEval`).

```json
{
  "id": "memory_recall_coffee",
  "description": "Agent should recall a seeded durable memory about coffee preference",
  "group": "memory_retrieval",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "Hey, do you remember what I told you about drinks?", "turn_index": 1 },
    { "role": "assistant", "content": "You mentioned something about coffee, right?", "turn_index": 2 },
    { "role": "user", "content": "What's my favorite drink?", "turn_index": 3 }
  ],
  "durableMemories": [
    {
      "summary": "Player loves black coffee, no sugar or milk, prefers dark roasts",
      "memoryType": "preference",
      "importanceScore": 0.9
    }
  ],
  "assertions": [
    {
      "type": "contains_any",
      "values": ["coffee", "黑咖啡"],
      "description": "Reply must mention coffee"
    }
  ]
}
```

`primed_memories` is accepted as an alias for `durableMemories` (see `remember_promise` in `scenarios.json`).

### Available assertion types

Implemented in `src/eval/evalAssertions.ts`:

| Type | Fields | Description |
| --- | --- | --- |
| `not_contains` | `value` | Reply must NOT contain substring |
| `contains_any` | `values` | Reply must contain AT LEAST ONE substring |
| `validator_pass` | `field` | Validator boolean field must be `true` (validator-only mode) |
| `validator_field` | `field`, `expected` | Validator field must equal expected value |
| `attribution_supported_by_canon` | `reply_attribution_patterns`, `canon_support_needles` | Attribution patterns in reply require canon support |
| `no_unsupported_attribution` | `reply_entity_markers`, `canon_support_needles` | Entity markers require canon corroboration |
| `canon_contains_all` | `values` | Retrieved canon must contain all needles (retrieval mode) |
| `retrieval_min_anchors` | `min_scenes` | Minimum scene anchor count (retrieval mode) |
| `no_memory_written` | — | Placeholder (always passes; manual verification) |
| `rerank_selected_ids` | `values` | All listed IDs must appear in rerank selection |
| `rerank_rejected_ids` | `values` | Listed IDs must NOT appear in rerank selection |
| `rerank_context_mode` | `value` | Rerank `finalContextMode` must match (e.g. `recent_only`, `selected_memory`) |
| `rerank_no_fallback` | — | Reranker must not fall back to deterministic selector |
| `max_irrelevant_selected` | `values` (forbidden sources), `min_scenes` (max count) | Cap irrelevant source selections |
| `turn_event_type` | `value` | Classified `emotionalAxis.event.type` must equal value (axis) |
| `axis_delta_sign` | `field` (axis), `value` (`+`/`-`/`stable`) | Sign of `eventDeltas[axis]` this tick (axis) |
| `axis_after_between` | `field` (axis), `value` (`"min,max"`) | `axesAfter[axis]` must fall in range (axis) |
| `axis_band_equals` | `field` (axis), `value` (`high`/`mid`/`low`) | `bandsAfter[axis]` must equal value (axis) |
| `couplings_fired_contains` | `values` (coupling ids) | All listed couplings must have fired (axis) |
| `couplings_fired_not_contains` | `values` (coupling ids) | None of the listed couplings may have fired (axis) |
| `effective_baseline_shifted` | `field` (axis), `value` (`+`/`-`), `min_scenes` (min magnitude) | `effectiveBaselines[axis]` shifted vs `resolvedBaselines[axis]` (axis) |
| `condition_transition` | `field` (coupling id), `expected` (from bool), `value` (`true`/`false` = to) | A coupling condition flipped from→to this tick (axis) |
| `render_rule_triggered` | `values` (rule ids R1–R8) | All listed render rules must be in `render.renderRuleIds` (axis) |
| `render_block_contains` | `value` | Injected `render.renderBlock` must contain substring (axis) |
| `render_block_not_contains` | `value` | Injected `render.renderBlock` must NOT contain substring (axis) |

Axis assertions (marked **(axis)**) read `ctx.emotionalAxis` and **fail closed** when the relevant snapshot field is absent. See [Emotional-Axis Eval](#emotional-axis-eval-engine-update--render-block).

**Note:** `agent_turn` LangSmith rows currently expose `ValidationEvalSnapshot`, not raw `ValidationResult`. Use `contains_*` / `not_contains` reply assertions for full-turn evals; use `validator_*` assertions in validator-only rows with `input_draft`.

### Seed data reference

All seed fields are optional except `session`.

| Field | Type | Description |
| --- | --- | --- |
| `session` | object | **Required.** `mode`, `continuity_scope`, `continuity_family`, optional `writeback_policy` |
| `messages` | array | Conversation history. Last user message is the eval input unless `userMessage` overrides. Each: `{ role, content, turn_index? }` |
| `userMessage` | string | Override eval input message |
| `primed_memories` | array | Alias for `durableMemories` (legacy name still supported) |
| `sessionSummary` | string | Pre-seeded session summary text |
| `sessionState` | object | Pre-seeded derived state |
| `durableMemories` | array | Pre-seeded interactive memory rows |
| `sessionChunks` | array | Pre-seeded session memory chunks |
| `structMemEntries` | array | Pre-seeded StructMem entries |
| `structMemConsolidations` | array | Pre-seeded StructMem consolidations |
| `canonReferenceIds` | string[] | Expected canon reference IDs (documentation / future use) |
| `configOverrides` | object | Override pipeline config for this eval only |
| `seedAxisState` | object | Pre-turn emotional-axis state (`axes`, `bands`, `tick`, `lastTrace`, `history`). Top-level `tick` is auto-clamped to the last seeded turn so the eval turn always advances the engine (see [Emotional-Axis Eval](#emotional-axis-eval-engine-update--render-block)) |
| `input_draft` | string | Fixed draft for validator-only eval |
| `validator_retrieved_canon` | string | Canon excerpt passed to validator in validator-only eval |
| `retrieval_expected_needle` | string | Needle substring for retrieval-quality metrics |

### Writing effective scenarios

- **One thing per scenario** — test retrieval, generation, validation, rerank, or memory write separately when possible.
- **Seed enough context** — bare scenarios often deflect or produce generic replies in agent-turn mode.
- **Use specific assertion values** — prefer `contains_any` with domain-specific terms over generic phrases.
- **Set `writeback_policy: "no_writeback"`** unless testing memory writes (reduces post-turn side effects).
- **Retrieval rows** need live DB + canon embeddings; validator rows need only validator model access.
- **Rerank rows** need `eval_mode: "agent_turn"` and rerank assertion context (or manual `runAllAssertions` with `AssertionContext.rerank`).
- Eval traces automatically get tag `eval:true` and metadata `scenarioId`, `evalSessionId`, `evalMode`.

## Local Regression Eval (no LangSmith)

```bash
npm run eval
npm run eval -- --scenario no_ai_claim
npm run eval:retrieval
```

`runEval.ts` supports:

- **Retrieval mode** — full Tier-3 retrieval against live DB
- **Validator mode** — when `input_draft` is set
- **Other rows** — stub reply with a warning (no full turn)

Full agent-turn replay is **not** wired into `npm run eval`; use LangSmith or call `runAgentEval` directly.

## Pushing Datasets to LangSmith

```bash
npm run eval:dataset:push
```

Reads `src/eval/scenarios.json`, converts each scenario via `scenarioToEvalInputs()`, and uploads to `LANGSMITH_EVAL_DATASET`. Existing examples in that dataset are deleted first, then recreated.

### Scenario set selection

Control which scenarios are pushed with the `EVAL_SCENARIO_SET` env var:

| Value | Scenarios included |
|-------|-------------------|
| `default` (or unset) | `scenarios.json` only |
| `rerank` | Rerank scenarios from `src/eval/datasets/rerankScenarios.ts` only |
| `probes` | Probe scenarios from `src/eval/datasets/probeScenarios.ts` only |
| `emotional_axis` | Emotional-axis scenarios from `src/eval/datasets/emotionalAxisScenarios.ts` only (43 rows). Pushed to a **dedicated** dataset — see [Emotional-Axis Eval](#emotional-axis-eval-engine-update--render-block) |
| `all` | `scenarios.json` + rerank scenarios + probe scenarios |

Examples:

```bash
# Push only rerank scenarios
EVAL_SCENARIO_SET=rerank npm run eval:dataset:push

# Push default + rerank scenarios
EVAL_SCENARIO_SET=all npm run eval:dataset:push

# Push only probe scenarios
EVAL_SCENARIO_SET=probes npm run eval:dataset:push

# Push probes to a dedicated dataset (recommended — keeps probes separate from regression set)
LANGSMITH_EVAL_DATASET=zuoran-probes-eval EVAL_SCENARIO_SET=probes npm run eval:dataset:push
```

Custom dataset name:

```bash
LANGSMITH_EVAL_DATASET=zuoran-memory-retrieval-v1 npm run eval:dataset:push
```

Assertions are stored on example **metadata** (`metadata.assertions`), not in inputs.

Rerank-labeled examples also carry `expected_selected_ids`, `expected_rejected_ids`, and `expected_final_context_mode` in metadata when present on the scenario.

## Running LangSmith Experiments

> **For local regression gating without LangSmith, use `npm run eval:probe-gate` instead.**
> See the [Headless probe-gate runner](#headless-probe-gate-runner-evalprobe-gate) section below.

```bash
npm run eval:langsmith
```

`src/eval/runLangSmithExperiment.ts`:

1. Reads the dataset named by `LANGSMITH_EVAL_DATASET`.
   - **Cannot filter by scenario ID** — it always runs every example in the dataset. To run a subset, push to a dedicated dataset and set `LANGSMITH_EVAL_DATASET` accordingly, or use `npm run eval:agent -- --scenario <id>` for local single-turn runs.
2. The experiment name is prefixed with `LANGSMITH_EXPERIMENT_PREFIX` (default: `"zuoran"`). Use this env var to distinguish experiment series.
3. Dispatches each example:
   - `eval_mode: "agent_turn"` → `runAgentEval()` (full isolated turn)
   - `eval_mode: "retrieval"` → `runRetrievalEvalForScenario()`
   - `input_draft` present → validator-only
   - otherwise → `mode: "skipped"`
4. Runs evaluators:
   - `assertionsEvaluator` — deterministic assertion checks (incl. rerank for `agent_turn` rows)
   - `retrievalQualityEvaluator` — anchor counts and needle hits (retrieval mode only)
   - `rerankSelectionPrecision`, `rerankSelectionRecall`, `rerankRejectionAccuracy`, `rerankContextModeAccuracy`, `rerankCompositeScore` — rerank metrics
5. Flushes pending LangSmith traces via `flushLangSmithClient()` before exit (ensures all telemetry is submitted even on error).
6. Exits with code 1 if any row fails `all_assertions_pass`.

**Terminal output example:**

```
no_ai_claim  all_assertions_pass=false  ...
tier3_scene_query  all_assertions_pass=true  All assertions passed.
Experiment: zuoran-eval-abc123
 Rows processed: 15, failed: 2
```

**Concurrency:** `maxConcurrency: 1` (sequential) to avoid DB contention on shared canon tables.

### Running experiments by variant

Use env vars to select rerank, retrieval, and validator variants:

```bash
# Default (current) behavior
npm run eval:langsmith

# Deterministic-only rerank (no LLM rerank call)
RERANK_VARIANT=deterministic_only npm run eval:langsmith

# Hybrid score rerank (non-LLM score+priority selector)
RERANK_VARIANT=hybrid_score npm run eval:langsmith

# LLM rerank with smaller/cheaper model (set MEMORY_RERANK_MODEL)
RERANK_VARIANT=llm_rerank_smaller_model MEMORY_RERANK_MODEL=deepseek:deepseek-chat npm run eval:langsmith

# HyDE-enabled retrieval (requires CANON_QUERY_HYDE=1)
RETRIEVAL_VARIANT=hyde_enabled CANON_QUERY_HYDE=1 npm run eval:langsmith

# Motif-probe retrieval (requires STRUCTMEM_MOTIF_PROBE_ENABLED=1)
RETRIEVAL_VARIANT=motif_probe_enabled STRUCTMEM_MOTIF_PROBE_ENABLED=1 npm run eval:langsmith

# Strict-attribution validator (requires VALIDATOR_STRICT_ATTRIBUTION=1)
VALIDATOR_VARIANT=strict_attribution VALIDATOR_STRICT_ATTRIBUTION=1 npm run eval:langsmith

# Combined variants
RERANK_VARIANT=hybrid_score RETRIEVAL_VARIANT=hyde_enabled CANON_QUERY_HYDE=1 npm run eval:langsmith

# Emotional-axis variant — requires EVAL_SCENARIO_SET=emotional_axis and the
# emotional-axis dataset. The variant is applied to agent_turn runtime behavior
# via withEmotionalAxisEvalConfig, not just trace tags/metadata.
EMOTIONAL_AXIS_VARIANT=axis_state_no_render EMOTIONAL_ENGINE_ENABLED=1 npm run eval:emotional-axis:langsmith

# Full render variant — requires both engine and render gates
EMOTIONAL_AXIS_VARIANT=full_axis_coupling_render EMOTIONAL_ENGINE_ENABLED=1 EMOTIONAL_RENDER_ENABLED=1 npm run eval:emotional-axis:langsmith

# Baseline variant — no emotional-engine gates required
EMOTIONAL_AXIS_VARIANT=baseline_no_emotional_axis npm run eval:emotional-axis:langsmith
```

#### Variant guardrails

The `validateExperimentVariants()` function in `src/eval/experimentVariants.ts` checks that selected variants are compatible with the current environment:

- `RETRIEVAL_VARIANT=hyde_enabled` requires `CANON_QUERY_HYDE=1`
- `RETRIEVAL_VARIANT=motif_probe_enabled` requires `STRUCTMEM_MOTIF_PROBE_ENABLED=1`
- `VALIDATOR_VARIANT=strict_attribution` requires `VALIDATOR_STRICT_ATTRIBUTION=1`
- `CONTEXT_PLANNER_VARIANT=no_rewrite` — not yet implemented, fails fast
- `CONTEXT_PLANNER_VARIANT=structured_query` — not yet implemented, fails fast
- `VALIDATOR_VARIANT=lightweight` — not yet implemented, fails fast

**Emotional-axis** variant gate matrix (checked by `preflightEmotionalAxisLangSmithRun()` in `src/eval/preflightLangSmith.ts` for LangSmith runs, and by `validateEmotionalAxisVariantGuard()` in `src/eval/experimentVariants.ts` for the local CLI):

| Variant | Requires gate |
|---------|--------------|
| `baseline_no_emotional_axis` | None |
| `axis_state_no_render` | `EMOTIONAL_ENGINE_ENABLED=1` |
| `full_axis_coupling_render` | `EMOTIONAL_ENGINE_ENABLED=1` + `EMOTIONAL_RENDER_ENABLED=1` |
| `engine_no_coupling_full_render` | `EMOTIONAL_ENGINE_ENABLED=1` + `EMOTIONAL_RENDER_ENABLED=1` |
| `axis_bands_only` | `EMOTIONAL_ENGINE_ENABLED=1` + `EMOTIONAL_RENDER_ENABLED=1` |

`baseline_no_emotional_axis` requires no production gates and can run with engine/render disabled. Error messages name the selected variant and the missing env var.

Validation runs at experiment startup; misconfigured variants produce clear error messages before any model calls or traces.

#### Variant alias shortcuts

The `RERANK_VARIANT` env var accepts shorthand aliases in addition to full variant names:

| Full value | Alias |
|------------|-------|
| `llm_rerank_v1` | `llm_v1` |
| `llm_rerank_smaller_model` | `smaller_model` |
| `hybrid_score` | `hybrid` |
| `deterministic_only` | `deterministic` |

These are resolved in `experimentVariants.ts`. Other variant env vars (`RETRIEVAL_VARIANT`, `VALIDATOR_VARIANT`, `CONTEXT_PLANNER_VARIANT`) do not currently have aliases.

### LLM Judge for Probe Experiments

The internal-logic probe set (`src/eval/datasets/probeScenarios.ts`) includes an **LLM-as-judge** evaluator that auto-scores each probe reply on a 6-dimension rubric (Traceability, State fit, Transition friction, Style stability, Canon caution, Anti-self-analysis).

### How it works

The judge is registered as a LangSmith evaluator in `runLangSmithExperiment.ts`. It:

1. **Gates on `EVAL_ENABLE_LLM_JUDGE=1`** — default-off; with the flag off, no judge LLM call is made and no `judge_*` feedback keys appear.
2. **Fires only for probe rows** (`group === "probes"` with `mode === "agent_turn"` and non-empty reply) — non-probe rows short-circuit before any LLM call.
3. **Calls `chatJsonWithFallback`** on the **validator model** (`models.validator` + `models.fallbacks.responseValidator`), the same binding used by `runResponseValidator`.
4. **Emits 7 feedback keys** per probe row:
   - `judge_traceability` (1–5)
   - `judge_state_fit` (1–5)
   - `judge_transition_friction` (1–5)
   - `judge_style_stability` (1–5)
   - `judge_canon_caution` (1–5)
   - `judge_anti_self_analysis` (1–5)
   - `judge_composite` (mean of the six)
5. **Per-probe `expected_behavior`** from example metadata is injected into the judge prompt to anchor scoring to the specific probe's target.
6. **Non-gating** — judge scores are NEVER read by the `failedRows` loop (which only checks `all_assertions_pass`). They are tracked metrics for before/after comparison only, visible in LangSmith **Experiments → Compare**.
7. **Untraced evaluator** — the judge is registered as a `RunEvaluator` object (not a plain function evaluator). This bypasses LangSmith's `DynamicRunEvaluator` wrapper and prevents creating separate traced judge runs in the `evaluators` project. Judge feedback remains visible on experiment rows, but the judge itself does not consume LangSmith trace quota. This is the intended design for `npm run eval:langsmith`.

### Running probe experiments with the judge

```bash
# Step 1 — push probes to a dedicated dataset (one time, or whenever probe set changes)
LANGSMITH_EVAL_DATASET=zuoran-probes-eval EVAL_SCENARIO_SET=probes npm run eval:dataset:push

# Step 2 — run with judge enabled
EVAL_ENABLE_LLM_JUDGE=1 LANGSMITH_EVAL_DATASET=zuoran-probes-eval npm run eval:langsmith
# → 7 judge_* feedback keys visible in LangSmith Compare

# Without judge (default)
LANGSMITH_EVAL_DATASET=zuoran-probes-eval npm run eval:langsmith
# → No judge feedback keys; no judge LLM cost
```

### Viewing judge scores in LangSmith

1. Open **Experiments → Compare** and select two experiment runs.
2. Each probe row shows `judge_*` feedback keys in the **Feedback** column.
3. `judge_composite` gives a quick directional signal; individual dimension scores show which area (e.g. `judge_canon_caution`) changed.
4. Click a run to see the judge's **rationale** for each dimension score in the feedback comment.

### Calibration

The judge's scores are directional, not authoritative. Before trusting scores for decision-making, run a calibration experiment with `EVAL_ENABLE_LLM_JUDGE=1` and compare the judge's per-probe dimension scores against the human-scored sheet in `docs/character/zuoran_internal_logic_probe_results.md`:

| Check | Expected |
|-------|----------|
| Known-weak probes (P06, P07) | Low `judge_canon_caution` (≤2) |
| Relationship-boundary probe (P08) | Low `judge_state_fit` / `judge_traceability` |
| Strong probes (P09, P11) | High composite (≥4) |

If the judge consistently disagrees with the human sheet on a dimension, adjust the `expected_behavior` lines in `probeScenarios.ts` or — as a last resort — the prompt wording in `internalLogicJudge.ts`.

### Probe IDs and categories

| ID | Category |
|----|----------|
| `probe_relaxed_morning` | Relaxed scene |
| `probe_work_discussion` | Normal scene |
| `probe_post_argument` | Pressure scene |
| `probe_disclosure_pressure` | Type 5 disclosure-pressure |
| `probe_forceful_format` | Type 2 forceful-format |
| `probe_false_premise_with_fact` | Type 1 false-premise (fact in context) |
| `probe_false_premise_no_fact` | Type 1 false-premise (fact not in context) |
| `probe_relationship_boundary` | Relationship-boundary |
| `probe_warmth_concern` | Warmth/concern |
| `probe_risk_control` | Risk-control |
| `probe_social_pressure` | Social pressure |
| `probe_regret_apology` | Regret/apology |

**Note:** `all_assertions_pass=false` for probes is expected — they have `assertions: []`. The judge scores (`judge_*`) are the meaningful metrics for probe rows.

### Headless probe-gate runner (`eval:probe-gate`)

The headless probe-gate runner (`src/eval/runInternalLogicProbeGate.ts`) provides a **LangSmith-independent regression gate** for the internal-logic probe set. It is the intended CI-ready mechanism for detecting regressions in character behavior.

#### How it differs from `eval:langsmith`

| Aspect | `npm run eval:langsmith` | `npm run eval:probe-gate` |
|--------|--------------------------|---------------------------|
| Purpose | Tracked experiment comparison | Local regression gating |
| LangSmith | Required (experiment + traces) | Actively suppressed (traces not emitted) |
| Judge feedback | Logged to experiment rows (non-gating) | Used for pass/fail decision |
| Thresholds | None (judge scores are tracked metrics only) | TG2 threshold expectations enforced |
| Exit code | Based on `all_assertions_pass` only | Based on probe-gate threshold failures |
| CI readiness | Requires LangSmith credentials and quota | Works headlessly — traces suppressed via `withLangSmithTracingSuppressed` |

#### Running the probe gate

```bash
npm run eval:probe-gate
```

The runner:
1. Loads all 12 probe scenarios from `src/eval/datasets/probeScenarios.ts` (those with `group === "probes"` and `eval_mode === "agent_turn"`).
2. Runs each probe through the existing isolated agent eval pipeline (`runAgentEval`).
3. Scores each reply with the internal-logic LLM judge.
4. Applies the configured TG2 threshold expectations.
5. Prints a compact per-probe PASS/FAIL report with failure details (dimension, observed score, threshold, rationale).
6. Exits with code **0** when all probes pass, **1** when any probe fails.

#### Report example

```
=== Internal-Logic Probe Gate Report ===

  PASS  probe_relaxed_morning: P01: Relaxed morning scene — ...
        reply_len=342

  FAIL  probe_false_premise_with_fact: P06: False premise about canon — ...
        reply_len=198
        [canon_caution] dimension_below_threshold: observed=1, threshold=2
          Dimension "canon_caution" score 1 below threshold 2

Probes: 12 total, 11 passed, 1 failed, 0 skipped
```

The report shows the scenario ID and description, reply length, and for each failure: the dimension name, failure type, observed score, configured threshold, and judge rationale comment when available.

#### Threshold expectations

Active thresholds are defined in `src/eval/evaluators/probeGateThresholds.ts` as `PROBE_GATE_EXPECTATIONS`. Each expectation specifies:
- `minComposite` — minimum mean composite score (1–5).
- `dimensions` — per-dimension minimum thresholds only for dimensions meaningful to that probe.
- `criticalDimensions` — dimensions where a null score (judge failure) fails the gate.

Thresholds are intentionally conservative to avoid flakiness from LLM-as-judge variance. See the probe-specific notes in the file for each expectation's rationale.

#### Requirements

- Live PostgreSQL database with migrated schema and canon data.
- LLM provider keys for the model pipeline (generation, validation, etc.).
- **No LangSmith credentials required** — the runner actively suppresses LangSmith tracing for the full run via `withLangSmithTracingSuppressed`, so no traces are emitted even when `LANGSMITH_TRACING=true`. It does not use `langsmith.evaluate()`.
- The runner does require model API keys, including the model used for the internal-logic judge (`models.validator`).

### Rerank LangSmith evaluators

`src/eval/evaluators/rerankEvaluators.ts` exports:

- `rerankSelectionPrecision`
- `rerankSelectionRecall`
- `rerankRejectionAccuracy`
- `rerankContextModeAccuracy`
- `rerankCompositeScore`

These read `outputs.retrieval.rerank` and example `metadata.expected_selected_ids` / `expected_rejected_ids` / `expected_final_context_mode`. They return `score: null` with a descriptive comment when no rerank snapshot is available, making them safe for mixed datasets.

### Full-turn agent eval CLI

Run a single agent-turn scenario locally without pushing to LangSmith:

```bash
# Run a specific scenario
npx tsx src/eval/runAgentEvalCli.ts --scenario <id>

# Or using the npm script
npm run eval:agent -- --scenario <id>

# Load rerank scenarios
EVAL_SCENARIO_SET=rerank npx tsx src/eval/runAgentEvalCli.ts --scenario rerank_001_immediate_action_no_memory

# Load probe scenarios
EVAL_SCENARIO_SET=probes npx tsx src/eval/runAgentEvalCli.ts --scenario probe_relaxed_morning
```

The CLI:
- Requires `--scenario <id>`
- Rejects scenarios without `eval_mode: "agent_turn"`
- Loads scenarios from the selected scenario set (`default`, `rerank`, `probes`, `all`)
- Prints compact JSON with success, latency, usage, cleanup, and rerank summary
- Is manual-only and may call live models

Output example:

```json
{
  "scenarioId": "rerank_001_immediate_action_no_memory",
  "success": true,
  "latencyMs": 2340,
  "usage": {
    "totalInputTokens": 1234,
    "totalOutputTokens": 89,
    "estimatedCostUsd": 0.0032
  },
  "cleanup": { "attempted": true, "completed": true },
  "rerank": {
    "selected": 3,
    "rejectedCount": 12,
    "finalContextMode": "selected_memory",
    "fallbackUsed": false
  }
}
```

## Emotional-Axis Eval (engine update + render block)

The emotional-axis harness extends `agent_turn` evals to cover the **emotional engine** (post-turn axis update, couplings, bands) and the **render block** (the emotion-derived text injected into the system prompt). It reuses the same isolated-session machinery (`seedEvalSession` → `runCharacterTurn` → synchronous post-turn → `cleanupEvalSession`) and adds a dedicated snapshot, scenario set, axis assertion types, and five A/B variants.

**Design notes:**
- **D7** — variant behavior is controlled by an *injected* config (`setEmotionalAxisEvalConfig`), never by mutating env globals. The engine gate (`postTurnMemoryGraph`) and render gate (`buildPromptContext`) read this config.
- **D8** — assertions check *internal conformance* (event classification, delta signs, bands, couplings, render rules), not external ground-truth accuracy. Model-vs-author event-classification differences are expected signal, not bugs.

### Snapshot — `EmotionalAxisEvalSnapshot`

Captured on `outputs.emotionalAxis` (`src/eval/evalSnapshots.ts`):

| Side | Fields |
| --- | --- |
| **Update** | `event {type, intensity, reason}`, `modelReportedConfidence`, `axesBefore`, `eventDeltas`, `couplingsFired[]`, `effectiveBaselines`, `conditionTransitions[]`, `axesAfter`, `bandsAfter`, `tick`, `scope`, `resolvedBaselines` |
| **Render** | `render { source, sourceTick, bands, renderRuleIds[], renderBlock, tier (A/B/C), resolvedBaselines }` — `source` is `persisted_axis_state` (normal) or `scope_baseline_synthetic` (fallback when no persisted state exists) |

### Scenarios

43 scenarios in `src/eval/datasets/emotionalAxisScenarios.ts`, loaded with `EVAL_SCENARIO_SET=emotional_axis`. Grouped by ID prefix:

| Prefix | Count | Focus |
| --- | --- | --- |
| `AX` | 12 | Update side — event classification + axis deltas |
| `CP` | 6 | Couplings (`zr_c1`/`zr_c2`/`zr_c3`) and baseline shifts |
| `RENDER` | 9 | Render rules R1–R8 and render-block content |
| `S6` | 4 | Scope / baseline resolution |
| `TRAJ-ESC` | 3 | Escalation trajectory (multi-turn) |
| `TRAJ-INT` | 4 | Intimacy trajectory (multi-turn) |
| `TRAJ-SC` | 5 | Slow-burn / accumulation trajectory (multi-turn) |

Scenarios carry a `seedAxisState` field (pre-turn axis state). **The seed's top-level `tick` is auto-clamped** to the last seeded turn (`clampSeedAxisTick`) so the eval turn always advances the engine. Without this, a seed authored at the eval turn's tick collides with the engine's idempotency guard (`persisted.tick >= tick`) and the update snapshot is silently dropped.

### Variants (5)

Selected with `--variant <name>` (CLI) or `EMOTIONAL_AXIS_VARIANT` (env); default `full_axis_coupling_render`.

| Variant | engine | render | couplings | render output |
| --- | --- | --- | --- | --- |
| `baseline_no_emotional_axis` | off | off | — | — |
| `axis_state_no_render` | on | off | on | none |
| `full_axis_coupling_render` (default) | on | on | on | full |
| `engine_no_coupling_full_render` | on | on | **off** | full |
| `axis_bands_only` | on | on | on | band line only (rule texts suppressed) |

### Local CLI — `eval:emotional-axis`

The fast inner loop. Runs scenarios through `runAgentEval`, evaluates axis assertions against the snapshot, and writes reports to `eval-results/emotional-axis/latest/` (`results.json`, `summary.md`, `failures.md`; plus `comparison.md` for `--compare`).

```bash
npm run eval:emotional-axis                                   # all 43, default variant
npm run eval:emotional-axis -- --scenario AX01                # single scenario (inspect one snapshot)
npm run eval:emotional-axis -- --variant axis_bands_only      # all scenarios under one variant
npm run eval:emotional-axis -- --compare                      # run all 5 variants → comparison.md A/B tables
npm run eval:emotional-axis -- --trajectory TRAJ-SC           # multi-turn with T→T+1 state carry-over
npm run eval:emotional-axis -- --dry-run                      # preview scenarios/variant, no model calls
EMOTIONAL_AXIS_SMOKE=1 npm run eval:emotional-axis            # deterministic stub reports, no model calls
```

**Trajectory mode** threads turn N's `emotionalAxis` snapshot into turn N+1's seed (`buildCarryOverSeed`), so accumulation assertions (e.g. `axis_after_between connection 0.15,0.6` by T5) test cumulative drift across a conversation.

> **To inspect *where* the snapshot is, use the CLI single-scenario run — not LangSmith.** The CLI prints `emotionalAxis` inline and exercises the exact same `seedEvalSession` + post-turn engine + capture path. `runLangSmithExperiment.ts` has no per-scenario filter.

### LangSmith — push + experiment

```bash
# 1) push the emotional-axis scenarios to a DEDICATED dataset
npm run eval:emotional-axis:push
#    → writes to LANGSMITH_EMOTIONAL_AXIS_EVAL_DATASET, default `emotional-axis-${LANGSMITH_EVAL_DATASET}`

# 2) run the experiment AGAINST THAT DATASET (PowerShell)
$env:LANGSMITH_EVAL_DATASET = "emotional-axis-<your-base>"; npm run eval:emotional-axis:langsmith
```

> ⚠️ **Dataset-name gotcha.** The push auto-derives a dedicated dataset name (`emotional-axis-…`) so it won't clobber your regression set. But `runLangSmithExperiment.ts` evaluates `LANGSMITH_EVAL_DATASET` **verbatim** and does not auto-switch for the emotional-axis set. If you run `eval:emotional-axis:langsmith` without pointing `LANGSMITH_EVAL_DATASET` at the emotional-axis dataset, it evaluates the wrong dataset and you see no axis snapshots. Override `LANGSMITH_EVAL_DATASET` for the run. Do **not** instead set `LANGSMITH_EMOTIONAL_AXIS_EVAL_DATASET` to your base dataset — the push clears its target dataset first.

#### LangSmith runtime behavior

When `EVAL_SCENARIO_SET=emotional_axis`, `runLangSmithExperiment.ts` applies the selected `EMOTIONAL_AXIS_VARIANT` to `agent_turn` **runtime** behavior through `withEmotionalAxisEvalConfig(...)`, not just trace metadata/tags. Before any LangSmith evaluation starts, `preflightEmotionalAxisLangSmithRun()` validates the env gates and throws immediately if a required gate is disabled (see variant gate matrix above).

Within each `agent_turn` row, `evalTarget()` wraps `runAgentEval()` with the variant's injected config so the engine gate (`postTurnMemoryGraph`, `buildPromptContext`) sees the correct `engineEnabled`/`renderEnabled`/`noCoupling`/`bandsOnly` flags. Ordinary (`non-emotional_axis`) LangSmith runs are not affected.

#### Metadata and tags

Emotional-axis variant metadata and tags are attached to each trace when the variant is non-default:

| Source | Non-default example | Default variant |
|--------|-------------------|-----------------|
| `metadata.emotionalAxisVariant` | `"axis_state_no_render"` | omitted |
| Tag `variant:emotional_axis:<name>` | `"variant:emotional_axis:axis_state_no_render"` | omitted |

These appear alongside the other variant metadata (`graphVersion`, `rerankVariant`, `retrievalVariant`, `validatorVariant`) and tags (`variant:rerank:*`, etc.) in the LangSmith UI. See [Interpreting Results](#interpreting-results).

The experiment runs every row (`maxConcurrency: 1`; each `agent_turn` row is a live model call). `emotionalAxisAggregateEvaluator` emits per-row feedback keys:

| Feedback key | Meaning |
| --- | --- |
| `emotional_axis_has_update` | Presence marker (scores `1` whenever a snapshot exists) |
| `emotional_axis_coupling_count` | Number of couplings fired this turn |
| `emotional_axis_has_render` | `1` if a render snapshot was captured, else `0` |
| `emotional_axis_render_source` | `1` if `render.source = persisted_axis_state`, else `0` |

Per-assertion `assertion_N_pass` / `all_assertions_pass` come from `assertionsEvaluator`, which forwards `ctx.emotionalAxis` for `agent_turn` rows.

### Live-run isolation

Live runs need a real DB and live models. `PostTurnRunner.wake()` is a **no-op while an eval capture is active**, so the module-level background loop never claims the eval's post-turn job and runs the engine outside the capture (which would drop the update snapshot). The synchronous `runSyncForEval` path is the sole in-context executor. As belt-and-braces, **keep the backend server (port 4000) stopped during live eval runs** — a second worker still adds DB write contention even though the snapshot is now protected.

## Interpreting Results

### In the terminal

- `all_assertions_pass=true` — all assertions for that scenario passed.
- `all_assertions_pass=false` — see the comment for the first failing assertion.

### In LangSmith UI

1. Open project `LANGSMITH_PROJECT`.
2. Find the experiment under **Experiments**.
3. Each row shows:
   - **Input** — scenario fields (`scenario_id`, `session`, `messages`, etc.)
   - **Output** — `AgentEvalOutput` for agent turns, or validator/retrieval payloads
   - **Feedback** — assertion scores
4. Click a run for:
   - **Trace** — full span tree (`llm.memory_rerank`, generation, validation, post-turn)
   - **Metadata** — `scenarioId`, `evalSessionId`, `evalMode`, git SHA, environment, and variant fields (`graphVersion`, `rerankVariant`, `retrievalVariant`, `validatorVariant`)
   - **Tags** — `eval:true`, `environment:*`, `character:*`, `subsystem:*`, `variant:*` (when non-default variants are active)

### Key fields in AgentEvalOutput

```json
{
  "scenarioId": "memory_recall_coffee",
  "mode": "agent_turn",
  "success": true,
  "reply": "You love black coffee! Dark roasts, no sugar…",
  "latencyMs": 2340,
  "retrieval": {
    "retrieved": { "interactive_memory": ["mem_1"], "canon": [] },
    "injected": { "interactive_memory": ["mem_1"], "canon": [] },
    "dropped": { "duplicate": 0, "lowScore": 0, "correctionConflict": 0, "sourceBudget": 0, "other": 0 },
      "rerank": {
        "enabled": true,
        "selected": [
          { "source": "interactive_memory", "id": "mem_1", "relevance": "required", "usageInstruction": "must_use" }
        ],
        "rejectedCount": 12,
        "finalContextMode": "selected_memory",
        "needsEvidenceFallback": false,
        "fallbackUsed": false,
        "rerankVariant": "llm_rerank_v1"
      }
  },
  "validation": {
    "attempts": [{ "attempt": 1, "needsRewrite": false, "issues": [] }],
    "finalNeedsRewrite": false,
    "wasRewritten": false,
    "wasDeflected": false
  },
  "memoryWrite": {
    "status": "completed",
    "durableMemory": { "written": 0, "deduplicated": 1, "belowThreshold": 0 },
    "sessionChunks": { "written": 1, "skippedExisting": 0 },
    "structMem": { "status": "written", "entryIds": ["entry_1"] }
  },
  "usage": {
    "totalInputTokens": 1234,
    "totalOutputTokens": 89,
    "estimatedCostUsd": 0.0032,
    "llmSpans": [
      { "spanName": "llm.response_generation", "inputTokens": 1000, "outputTokens": 80, "estimatedCostUsd": 0.003 }
    ]
  },
  "cleanup": { "attempted": true, "completed": true }
}
```

When `retrieval.rerank.fallbackUsed` is `true`, the deterministic selector ran instead of the rerank LLM (timeout, parse failure, or empty selection guard).

### Diagnosing failures

| Symptom | Likely cause | Check |
| --- | --- | --- |
| `success: false` with error | Turn threw | `error` field; DB connectivity, API keys |
| Expected memory not in `injected` | Not retrieved, rerank rejected, or dropped | `retrieval.rerank.selected`, `dropped` counts |
| `rerank.fallbackUsed: true` | Rerank LLM failed or timed out | `MEMORY_RERANK_TIMEOUT_MS`; LangSmith `llm.memory_rerank` span |
| `wasDeflected: true` | Validator deflected | `validation.deflectionReason`; seed context |
| `finalNeedsRewrite: true` | Validation failed twice | `validation.attempts[].issues` |
| `memoryWrite.status: "not_run"` | Non-roleplay route or no post-turn job | Turn route; `writeback_policy` |
| `memoryWrite.status: "failed"` | Post-turn job failed | `memoryWrite.error`; post-turn trace spans |
| `cleanup.completed: false` | Incomplete cleanup | SQL for `eval_%` rows |
| `mode: "skipped"` | Missing `input_draft` on non-agent row | Add draft or set `eval_mode` |
| `estimatedCostUsd: null` | Unknown model pricing | `llmSpans[].pricingKnown` |
| `rerank.rerankVariant=deterministic_only` | Intentional variant (not a failure) | Check `rerank.fallbackReason=variant_deterministic_only` |
| `rerank.rerankVariant=hybrid_score` | Non-LLM hybrid selector in use | Check `rerank.fallbackUsed=false` if successful |
| Guardrail error at startup | Misconfigured variant env vars | Check `CANON_QUERY_HYDE`, `STRUCTMEM_MOTIF_PROBE_ENABLED`, `VALIDATOR_STRICT_ATTRIBUTION`, `EMOTIONAL_ENGINE_ENABLED`, or `EMOTIONAL_RENDER_ENABLED` |

## Running Subset-Specific Eval

### Filter local scenarios

```bash
npx tsx src/eval/runEval.ts --scenario tier3_scene_query
npx tsx src/eval/runRetrievalEvalCli.ts --scenario tier3_scene_query
```

### Run with different config

```bash
CANON_RETRIEVAL_PIPELINE=tier1 npm run eval:langsmith
STRUCTMEM_ENABLED=false npm run eval:langsmith
VALIDATOR_STRICT_ATTRIBUTION=1 npm run eval:langsmith
MEMORY_RERANK_MAX_SELECTED=4 npm run eval:langsmith
```

### Run with variant config

```bash
RERANK_VARIANT=hybrid_score npm run eval:langsmith
RERANK_VARIANT=deterministic_only npm run eval:langsmith
RETRIEVAL_VARIANT=hyde_enabled CANON_QUERY_HYDE=1 npm run eval:langsmith
VALIDATOR_VARIANT=strict_attribution VALIDATOR_STRICT_ATTRIBUTION=1 npm run eval:langsmith
```

### Select graph version

```bash
# Select specific experiment graph version (default: turnGraph.v1; alias: v1)
LANGSMITH_EXPERIMENT_GRAPH_VERSION=v1 npm run eval:langsmith
```

Scenario `configOverrides` take precedence when wired through agent-turn input normalization.

## Unit Tests and Variant Safety

Unit tests do not send LangSmith traces or consume LangSmith quota. The test setup in `src/test/setup.ts` forces all LangSmith env vars to `"false"` and mocks the `traceable` module. Variant env vars set in tests are scoped per-test and cleaned up after each test.

Key variant test files:

| Test file | Covers |
|-----------|--------|
| `src/eval/experimentVariants.unit.ts` | Variant parsing, alias normalization, metadata/tags, guardrails (incl. emotional-axis env gates) |
| `src/eval/agentEvalCliHelpers.unit.ts` | CLI argument validation, scenario-set filtering |
| `src/eval/loadEvalScenarios.unit.ts` | Scenario loading by set, rerank scenario eval_mode |
| `src/orchestration/graphs/roleplayPreGenerationGraph.unit.ts` | Variant routing, hybrid score node, deterministic-only path |
| `src/orchestration/context/hybridScoreRerank.unit.ts` | Hybrid score selection algorithm |
| `src/eval/emotionalAxisEvalConfig.unit.ts` | Scoped config helper (`withEmotionalAxisEvalConfig`) |
| `src/eval/preflightLangSmith.unit.ts` | LangSmith emotional-axis preflight gate validation (non-axis, baseline, engine/render gate failures) |
| `src/orchestration/graphs/postTurnMemoryGraph.unit.ts` | Engine state node (incl. `MissingAssistantMessageError` propagation) |

## Debugging

### Check for leftover eval data

```sql
SELECT 'sessions' AS src, count(*) FROM chat_sessions WHERE session_id LIKE 'eval_%'
UNION ALL
SELECT 'messages', count(*) FROM chat_messages WHERE session_id LIKE 'eval_%'
UNION ALL
SELECT 'memories', count(*) FROM interactive_memory_events WHERE session_id LIKE 'eval_%'
UNION ALL
SELECT 'consolidations', count(*) FROM structmem_consolidations WHERE session_id LIKE 'eval_%';
```

### View a specific eval trace in LangSmith

Filter by tag `eval:true` or metadata `scenarioId = no_ai_claim`.

### Re-run a failed agent-turn scenario locally

```ts
import { runAgentEval } from "./src/eval/langsmith/runAgentEval";

const result = await runAgentEval({
  scenario_id: "my_test",
  eval_mode: "agent_turn",
  session: {
    mode: "canonical_live",
    continuity_scope: "main_relationship",
    continuity_family: "main_world",
    writeback_policy: "no_writeback",
  },
  durableMemories: [{ summary: "Player loves coffee", importanceScore: 0.9 }],
  messages: [
    { role: "user", content: "Hi", turn_index: 1 },
    { role: "user", content: "What's my favorite drink?", turn_index: 2 },
  ],
});

console.log(JSON.stringify(result, null, 2));
```

## Related Files

| File | Purpose |
| --- | --- |
| `src/eval/evalSnapshots.ts` | Snapshot capture system |
| `src/eval/evalAssertions.ts` | Deterministic assertion checks (incl. rerank) |
| `src/eval/evalTypes.ts` | Scenario and assertion types |
| `src/eval/loadEvalScenarios.ts` | Load `scenarios.json`, `scenarioToEvalInputs()` |
| `src/eval/scenarios.json` | Primary regression scenarios (v2.1) |
| `src/eval/datasets/rerankScenarios.ts` | Rerank scenario library (not in default push) |
| `src/eval/datasets/probeScenarios.ts` | Probe scenario library (12 manual-scored probes; not in default push) |
| `src/eval/evaluators/rerankEvaluators.ts` | LangSmith rerank metric evaluators |
| `src/eval/langsmith/evalTypes.ts` | Agent eval seed types |
| `src/eval/langsmith/seedEvalSession.ts` | Isolated session seeding |
| `src/eval/langsmith/cleanupEvalSession.ts` | Session cleanup |
| `src/eval/langsmith/runAgentEval.ts` | Full-turn eval runner |
| `src/eval/runLangSmithExperiment.ts` | LangSmith experiment entry point (incl. `emotionalAxisAggregateEvaluator`) |
| `src/eval/pushLangSmithDataset.ts` | Dataset upload (derives dedicated `emotional-axis-*` dataset for `emotional_axis` set) |
| `src/eval/runEmotionalAxisCli.ts` | Emotional-axis local CLI (single / variant / compare / trajectory / smoke) |
| `src/eval/datasets/emotionalAxisScenarios.ts` | Emotional-axis scenario library (43 rows; set `emotional_axis`) |
| `src/eval/emotionalAxisEvalConfig.ts` | Injected variant config (engine / render / coupling / bands toggles; design D7) + scoped `withEmotionalAxisEvalConfig()` helper |
| `src/eval/runEval.ts` | Local validator/retrieval CLI |
| `src/eval/runRetrievalEvalCli.ts` | Retrieval-only CLI |
| `src/eval/retrievalEvalRunner.ts` | Tier-3 retrieval eval helper |
| `src/orchestration/context/resolveContext.ts` | Records retrieval + rerank snapshots |
| `src/orchestration/retrieval/memoryRerank.ts` | Memory rerank LLM stage |
| `src/observability/langsmithTracing.ts` | Tracing + usage capture |
| `src/eval/evalProcessDrain.ts` | LangSmith client flush helper (submits pending traces before exit) |
| `src/eval/experimentVariants.ts` | Variant metadata helper, guardrails, run matrix |
| `src/eval/preflightLangSmith.ts` | Emotional-axis LangSmith preflight gate validation (fail-fast before `evaluate(...)`) |
| `src/eval/runAgentEvalCli.ts` | Full-turn agent eval CLI |
| `src/eval/agentEvalCliHelpers.ts` | CLI argument/validation helpers |
| `src/eval/datasets/rerankScenarios.ts` | Rerank scenario library |
| `src/eval/datasets/probeScenarios.ts` | Probe scenario library (12 manual-scored probes) |
| `src/eval/evaluators/rerankEvaluators.ts` | LangSmith rerank metric evaluators |
| `src/orchestration/context/hybridScoreRerank.ts` | Hybrid score (non-LLM) rerank selector |
| `documents/langgraph_langsmith_integration_plan.md` | Full integration plan (Phase 7 = variants) |
| `documents/langsmith_eval_system_implementation_plan.md` | Full implementation plan (Milestones 1–9) |
