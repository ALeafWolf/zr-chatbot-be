# LangSmith Eval Guide

How to create, run, and interpret LangSmith-based evaluations for the chatbot backend.

## Overview

The eval system runs isolated, reproducible full-turn agent evaluations and reports structured results to LangSmith. It covers retrieval quality, validation correctness, memory write behavior, token usage, and latency — all without touching real user sessions.

### What's implemented

- **Eval snapshot capture** (`src/eval/evalSnapshots.ts`) — side-channel data collection using Node.js `AsyncLocalStorage`. During an eval run, the orchestration, validation, and memory layers record structured snapshots without changing their normal function signatures.
- **Isolated eval sessions** (`src/eval/langsmith/seedEvalSession.ts`) — creates temporary sessions, messages, memories, StructMem entries, and consolidations with `eval_`-prefixed IDs.
- **Cleanup** (`src/eval/langsmith/cleanupEvalSession.ts`) — deletes all seeded data after the eval completes, even on errors.
- **Full-turn runner** (`src/eval/langsmith/runAgentEval.ts`) — seeds, runs a turn through the normal pipeline, executes the post-turn job synchronously, captures `AgentEvalOutput`, and cleans up.
- **Usage tracking** — LLM token counts and estimated cost are captured per span and aggregated.

### What's not yet implemented

LLM-as-judge evaluators, CI integration, online feedback, and the multi-dataset system (Milestones 5–9 in the implementation plan).

## Prerequisites

1. **LangSmith account** — API key from [smith.langchain.com](https://smith.langchain.com).
2. **PostgreSQL** — running with the schema migrated (`npm run db:migrate`).
3. **LLM provider keys** — at minimum `OPENAI_API_KEY` (for embeddings) plus your generation/validator model provider keys.
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

# Optional: enable LLM judges (not yet wired to agents, only validator)
# EVAL_ENABLE_LLM_JUDGE=0
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
runCharacterTurn()             ← normal pipeline runs inside capture
  │  ├── resolveContext()      → recordRetrievalSnapshot()
  │  ├── generateAndValidate() → recordValidationAttempt/Snapshot()
  │  └── llm calls             → recordLlmUsageSnapshot() (via tracing)
  │
  ▼
postTurnRunner.runJobByIdForEval()  ← synchronous post-turn execution
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

### Snapshot types captured

| Snapshot | What it captures | Recorded by |
|----------|-----------------|-------------|
| `RetrievalEvalSnapshot` | Retrieved vs injected IDs per source, drop reasons, query intent, timings | `resolveContext.ts` |
| `ValidationEvalSnapshot` | Each validation attempt, final pass/rewrite/deflection state | `generateAndValidate.ts` |
| `MemoryWriteEvalSnapshot` | Post-turn job status, extraction counts, write plan, durable/session/structmem write counts, summary compaction | `postTurnRunner.ts`, `writeInteractiveMemory.ts`, `writeSessionMemoryChunk.ts`, `writeStructMemTurn.ts`, `turnPersistence.ts` |
| `UsageEvalSnapshot` | Per-LLM-span input/output tokens, estimated cost, aggregated totals | `langsmithTracing.ts` |

### Isolation guarantees

- **Session IDs** — prefixed with `eval_<scenarioId>_<uuid>`.
- **Player IDs** — prefixed with `eval_<scenarioId>_<uuid>`.
- **Memory namespaces** — use the isolated player ID (so retrieval never crosses into real user data).
- **`source: "eval_seed"`** — all seeded rows carry this metadata marker.
- **Cleanup always runs** — `cleanupEvalSession` is called in a `finally`-equivalent path so eval data is deleted even when the turn throws.

## Running Unit Tests

```bash
npm run test:unit
```

This runs all `*.unit.ts` files. The relevant test files for the eval system:

| Test file | Covers |
|-----------|--------|
| `src/eval/evalSnapshots.unit.ts` | Snapshot capture, retrieval recording, validation recording, LLM usage accumulation (including unknown-cost edge cases), `buildAgentEvalOutput` |
| `src/eval/langsmith/runAgentEval.unit.ts` | `normalizeAgentEvalInput` — parsing legacy snake_case fields, error handling for missing fields |
| `src/orchestration/retrievalDiagnostics.unit.ts` | Diagnostics payload including `droppedBudgetCount` |
| `src/observability/traceMetadata.unit.ts` | Trace metadata construction, player ID hashing |
| `src/observability/traceTags.unit.ts` | Tag generation and sanitization |

Run a single test file:

```bash
npx tsx --test src/eval/evalSnapshots.unit.ts
```

## Creating Eval Scenarios

Scenarios live in `src/eval/scenarios.json`. Each scenario defines the seed data (session, messages, memories) and assertions.

### Scenario with eval_mode: "agent_turn"

This mode runs a full isolated turn through the entire backend pipeline.

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
    {
      "role": "user",
      "content": "Hey, do you remember what I told you about drinks?",
      "turn_index": 1
    },
    {
      "role": "assistant",
      "content": "You mentioned something about coffee, right?",
      "turn_index": 2
    },
    {
      "role": "user",
      "content": "What's my favorite drink?",
      "turn_index": 3
    }
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
      "type": "contains",
      "value": "coffee",
      "description": "Reply must mention coffee"
    },
    {
      "type": "not_contains",
      "value": "tea",
      "description": "Reply should not mention tea as a preference"
    }
  ]
}
```

### Scenario with eval_mode: "retrieval" (retrieval only)

Skips generation — only tests canon retrieval quality.

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
    {
      "role": "user",
      "content": "Tell me about the first time we met at the cafe"
    }
  ],
  "retrieval_expected_needle": "cafe_first_meeting",
  "assertions": [
    {
      "type": "retrieval_min_anchors",
      "min_scenes": 1,
      "description": "At least 1 canon scene should be found"
    }
  ]
}
```

### Scenario with eval_mode: "default" (validator only)

Tests just the validator against a pre-written draft — no retrieval or generation.

```json
{
  "id": "validator_deflection_test",
  "description": "Validator should deflect out-of-scene content",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world"
  },
  "input_draft": "Let's talk about modern politics instead of our story.",
  "validator_retrieved_canon": "Scene: a quiet evening in the cottage...",
  "assertions": [
    {
      "type": "needs_rewrite",
      "expected": true,
      "description": "Off-topic draft should trigger rewrite"
    }
  ]
}
```

### Available assertion types

| Type | Fields | Description |
|------|--------|-------------|
| `contains` | `value` | Reply must contain this substring |
| `not_contains` | `value` | Reply must NOT contain this substring |
| `contains_all` | `values` | Reply must contain ALL of these substrings |
| `contains_any` | `values` | Reply must contain AT LEAST ONE substring |
| `needs_rewrite` | `expected` | Validator must (or must not) flag the draft |
| `deflection` | `expected` | Response must (or must not) be deflected |
| `attribution_supported` | `reply_attribution_patterns`, `canon_support_needles` | Specific factual claims must be backed by canon |
| `no_unsupported_attribution` | `reply_entity_markers` | No unsupported factual claims |
| `retrieval_min_anchors` | `min_scenes` | Minimum scene anchor count (retrieval mode) |

### Seed data reference

All seed fields are optional. Omit what you don't need.

| Field | Type | Description |
|-------|------|-------------|
| `session` | object | **Required.** `mode`, `continuity_scope`, `continuity_family`, optional `writeback_policy` |
| `messages` | array | Conversation history. Last user message is the eval input. Each: `{ role, content, turn_index }` |
| `userMessage` | string | Override: use this as the user message instead of the last message in `messages` |
| `sessionSummary` | string | Pre-seeded session summary text |
| `sessionState` | object | Pre-seeded derived state (`inferredMood`, `inferredActivity`, etc.) |
| `durableMemories` | array | Pre-seeded interactive memory rows. Each: `{ summary, memoryType?, importanceScore?, emotionScore?, tags?, embedding? }` |
| `sessionChunks` | array | Pre-seeded session memory chunks. Each: `{ chunkText, chunkType?, turnStart?, turnEnd?, embedding? }` |
| `structMemEntries` | array | Pre-seeded StructMem entries. Each: `{ text, entryType?, turnIndex?, importanceScore?, confidenceScore?, embedding? }` |
| `structMemConsolidations` | array | Pre-seeded StructMem consolidations. Each: `{ summaryText, scope?, turnStart?, turnEnd?, confidenceScore?, embedding? }` |
| `canonReferenceIds` | string[] | Specific canon scene/reference IDs to expect in retrieval |
| `configOverrides` | object | Override pipeline config for this eval only |

### Writing effective scenarios

- **One thing per scenario** — test retrieval, generation, validation, or memory write separately rather than everything at once. This makes failures easier to diagnose.
- **Seed enough context** — the agent needs enough conversation history and memories to produce a meaningful response. A bare scenario with no seed data will often deflect or produce a generic reply.
- **Use specific assertion values** — avoid asserting on generic phrases like "hello" or "I understand". Assert on specific facts that the seed data should produce.
- **Set `writeback_policy: "no_writeback"`** for eval scenarios unless you're specifically testing memory write behavior. This prevents eval runs from creating post-turn jobs that compete with real ones.
- **Use `eval_: true` tag in trace metadata** — this happens automatically; eval traces are filterable in LangSmith.

## Pushing Datasets to LangSmith

Push your local scenarios to a LangSmith dataset:

```bash
npm run eval:dataset:push
```

This reads `src/eval/scenarios.json`, converts each scenario to a LangSmith example via `scenarioToEvalInputs()`, and uploads them to the dataset named by `LANGSMITH_EVAL_DATASET`.

To use a different dataset name:

```bash
LANGSMITH_EVAL_DATASET=zuoran-memory-retrieval-v1 npm run eval:dataset:push
```

**Note:** Pushing overwrites existing examples with the same `scenario_id`. The dataset name in `.env` controls which dataset the experiment reads from.

## Running LangSmith Experiments

```bash
npm run eval:langsmith
```

This runs `src/eval/runLangSmithExperiment.ts`, which:

1. Reads the dataset specified by `LANGSMITH_EVAL_DATASET`.
2. For each example, dispatches to the correct mode:
   - `eval_mode: "agent_turn"` → `runAgentEval()` (full isolated turn)
   - `eval_mode: "retrieval"` → `runRetrievalEvalForScenario()` (canon retrieval only)
   - otherwise → validator-only mode
3. Runs evaluators: `assertionsEvaluator` (deterministic) and `retrievalQualityEvaluator` (for retrieval mode).
4. Reports pass/fail per example to stdout and LangSmith.

**What you'll see in the terminal:**

```
memory_recall_coffee  all_assertions_pass=true  All assertions passed.
canon_retrieval_test  all_assertions_pass=false  reply missing expected: coffee
Experiment: zuoran-chatbot-phase1-abc123
 Rows processed: 15, failed: 2
```

## Interpreting Results

### In the terminal

- `all_assertions_pass=true` — all assertions for that scenario passed.
- `all_assertions_pass=false` with a comment — which assertion failed and why.

### In LangSmith UI

1. Go to your project (`LANGSMITH_PROJECT`).
2. Find the experiment under the **Experiments** tab.
3. Each row shows:
   - **Input** — the scenario data fed to the eval.
   - **Output** — `AgentEvalOutput` includes `reply`, `retrieval`, `validation`, `memoryWrite`, `usage`, `latencyMs`, `cleanup`.
   - **Feedback** — assertion scores.
4. Click into a run to see:
   - **Trace** — the full LangSmith trace with all spans (retrieval, generation, validation, post-turn).
   - **Metadata** — `scenarioId`, `evalSessionId`, `evalMode`, `configOverrides`, git SHA, environment.
   - **Tags** — `eval:true`, `environment:development`, `character:zuo_ran`, `subsystem:*`.

### Key metrics in AgentEvalOutput

```json
{
  "scenarioId": "memory_recall_coffee",
  "success": true,
  "reply": "You love black coffee! Dark roasts, no sugar, no milk...",
  "latencyMs": 2340,
  "retrieval": {
    "retrieved": { "interactive_memory": ["mem_1"], "canon": ["scene_42"] },
    "injected": { "interactive_memory": ["mem_1"], "canon": ["scene_42"] },
    "dropped": { "duplicate": 0, "lowScore": 1, "correctionConflict": 0, "sourceBudget": 0, "other": 0 }
  },
  "validation": {
    "attempts": [{ "attempt": 1, "needsRewrite": false, "inCharacter": true, "issues": [] }],
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
    "totalTokens": 1323,
    "estimatedCostUsd": 0.0032,
    "llmSpans": [
      { "spanName": "llm.response_generation", "inputTokens": 1000, "outputTokens": 80, "estimatedCostUsd": 0.003 }
    ]
  },
  "cleanup": { "attempted": true, "completed": true }
}
```

### Diagnosing failures

| Symptom | Likely cause | Check |
|---------|-------------|-------|
| `success: false` with error | Turn threw an exception | `error` field; check DB connectivity, model API keys |
| Expected memory not in `injected` | Memory wasn't retrieved or was dropped | `dropped` counts (lowScore? duplicate? sourceBudget?) |
| `wasDeflected: true` | Validator deflected the response | `deflectionReason`; check session mode, seed context |
| `finalNeedsRewrite: true` | Response failed validation twice | `attempts[].issues` for what went wrong |
| `memoryWrite.status: "failed"` | Post-turn job failed | `memoryWrite.error`; check in LangSmith trace for job spans |
| `cleanup.completed: false` | Seeded data wasn't fully deleted | Run manually: check for `eval_%` rows in DB |
| `estimatedCostUsd: null` | Unknown model pricing | `llmSpans[].pricingKnown: false` |

## Running Subset-Specific Eval

### Run only agent_turn scenarios

Filter scenarios before pushing, or temporarily edit `LANGSMITH_EVAL_DATASET` to use a dataset with only agent-turn examples.

### Run a single scenario

Use the existing eval scripts directly with `tsx`:

```bash
# Run retrieval eval for a single scenario
npx tsx src/eval/runRetrievalEvalCli.ts --scenario memory_recall_coffee

# Run the full LangSmith experiment (reads all from dataset)
npm run eval:langsmith
```

### Run eval with different config

```bash
CANON_RETRIEVAL_PIPELINE=tier1 npm run eval:langsmith
STRUCTMEM_ENABLED=false npm run eval:langsmith
```

Config overrides in the scenario's `configOverrides` field take precedence over env vars.

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

### Run with verbose logging

The eval runner prints per-scenario results to stdout. For deeper debugging, add `console.log` statements or set `NODE_ENV=development` to see more trace output.

### View a specific eval trace in LangSmith

Traces from eval runs have tag `eval:true` and metadata `scenarioId`. Filter in the LangSmith UI by:
- Tags: `eval`
- Metadata: `scenarioId = memory_recall_coffee`

### Re-run a failed scenario locally

Copy the inputs from the LangSmith example, create a minimal reproduction script:

```ts
import { runAgentEval } from "./src/eval/langsmith/runAgentEval";

const result = await runAgentEval({
  scenario_id: "my_test",
  userMessage: "What's my favorite drink?",
  session: { mode: "canonical_live", continuity_scope: "main", continuity_family: "main_world" },
  durableMemories: [{ summary: "Player loves coffee", importanceScore: 0.9 }],
  messages: [{ role: "user", content: "Hi", turn_index: 1 }],
});

console.log(JSON.stringify(result, null, 2));
```

## Related Files

| File | Purpose |
|------|---------|
| `src/eval/evalSnapshots.ts` | Snapshot capture system |
| `src/eval/langsmith/evalTypes.ts` | Eval type definitions |
| `src/eval/langsmith/seedEvalSession.ts` | Isolated session seeding |
| `src/eval/langsmith/cleanupEvalSession.ts` | Session cleanup |
| `src/eval/langsmith/runAgentEval.ts` | Full-turn eval runner |
| `src/eval/runLangSmithExperiment.ts` | LangSmith experiment entry point |
| `src/eval/scenarios.json` | Eval scenario definitions |
| `src/eval/evalTypes.ts` | Scenario/assertion types |
| `src/eval/evalAssertions.ts` | Deterministic assertion checks |
| `src/observability/langsmithTracing.ts` | Tracing + usage capture integration |
| `src/observability/traceMetadata.ts` | Trace metadata construction |
| `src/observability/traceTags.ts` | Standardized tag generation |
| `documents/langsmith_eval_system_implementation_plan.md` | Full implementation plan (Milestones 1–9) |
