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
- **Rerank evaluators** (`src/eval/evaluators/rerankEvaluators.ts`) — precision/recall/rejection/context-mode LangSmith evaluators (standalone helpers; not yet registered in `runLangSmithExperiment.ts`).
- **Rerank scenario library** (`src/eval/datasets/rerankScenarios.ts`) — labeled scenarios for memory-rerank behavior (separate from `scenarios.json`; not pushed by default).

### What's not yet implemented

- CI integration, online feedback, and multi-dataset milestone automation.
- Variant guardrails for context planner (`no_rewrite`) and validator (`lightweight`) — these are recognized but fail fast with a clear error until implemented.

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
| `all` | Both `scenarios.json` and rerank scenarios |

Examples:

```bash
# Push only rerank scenarios
EVAL_SCENARIO_SET=rerank npm run eval:dataset:push

# Push default + rerank scenarios
EVAL_SCENARIO_SET=all npm run eval:dataset:push
```

Custom dataset name:

```bash
LANGSMITH_EVAL_DATASET=zuoran-memory-retrieval-v1 npm run eval:dataset:push
```

Assertions are stored on example **metadata** (`metadata.assertions`), not in inputs.

Rerank-labeled examples also carry `expected_selected_ids`, `expected_rejected_ids`, and `expected_final_context_mode` in metadata when present on the scenario.

## Running LangSmith Experiments

```bash
npm run eval:langsmith
```

`src/eval/runLangSmithExperiment.ts`:

1. Reads the dataset named by `LANGSMITH_EVAL_DATASET`.
2. Dispatches each example:
   - `eval_mode: "agent_turn"` → `runAgentEval()` (full isolated turn)
   - `eval_mode: "retrieval"` → `runRetrievalEvalForScenario()`
   - `input_draft` present → validator-only
   - otherwise → `mode: "skipped"`
3. Runs evaluators:
   - `assertionsEvaluator` — deterministic assertion checks (incl. rerank for `agent_turn` rows)
   - `retrievalQualityEvaluator` — anchor counts and needle hits (retrieval mode only)
   - `rerankSelectionPrecision`, `rerankSelectionRecall`, `rerankRejectionAccuracy`, `rerankContextModeAccuracy`, `rerankCompositeScore` — rerank metrics
4. Exits with code 1 if any row fails `all_assertions_pass`.

**Terminal output example:**

```
no_ai_claim  all_assertions_pass=false  ...
tier3_scene_query  all_assertions_pass=true  All assertions passed.
Experiment: zuoran-phase1-abc123
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
```

#### Variant guardrails

The `validateExperimentVariants()` function in `src/eval/experimentVariants.ts` checks that selected variants are compatible with the current environment:

- `RETRIEVAL_VARIANT=hyde_enabled` requires `CANON_QUERY_HYDE=1`
- `RETRIEVAL_VARIANT=motif_probe_enabled` requires `STRUCTMEM_MOTIF_PROBE_ENABLED=1`
- `VALIDATOR_VARIANT=strict_attribution` requires `VALIDATOR_STRICT_ATTRIBUTION=1`
- `CONTEXT_PLANNER_VARIANT=no_rewrite` — not yet implemented, fails fast
- `VALIDATOR_VARIANT=lightweight` — not yet implemented, fails fast

Validation runs at experiment startup; misconfigured variants produce clear error messages before any model calls or traces.

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
```

The CLI:
- Requires `--scenario <id>`
- Rejects scenarios without `eval_mode: "agent_turn"`
- Loads scenarios from the selected scenario set (`default`, `rerank`, `all`)
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
| Guardrail error at startup | Misconfigured variant env vars | Check `CANON_QUERY_HYDE`, `STRUCTMEM_MOTIF_PROBE_ENABLED`, or `VALIDATOR_STRICT_ATTRIBUTION` |

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

Scenario `configOverrides` take precedence when wired through agent-turn input normalization.

## Unit Tests and Variant Safety

Unit tests do not send LangSmith traces or consume LangSmith quota. The test setup in `src/test/setup.ts` forces all LangSmith env vars to `"false"` and mocks the `traceable` module. Variant env vars set in tests are scoped per-test and cleaned up after each test.

Key variant test files:

| Test file | Covers |
|-----------|--------|
| `src/eval/experimentVariants.unit.ts` | Variant parsing, alias normalization, metadata/tags, guardrails |
| `src/eval/agentEvalCliHelpers.unit.ts` | CLI argument validation, scenario-set filtering |
| `src/eval/loadEvalScenarios.unit.ts` | Scenario loading by set, rerank scenario eval_mode |
| `src/orchestration/graphs/roleplayPreGenerationGraph.unit.ts` | Variant routing, hybrid score node, deterministic-only path |
| `src/orchestration/context/hybridScoreRerank.unit.ts` | Hybrid score selection algorithm |

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
| `src/eval/evaluators/rerankEvaluators.ts` | LangSmith rerank metric evaluators |
| `src/eval/langsmith/evalTypes.ts` | Agent eval seed types |
| `src/eval/langsmith/seedEvalSession.ts` | Isolated session seeding |
| `src/eval/langsmith/cleanupEvalSession.ts` | Session cleanup |
| `src/eval/langsmith/runAgentEval.ts` | Full-turn eval runner |
| `src/eval/runLangSmithExperiment.ts` | LangSmith experiment entry point |
| `src/eval/pushLangSmithDataset.ts` | Dataset upload |
| `src/eval/runEval.ts` | Local validator/retrieval CLI |
| `src/eval/runRetrievalEvalCli.ts` | Retrieval-only CLI |
| `src/eval/retrievalEvalRunner.ts` | Tier-3 retrieval eval helper |
| `src/orchestration/context/resolveContext.ts` | Records retrieval + rerank snapshots |
| `src/orchestration/retrieval/memoryRerank.ts` | Memory rerank LLM stage |
| `src/observability/langsmithTracing.ts` | Tracing + usage capture |
| `src/eval/experimentVariants.ts` | Variant metadata helper, guardrails, run matrix |
| `src/eval/runAgentEvalCli.ts` | Full-turn agent eval CLI |
| `src/eval/agentEvalCliHelpers.ts` | CLI argument/validation helpers |
| `src/eval/datasets/rerankScenarios.ts` | Rerank scenario library |
| `src/eval/evaluators/rerankEvaluators.ts` | LangSmith rerank metric evaluators |
| `src/orchestration/context/hybridScoreRerank.ts` | Hybrid score (non-LLM) rerank selector |
| `documents/langgraph_langsmith_integration_plan.md` | Full integration plan (Phase 7 = variants) |
| `documents/langsmith_eval_system_implementation_plan.md` | Full implementation plan (Milestones 1–9) |
