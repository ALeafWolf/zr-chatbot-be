# Chatbot Backend Turn Workflow Analysis

This document describes the current `chatbot/backend` turn flow: how a user
message enters the API, how retrieval and generation are orchestrated, how the
validated reply is persisted, and how post-turn memory jobs continue in the
background.

It is based on the current implementation under `chatbot/backend/src`.

## Short Version

The main API path is:

1. Fastify registers chat routes from `http/routes/chatRoutes.ts`.
2. `features/chat/chatHandlers.ts` validates `{ content: string }` and the
   `:id` session parameter.
3. Non-streaming calls `runCharacterTurn(...)`; streaming calls
   `runCharacterTurnStreamTraced(...)`.
4. `runCharacterTurnStream(...)` loads `chat_sessions`, rejects missing or
   deleted sessions, and classifies the user message into a turn route:
   `roleplay_turn`, `app_command`, or `unsupported`. Credential disclosure
   requests are intercepted and routed to `unsupported`.
5. For `roleplay_turn`: loads character defaults and the persona overlay.
6. `resolveContext(...)` rewrites the user query, builds memory/canon query
   texts, creates batched embeddings (traced as `embedding.query_batch`),
   retrieves memory/canon/recent state, retrieves active memory corrections,
   retrieves older session recall, selects prompt memory context, and emits
   retrieval diagnostics.
7. `buildPromptContext(...)` turns selected results into priority-ordered prompt
   blocks plus recent conversation history, traced as `prompt.build_context`
   with block-level token estimates.
8. A recall thought may be generated in parallel with draft generation when
   retrieved memories or canon excerpts exist, traced as `llm.recall_thought`.
9. `generateAndValidateStream(...)` drafts with tools enabled, validates the
   draft, optionally rewrites once, validates again, and may fall back to the
   character safe deflection.
10. `persistCompletedTurn(...)` runs a DB transaction that inserts the user and
    assistant messages, updates `session_state`, updates `chat_sessions`, and
    inserts one `post_turn_jobs` row — now including `route` and trace metadata
    with token usage and cost.
11. `postTurnRunner.wake()` is called, then SSE receives replayed final deltas
    and a `done` event. Non-streaming receives the final JSON response.
    Both now include `route` in the output.
12. `postTurnRunner` claims the durable job from `post_turn_jobs`, builds a
    post-turn write plan from session/env/signals (traced as
    `post_turn.write_plan`), and performs retryable memory steps.
13. If enabled, StructMem consolidation may enqueue a separate
    `structmem_consolidation_jobs` job handled by `structmemConsolidationRunner`.

Important timing point: the assistant reply and `post_turn_jobs` row are
persisted in the same transaction before the client receives the final
assistant prose. The memory extraction and compaction work happens afterward in
background runners and is not awaited by the HTTP/SSE response.

## Entry Points

Routes are registered by `createApp()` in `http/app.ts`, then the backend starts
both HTTP and background runners from `server.ts`.

| Route | Handler | Behavior |
| --- | --- | --- |
| `POST /api/sessions/:id/messages` | `sendMessageHandler` | Drains `runCharacterTurn(...)` and returns final JSON. |
| `POST /api/sessions/:id/messages/stream` | `streamMessageHandler` | Sends SSE events from `runCharacterTurnStreamTraced(...)`. |

Request validation:

- URL params: `{ id: string }`
- Body: `{ content: string }`, length `1..4000`

Streaming behavior:

- hijacks the raw response and writes `text/event-stream`
- emits heartbeat comments every 15 seconds
- aborts orchestration when the connection closes before completion
- forwards `thought`, `tool_call`, `tool_result`, `delta`, `done`, and `error`
  events
- `done` includes `route` (`roleplay_turn` | `app_command` | `unsupported`)
- `TurnOutput` (non-streaming) also includes `route`

## LangSmith Tracing Setup

Tracing is configured across three coordinated files:

- `observability/traceMetadata.ts` — standardized metadata, usage, and cost.
- `observability/traceTags.ts` — standardized tag generation.
- `observability/langsmithTracing.ts` — wrapper helpers and context management.

Environment knobs:

- `LANGSMITH_TRACING`: enables or disables SDK tracing; default is `false`
- `LANGSMITH_API_KEY`: API key used by the LangSmith SDK when tracing is on
- `LANGSMITH_PROJECT`: project name; default is `zuoran-chatbot-phase1`
- `LANGSMITH_ENDPOINT`: LangSmith API endpoint; default is
  `https://api.smith.langchain.com`
- `LANGSMITH_EVAL_DATASET`: dataset name used by evaluation tooling; default is
  `zuoran-phase1-eval`
- `TRACE_ENVIRONMENT`: environment label in tags/metadata; default is
  `development`
- `APP_VERSION`: app version in metadata; default is `dev`
- `GIT_SHA`: git SHA in metadata; default is `unknown`
- `TRACE_PLAYER_HASH_SALT`: salt for SHA-256 hashing player IDs before sending
  to LangSmith

### Trace Metadata (`traceMetadata.ts`)

Every top-level turn span receives `TraceBaseMetadata` with:

- `traceSchemaVersion`, `environment`, `appVersion`, `gitSha`
- `sessionId`, `characterId`, hashed `playerIdHash` (never raw)
- `mode`, `continuityScope`, `continuityFamily`, `memoryNamespace`
- `turnIndex`
- Full pipeline config: `canonRetrievalPipeline`, `canonQueryHyde`,
  `structMemEnabled`, `structMemNativeExtractor`,
  `structMemConsolidationEnabled`, etc.
- Model bindings: `modelGeneration`, `modelValidator`, `modelExtractor`,
  `modelAttributionJudge`, `modelEmbedding`, `modelConsolidation`

LLM spans attach `TraceLlmMetadata` via a Symbol property
(`TRACE_LLM_METADATA_SYMBOL`) on output objects. This carries:

- `modelProvider`, `modelName`, `ls_provider`, `ls_model_name`
- `inputTokens`, `outputTokens`, `totalTokens`
- `estimatedCostUsd` (from a built-in pricing table)
- `pricingKnown` / `pricingVersion`
- `usage_metadata` (LangSmith-standard `input_tokens`/`output_tokens`/
  `total_tokens`)

Pricing is computed by `estimateModelCost()` using a hardcoded table in
`MODEL_PRICES_USD_PER_MILLION`. Unknown models produce `null` cost. The tracing
wrapper extracts this metadata via `findAttachedTraceLlmMetadata()` and merges
it into span outputs.

Key exports:

- `buildTraceBaseMetadata(input)` — builds the full base metadata object
- `buildLlmTraceMetadata({ binding, modelRole, usage })` — builds LLM metadata
- `buildUsageMetadata(binding, usage)` — token → usage + cost
- `attachTraceLlmMetadata(value, ...)` — attaches metadata to an output object
- `findAttachedTraceLlmMetadata(value)` — extracts metadata from an output or
  nested `output`/`outputs`/`result`/`data` property
- `hashPlayerId(playerId)` — SHA-256 with salt

### Trace Tags (`traceTags.ts`)

Every span receives standardized tags:

| Tag format | Source | Example |
| --- | --- | --- |
| `env:<environment>` | `TRACE_ENVIRONMENT` | `env:development` |
| `character:<id>` | Session | `character:zuo_ran` |
| `turn:foreground` | Foreground spans | `turn:foreground` |
| `turn:background` | Post-turn / consolidation spans | `turn:background` |
| `subsystem:<name>` | Inferred from span name or explicit | `subsystem:retrieval` |
| `eval:true` | Only when `eval` context is active | `eval:true` |

Subsystems: `retrieval`, `llm`, `post_turn`, `structmem`, `orchestration`,
`memory`. Tags are sanitized and deduplicated by `sanitizeTraceTags()`; only
approved tag patterns are allowed.

### Wrappers (`langsmithTracing.ts`)

All wrappers now accept `TraceWrapperOptions`:

```ts
interface TraceWrapperOptions {
  tags?: string[];
  metadata?: Record<string, unknown>;
  subsystem?: TraceSubsystem;
  turn?: TraceTurn;
  root?: boolean;
  includeEnvironmentTag?: boolean;
  eval?: boolean;
  llm?: { binding: ModelBinding; modelRole?: TraceModelRole };
  getUsage?: (outputs: unknown) => TraceUsageInput | undefined;
  processInputs?: TraceProcessInputs;
  processOutputs?: TraceProcessOutputs;
}
```

Wrapper helpers:

- `traceStage(...)`: wraps normal async pipeline functions as `run_type:
  "chain"`
- `traceStageWithIO(...)`: chain span with `processInputs` and
  `processOutputs` hooks for compact diagnostic payloads
- `traceLLMStage(...)`: wraps non-streaming LLM calls as `run_type: "llm"`,
  automatically extracting and attaching token usage + cost to output metadata
- `traceStreamingLLM(...)`: wraps async-generator LLM streams as `run_type:
  "llm"`; uses an aggregator to extract the final `done` chunk
- `wrapOpenAI`: exported for provider-level OpenAI instrumentation

### Trace Context

`withTraceContext(context, fn)` establishes an `AsyncLocalStorage`-based context
that child spans automatically merge. The context carries `baseMetadata`,
`characterId`, `turn`, `eval`, and `tags`. Context is merged hierarchically:
child metadata overrides parent, tags are concatenated and deduplicated.

Top-level entry points (`runCharacterTurnStreamTraced`, `runCharacterTurn`)
call `withTraceContext` with `buildTraceBaseMetadata({ session })` so all child
spans inherit the base metadata.

Tracing is automatically disabled during unit tests (`isTestProcess()` checks
`NODE_ENV`, `npm_lifecycle_event`, and `--test` CLI args).

When `LANGSMITH_TRACING=false`, wrappers still wrap functions but the SDK
auto-disables remote tracing. The code path and return values are unchanged.

## Trace Span Map

| Trace span | Source | LLM? | Main DB behavior |
| --- | --- | --- | --- |
| `orchestration.run_character_turn` | `orchestration/runCharacterTurn.ts` | Indirect | Non-streaming wrapper around the stream generator. Root span — carries `TraceBaseMetadata`. |
| `orchestration.run_character_turn_stream` | `orchestration/runCharacterTurn.ts` | Indirect | Reads session, classifies route, dispatches to roleplay/app/unsupported, persists the completed turn. |
| `orchestration.load_session` | `orchestration/runCharacterTurn.ts` | No | Reads `chat_sessions`. |
| `llm.classify_turn_route` | `orchestration/classifyTurnRoute.ts` | Yes | No DB. Extractor model classifies the user message into `roleplay_turn`, `app_command`, or `unsupported`. Credential disclosure requests are force-routed to `unsupported`. Fail-open on parse errors or exceptions. |
| `orchestration.route_switch` | `orchestration/runCharacterTurn.ts` | No | No DB. Records classified route, confidence, persisted route, and fallback reason. |
| `orchestration.roleplay_turn` | `orchestration/runCharacterTurn.ts` | No | No DB. Marker span for roleplay turn execution. |
| `orchestration.app_command` | `orchestration/runCharacterTurn.ts` | No | No DB. Marker span for app command execution (safe deflection reply, not yet implemented). |
| `orchestration.unsupported_turn` | `orchestration/runCharacterTurn.ts` | No | No DB. Marker span for unsupported / safe-deflection execution. |
| `retrieval.query_rewrite` | `retrieval/query/rewriteQuery.ts` | Yes | No DB. |
| `retrieval.query_rewrite.phase_b` | `retrieval/query/rewriteQuery.ts` | Yes | No DB. |
| `embedding.query_batch` | `orchestration/retrievalEmbeddingBatch.ts` | Embedding | No DB. Batches memory, canon, raw-memory, and HyDE embeddings in parallel. Traces query kinds, model, char counts, estimated tokens, and duration. |
| `retrieval.interactive_memories` | `retrieval/memory/retrieveInteractiveMemories.ts` | No | Reads `interactive_memory_events`; best-effort access update. Filters to `status = 'active'`. |
| `retrieval.canon` | `retrieval/canon/retrieveCanonTier3Pipeline.ts` | No | Reads canon tables. |
| `retrieval.canon.scene_summary_search` | `retrieval/canon/searchSceneSummaries.ts` | No | Reads scene/chapter/arc/episode rows. |
| `retrieval.canon.facts_search` | `retrieval/canon/searchFacts.ts` | No | Reads `story_facts` and related canon rows. |
| `retrieval.canon.unit_search` | `retrieval/canon/searchUnitVectors.ts` | No | Reads `story_units` and related canon rows. |
| `retrieval.canon.lexical_unit_search` | `retrieval/canon/searchLexicalUnitScenes.ts` | No | Lexical scan of `story_units`. |
| `retrieval.canon.anchor_fusion` | `retrieval/canon/fuseAnchors.ts` | No | In-memory rank fusion. |
| `retrieval.canon.fine_expansion` | `retrieval/canon/expandScenes.ts` | No | Expands selected scene anchors from canon tables. |
| `retrieval.recent_turns` | `retrieval/conversation/getRecentConversationWindow.ts` | No | Reads recent `chat_messages`. |
| `retrieval.session_summary` | `memory/session/sessionSummaryRepo.ts` | No | Reads `session_summaries`. |
| `retrieval.session_state` | `state/sessionStateRepo.ts` | No | Reads `session_state`. |
| `retrieval.session_memory_chunks` | `retrieval/memory/retrieveSessionMemoryChunks.ts` | No | Reads older `session_memory_chunks`. |
| `retrieval.structmem_entries` | `retrieval/memory/retrieveStructMemEntries.ts` | No | Reads older `structmem_entries`. Filters to `status = 'active'`. |
| `retrieval.structmem_entry_context_expansions` | `retrieval/memory/retrieveStructMemEntryContextExpansions.ts` | No | Expands selected StructMem entries through linked event messages. |
| `retrieval.structmem_consolidations` | `retrieval/memory/retrieveStructMemConsolidations.ts` | No | Reads current-session and cross-session `structmem_consolidations`. |
| `retrieval.open_threads` | `retrieval/memory/retrieveOpenThreads.ts` | No | Reads active StructMem open threads and session-summary open threads. Filters StructMem rows to `status = 'active'` and `entry_type = 'open_thread'`; filters summary threads to `open` or `paused`. |
| `retrieval.prompt_context_selector` | `orchestration/promptMemoryContextSelector.ts` | No | Applies source budgets, score thresholds, dedup, correction drops, and correction-supersession drops. Tracks `droppedBudgetCount`. |
| `retrieval.context_diagnostics` | `orchestration/retrievalDiagnostics.ts` | No | Emits planning, selection, timing, injection/drop diagnostics including `droppedBudgetCount`. |
| `prompt.build_context` | `orchestration/buildPromptContext.ts` | No | No DB. Builds system prompt blocks. Traces prompt version, hash, block presence, per-block token estimates, and total estimated tokens. |
| `llm.recall_thought` | `orchestration/runCharacterTurn.ts` | Yes | No DB. Traces memory/canon context presence, output length, and timeout-before-final-replay flag. |
| `llm.response_generation` | `orchestration/generateAndValidate.ts` | Yes | No DB; may call tools. Output carries token usage and cost via `attachTraceLlmMetadata`. |
| `llm.response_rewrite_generation` | `orchestration/generateAndValidate.ts` | Yes | No DB; may call tools. |
| `tool.canon_lookup` | `llm/tools/canonLookupTool.ts` | Embedding | Embeds tool query and retrieves compact canon context. |
| `llm.run_response_validator` | `llm/validation/runResponseValidator.ts` | Yes | No DB; optional attribution judge can run inside. Output carries token usage and cost. |
| `llm.run_attribution_judge` | `llm/validation/runAttributionJudge.ts` | Yes | No DB. Output carries token usage and cost. |
| `llm.run_memory_dedup_judge` | `llm/validation/runMemoryDedupJudge.ts` | Yes | No DB. Output carries token usage and cost. |
| `llm.extract_post_turn_signals` | `llm/extraction/extractPostTurnSignals.ts` | Yes | No direct DB; creates embeddings for extracted candidates. Output carries token usage and cost. |
| `post_turn.write_plan` | `jobs/postTurnRunner.ts` | No | No DB; traces write/skip decisions and skipped reasons. Built by `buildPostTurnWritePlan()`. |
| `memory.write_session_chunk` | `memory/session/writeSessionMemoryChunk.ts` | Embedding | Inserts raw or extractor session chunks. |
| `memory.write_structmem_event` | `memory/structmem/writeStructMemTurn.ts` | No | Inserts StructMem event and message links. |
| `memory.write_structmem_entry` | `memory/structmem/writeStructMemTurn.ts` | No | Inserts typed StructMem entries. |
| `memory.maybe_enqueue_structmem_consolidation` | `memory/structmem/structmemConsolidationRepo.ts` | No | May insert `structmem_consolidation_jobs`. |
| `llm.structmem_consolidation` | `memory/structmem/structmemConsolidationSynthesis.ts` | Yes | No DB; generates current-session consolidation text. Output carries token usage and cost. |
| `llm.structmem_cross_session_distillation` | `memory/structmem/structmemConsolidationSynthesis.ts` | Yes | No DB; generates stable cross-session items. Output carries token usage and cost. |
| `memory.run_structmem_consolidation` | `memory/structmem/structmemConsolidationRepo.ts` | Yes | Writes `structmem_consolidations` and source links. |
| `memory.write_cross_session_structmem_consolidations` | `memory/structmem/structmemConsolidationRepo.ts` | Yes | May write cross-session consolidations and promote to durable memory. |
| `memory.session_summary_compact` | `memory/session/compactSessionSummary.ts` | Sometimes | May upsert `session_summaries`. |

## Trace Coverage by Workflow Step

| Workflow step | Primary spans | What LangSmith shows |
| --- | --- | --- |
| API entry | `orchestration.run_character_turn_stream` or `orchestration.run_character_turn` | Top-level root span with `TraceBaseMetadata` (pipeline config, model bindings, hashed player ID, git SHA). Wraps the full stream/non-stream orchestration path after the route handler. |
| Session load | `orchestration.load_session` | Session lookup span; emits `sessionId`, `characterId`, and `mode`. |
| Turn route classification | `llm.classify_turn_route`, `orchestration.route_switch` | Extractor model classifies into `roleplay_turn` / `app_command` / `unsupported`. Credential disclosure requests are force-routed to `unsupported`. Fail-open on low confidence / parse error. Route switch span records classified route and persisted route. |
| Routing dispatch | `orchestration.roleplay_turn` or `orchestration.app_command` or `orchestration.unsupported_turn` | Marker spans for the executed route. App command and unsupported routes use cheap safe-deflection replies without LLM generation. |
| Context resolution shell | `orchestration.run_character_turn_stream` | Character/default loading, context resolution call, prompt build, persistence, and final SSE replay are inside the parent span. |
| Query rewrite | `retrieval.query_rewrite`, `retrieval.query_rewrite.phase_b` | Rewrite input/output, model confidence, parse/fallback behavior, and phase-B LLM call. |
| Embedding batch | `embedding.query_batch` | Batched memory, canon, raw-memory, and HyDE embeddings as a first-class span. Traces query kinds, embedding model, input char counts, estimated tokens, request count, failed count, and duration. |
| Main retrieval fan-out | `retrieval.interactive_memories`, `retrieval.canon` or `retrieval.canon_narrative`, `retrieval.recent_turns`, `retrieval.session_summary`, `retrieval.session_state` | DB retrieval branches and canon pipeline children. Main fan-out duration is also summarized in diagnostics. |
| Tier-3 canon internals | `retrieval.canon.scene_summary_search`, `retrieval.canon.facts_search`, `retrieval.canon.unit_search`, `retrieval.canon.lexical_unit_search`, `retrieval.canon.anchor_fusion`, `retrieval.canon.fine_expansion` | Coarse searches, rank fusion, and fine scene expansion as child retrieval stages. |
| Older recall | `retrieval.session_memory_chunks`, `retrieval.structmem_entries`, `retrieval.structmem_consolidations` | Older session chunks, StructMem entries, and StructMem synthesis retrieval. Older-recall timing is also in diagnostics. |
| Active open threads | `retrieval.open_threads` | Counts and source split for open threads from StructMem and session summaries. |
| Prompt memory selection | `retrieval.prompt_context_selector` | Compact selected/dropped diagnostics: source caps, injected counts, duplicate drops, low-score drops, correction drops, correction-supersession drops, budget drops, and top sources. |
| StructMem parent expansion | `retrieval.structmem_entry_context_expansions` | Selected expansion count and budget-drop count for parent message context. |
| Retrieval diagnostics | `retrieval.context_diagnostics` | Final per-turn diagnostic payload: intent, plan, query mode, rewrite confidence, retrieved/injected counts, dropped counts (including `droppedBudgetCount`), open-thread count, top sources, expansion diagnostics, and timing buckets. |
| Prompt build | `prompt.build_context` | System prompt construction with block-level stats: prompt version, hash, block presence, per-block token estimates, conversation message count, and total estimated tokens. |
| Recall thought | `llm.recall_thought` | First-class LLM span for recall summary generation. Traces memory/canon context presence, output length, and timeout-before-final-replay. Token usage and cost attached. |
| Draft generation | `llm.response_generation` | Streaming LLM span for draft generation, including native reasoning deltas and tool-loop events. Token usage and cost attached from accumulated stream data. |
| Tool calls | `llm.response_generation`, tool-specific spans such as `tool.canon_lookup` | Tool decision/result thoughts are emitted in the parent generation stream; tool internals may add their own spans. |
| Validation | `llm.run_response_validator`, optional `llm.run_attribution_judge` | Validator result, rewrite decision, issues, and optional attribution judge checks. Token usage and cost attached to both spans. |
| Rewrite generation | `llm.response_rewrite_generation` | Streaming LLM span for one rewrite pass when validation reports actionable issues. Token usage and cost attached. |
| Turn persistence | parent `orchestration.run_character_turn_stream` | Persists user/assistant messages, session state, chat session update, and post-turn job in one transaction. Now includes `route` (persisted route for roleplay results) and trace metadata with token usage totals on the parent span. |
| Post-turn extraction | `llm.extract_post_turn_signals` | Background extraction LLM call and candidate counts through output payload. |
| Post-turn write plan | `post_turn.write_plan` | Session/env gates, memory fact counts, native StructMem count, and skipped reasons for write paths. |
| Raw/session chunk writes | `memory.write_session_chunk` | Raw turn-pair chunk write and embedding work. Extractor chunk writes currently run inside the post-turn runner without a distinct per-candidate span. |
| StructMem writes | `memory.structmem.write_event_messages`, `memory.structmem.write_entries` | Event/message provenance insert and typed entry insert stages. |
| Durable memory write/dedup | optional `llm.run_memory_dedup_judge` | Obvious duplicate/distinct paths are local; ambiguous similarity invokes the traced dedup judge. |
| Summary compaction | `memory.session_summary_compact` | Threshold check, optional summary merge, and upsert behavior. |
| StructMem consolidation enqueue | `memory.maybe_enqueue_structmem_consolidation` | Eligibility and enqueue decision for consolidation jobs. |
| StructMem consolidation run | `memory.run_structmem_consolidation`, `llm.structmem_consolidation` | Job claim/run, consolidation synthesis, embedding/write, source linking, and job completion. |
| Cross-session StructMem write | `memory.write_cross_session_structmem_consolidations`, `llm.structmem_cross_session_distillation` | Stable-item distillation, cross-session consolidation writes, and optional durable-memory promotion. |

## Detailed Workflow

### 1. API Receives User Message

`sendMessageHandler` and `streamMessageHandler` parse the session id and message
content using `features/chat/chatSchemas.ts`.

Non-streaming:

```ts
runCharacterTurn({ sessionId, userMessage: content })
```

Streaming:

```ts
runCharacterTurnStreamTraced({
  sessionId,
  userMessage: content,
  signal,
  onEvent,
})
```

The handlers do not write chat rows directly. They delegate all turn work to
orchestration.

### 2. Load Session

`runCharacterTurnStream(...)` first calls `loadSession(sessionId)`, traced as
`orchestration.load_session`.

Failure behavior:

- if no row exists, the stream yields `error: Session not found`
- if `deleted_at` is set, the stream yields `error: Session ... has been deleted`

The session row supplies:

- `character_id`
- `player_id`
- `mode`
- `continuity_scope`
- `continuity_family`
- `persona_overlay_id`
- `memory_namespace`
- `writeback_policy`
- `thinking`
- `temperature`
- pinned time/location and display metadata

### 2.5 Classify Turn Route

After loading the session, `classifyTurnRoute({ session, userMessage, signal })`
routes the user message into one of three categories, traced as
`llm.classify_turn_route`.

The classifier uses the extractor model (`chatJsonStream`) with a structured
`RouteIntentSchema`:

```ts
{ type: "roleplay_turn" | "app_command" | "unsupported", confidence: 0..1, reason?: string }
```

**Credential disclosure guard:** Before sending to the LLM,
`isCredentialDisclosureRequest(userMessage)` checks for regex patterns matching
API keys, tokens, secrets, passwords, or credentials combined with disclosure
language (Chinese or English). If detected, the message is force-routed to
`unsupported` with 0.99 confidence.

**Fail-open behavior:**

- LLM exception → defaults to `roleplay_turn`
- JSON parse error → defaults to `roleplay_turn`
- Confidence below `ROUTE_CONFIDENCE_THRESHOLD` (0.7) → defaults to
  `roleplay_turn` with `fallbackReason: "low_confidence_roleplay_fail_open"`

The classified route is then recorded by `tracedRouteSwitch`
(`orchestration.route_switch`) with confidence and any fallback reason. The
stream dispatches to the appropriate handler:

| Route | Handler | Behavior |
| --- | --- | --- |
| `roleplay_turn` | `runRoleplayTurnStream` | Full retrieval → prompt → generation → validation pipeline. |
| `app_command` | `runAppCommandTurnStream` | Persists a safe stub reply; command execution is not yet implemented. |
| `unsupported` | `runUnsupportedTurnStream` | Persists `characterDefaults.safe_deflection` as the reply. |

The `app_command` and `unsupported` routes skip all LLM generation, validation,
and retrieval — they only persist a cheap response. The `route` value is carried
through persistence and emitted in the `done` SSE event / `TurnOutput`.

For `roleplay_turn`, the pipeline continues below. Character defaults and
persona overlays are loaded from local YAML/config. The overlay id defaults to
the session continuity scope when `persona_overlay_id` is null.

### 3. Resolve Context

`resolveContext(...)` prepares all retrieval context for prompt construction.

#### 3.1 Continuity Scope

`resolveContinuityScope(...)` maps the session continuity scope/family into
canon `arcKeys`. These arc keys restrict canon retrieval to the active
continuity.

DB interaction: none.

#### 3.2 Query Rewrite

`rewriteQuery(userMessage)` lives in `retrieval/query/rewriteQuery.ts`.

The rewrite path:

1. Parses structural spans from the raw roleplay-style user message.
2. Calls the extractor model in phase B.
3. Labels spans such as user thought, action, speech, and reply direction.
4. Returns entities, intent, confidence, and optional HyDE text.
5. Produces `combined_for_embedding` for retrieval.

Fail-open behavior: malformed parse/model output falls back to the raw user
message or heuristic annotations.

#### 3.3 Embeddings

Embedding creation is now centralized through `runRetrievalEmbeddingBatch(...)`
(`orchestration/retrievalEmbeddingBatch.ts`), traced as `embedding.query_batch`.

`buildRetrievalEmbeddingRequests(...)` determines which embeddings to create:

- **memory** (always) — uses the memory-specific query text
- **canon** (always) — uses the canon-specific query text
- **rawMemory** (conditional) — when raw/rewrite fusion is active
- **hyde** (conditional) — when HyDE is enabled, tier-3 canon, and
  hypothetical text is non-empty

The batch runs all embeddings in `Promise.all` and traces:

- `queryKinds` — which embedding types were requested
- `embeddingModelProvider` / `embeddingModelName`
- `inputCharCounts` — character counts per query kind
- `estimatedInputTokens` — token estimates per query kind (chars / 4)
- `requestedCount` / `failedCount`
- `durationMs`

Results are mapped to named keys by `mapRetrievalEmbeddingResults()`. On batch
failure, a minimal trace payload is attached to the error object.

Tier-3 mode:

- source-specific query text is derived from `QueryRewriteResult`
- memory query text prioritizes user speech, action, and thought lanes
- canon query text prioritizes entities, user speech/action, and
  attribution/recall wording
- reply directions are omitted unless no other useful text exists
- low-confidence, parse-failed, or annotation-fallback rewrites can trigger
  raw-memory plus rewritten-memory fusion
- memory, canon, optional raw-memory, and optional HyDE embeddings are created
  in one ordered batch

Tier-1 mode:

- keeps legacy behavior: canon can use the raw user message while memory may use
  the rewritten query, depending on flags

### 4. Main Retrieval Fan-Out

After embeddings, `resolveContext(...)` runs the main retrieval branches with
`Promise.all`:

1. `retrieval.interactive_memories`
2. tier-1 `retrieval.canon_narrative` or tier-3 `retrieval.canon`
3. `retrieval.recent_turns`
4. `retrieval.session_summary`
5. `retrieval.session_state`

It also builds an internal retrieval plan from rewrite intent and confidence.
Known intents include scene continuation, canon facts, personal recall,
emotional response, plan/promise, relationship progression, and general turns.
Low-confidence or unknown intent keeps the broad fail-open retrieval plan.

#### 4.1 Durable Interactive Memories

`retrieveInteractiveMemories(...)` vector-searches `interactive_memory_events`
within the session `memory_namespace` and `character_id`.

Rows are filtered to `status = 'active'`, so superseded durable memories are not
returned by default after the lifecycle migration is applied.

It returns durable cross-session memories such as preferences, promises,
relationship facts, or recurring patterns. After retrieval, it starts a
best-effort, non-awaited update of `last_accessed_at` and `reuse_count`.

When raw/rewrite fusion is active, raw and memory-specific retrieval results are
fused by id with reciprocal-rank fusion. Prompt formatting keeps the best score
metadata.

#### 4.2 Canon Retrieval

When `CANON_RETRIEVAL_PIPELINE === "tier3"`, `retrieveCanonCoarseToFine(...)`
runs the current coarse-to-fine canon pipeline.

Internal parallel searches:

- scene summary vector search
- fact vector search
- unit/dialogue vector search
- lexical unit search

Then it runs:

1. anchor fusion with reciprocal-rank style scoring
2. fine expansion of selected anchor scenes into units and facts

The result is returned as `canonScenes`, then converted into compatibility
`canonChunks` with `canonScenesToChunks(...)`.

When `CANON_RETRIEVAL_PIPELINE === "tier1"`, the backend uses
`retrieveCanonNarrativeLegacy(...)`, a legacy unit-level vector/lexical search
with same-scene expansion.

#### 4.3 Recent Turns

`getRecentConversationWindow(...)` reads recent `chat_messages`, orders them
chronologically in memory, and supplies the raw recent history used by the
generation prompt.

#### 4.4 Session Summary

`getSessionSummary(...)` reads `session_summaries` by `session_id`. This summary
represents older turns that have fallen out of the raw recent window.

Structured `openThreads` and `contradictionsOrCorrections` inside
`summary_json` are also used later for active open-thread retrieval and memory
correction prompt blocks.

#### 4.5 Session State

`getSessionState(...)` reads `session_state`. Its `last_turn_index` helps
compute the boundary between raw recent turns and older recall.

### 5. Older Session Recall

After the main fan-out, `resolveContext(...)` computes:

- `latestFrontierTurn`, from `session_state.last_turn_index` or the latest
  recent message
- `recentWindowStartTurn`, via `recentConversationWindowStartTurn(...)`

If there is a known frontier, the current code adds a small two-turn overlap
before the recent-window boundary, then runs these in parallel:

1. `retrieveSessionMemoryChunksTraced(...)`
2. `retrieveStructMemEntriesTraced(...)`, when `STRUCTMEM_ENABLED`
3. `retrieveStructMemConsolidationsTraced(...)`, when StructMem consolidation
   retrieval is enabled

The overlap intentionally makes boundary-adjacent older memories eligible; the
prompt selector removes duplicates already covered by recent chat.

#### 5.1 Session Memory Chunks

`session_memory_chunks` stores session-local semantic memories. Retrieval
filters by session, character, non-null embedding, and `turn_end` before the
recent window. Ranking combines vector similarity and a recency boost.

#### 5.2 StructMem Entries

`structmem_entries` stores typed current-session memories such as scene moments,
decisions, emotional shifts, and open threads. Retrieval filters to entries
before the recent raw window and ranks with the same similarity/recency pattern.
Rows are filtered to `status = 'active'`.

After prompt selection, up to three selected high-value StructMem entries may be
expanded through `structmem_event_messages` and `chat_messages`. These compact
parent context snippets are rendered inside the `STRUCTURED EVENT MEMORY` block
and are capped per entry and overall prompt budget.

#### 5.3 StructMem Consolidations

`structmem_consolidations` stores synthesized memory summaries.

Retrieval can include:

- current-session consolidations whose `turn_end` is before the recent window
- cross-session consolidations in the same `memory_namespace`

Current-session rows receive a recency boost. Cross-session rows are ranked by
similarity only.

### 6. Active Open Threads and Corrections

`retrieveOpenThreadsTraced(...)` pulls active open threads from two existing
sources:

- `structmem_entries` rows where `entry_type = 'open_thread'` and
  `status = 'active'`
- `session_summaries.summary_json.openThreads` rows whose status is `open` or
  `paused`

Open threads are selected and rendered as a first-class `ACTIVE OPEN THREADS`
prompt block before broad summary and semantic recall.

#### Memory Corrections

`retrieveActiveCorrections(sessionSummary)` in `orchestration/memoryCorrections.ts`
extracts `summary_json.contradictionsOrCorrections` from the session summary.
Each entry must have both `oldClaim` and `correctedClaim`. Corrections are
sorted by `sourceTurnIndex` descending and capped at 5.

These become a high-priority `MEMORY CORRECTIONS` prompt block via
`formatMemoryCorrections()`, rendered as:

```
1. [turn N] Replace "old claim" with "corrected claim".
```

The corrections also feed into `buildCorrectionSupersessionPlan()` from
`memory/lifecycle/correctionSupersessionPolicy.ts`, which checks each
retrieved candidate's text against each correction's `oldClaim` (case-insensitive,
whitespace-normalized substring match). Matching candidates produce a
`CorrectionSupersessionDecision` that causes the prompt memory selector to drop
that candidate in favor of the corrected claim. This ensures corrected memories
are not injected alongside their outdated versions.

### 7. Derived State

`computeDerivedState(...)` is heuristic and does not call the DB or an LLM.

It derives:

- mood from character defaults
- activity as `starting_conversation` or `in_conversation`
- stance such as `attentive`, `relaxed`, or `engaged`

The derived state is later stored in `session_state`.

### 8. Retrieval Diagnostics

Before returning context, `resolveContext(...)` emits
`retrieval.context_diagnostics`. The payload includes:

- query intent and retrieval plan
- memory query mode: single or fused
- rewrite confidence and annotation fallback status
- retrieved, injected, and dropped counts (duplicate, low-score,
  correction-drop, and budget-drop)
- top injected sources and active open-thread count
- boundary-overlap and latest-turn-delta metadata
- timing buckets for query rewrite, embeddings, main retrieval fan-out, older
  recall, open threads, prompt selection, and total context resolution
- StructMem entry expansion counts and budget drops

### 9. Prompt Context Build

`buildPromptContextTraced(...)` in `orchestration/buildPromptContext.ts` creates:

- a single system prompt with named context blocks
- conversation history from recent turns
- `retrievedCanonNarrative` for validator attribution checks

The function is traced as `prompt.build_context` with a `PromptTracePayload`:

- `promptVersion` and `promptHash` (SHA-256 of the system prompt)
- `systemPromptChars` and `conversationChars`
- `conversationMessageCount`
- `retrievedCanonNarrativeChars`
- `totalEstimatedPromptTokens`
- `blockPresence` — per-block boolean map
- `estimatedTokensByBlock` — per-block token estimate (chars / 4)
- `selectedSourceCounts` — injected counts per source

Block analysis uses `analyzePromptBlocks()` from `tracePayloads.ts`, which
splits the system prompt on `[BLOCK NAME]\n` headers and estimates tokens for
each block body.

Prompt block priority is encoded in the system prompt:

`RECENT CHAT` and the current user message are highest priority, followed by
derived state, active open threads, memory corrections, the latest turn delta,
summary, session recall, StructMem entries and expansions, StructMem synthesis,
interactive memory, and canon narrative.

The prompt can include:

- base persona
- continuity overlay
- relationship expression
- session state
- derived state
- active open threads
- memory corrections
- latest turn delta
- session summary
- relevant session recall
- structured event memory
- structured memory synthesis
- durable interactive memory
- canon narrative
- structured user query
- user message annotation rules

Before this step, `selectPromptMemoryContext(...)` applies source caps, minimum
scores, same-turn precedence, recent-chat dedup, cross-source dedup, correction
conflict drops, and correction-supersession drops. Selection diagnostics record
retrieved, injected, and dropped counts including `droppedBudgetCount`.

### 10. Optional Recall Thought

`runCharacterTurnStream(...)` starts a nonblocking recall-thought task via
`createRecallThoughtTask(...)` when retrieved durable memories or canon
excerpts exist. Draft generation is allowed to begin while the recall summary is
still running.

The recall thought is now traced as `llm.recall_thought`, with:

- `memoryContextPresent` / `canonContextPresent` — whether context exists
- `memoryContextCount` / `canonContextCount` — how many items
- `outputChars` — thought output length
- `timedOutBeforeFinalReplay` — whether the recall missed the final reply window

Token usage and cost are attached to the span when the thought is not a cache
hit. The thought content is generated via `generateThoughtSummaryWithUsage(...)`
with a `"recall"` stage parameter.

If the recall thought is ready early, it is emitted during the stream. After
draft/validation completes, the stream waits only a short timeout for recall; if
it is still not ready, final reply replay proceeds and the late thought can be
persisted afterward without delaying the client. The `traceState` records
`timedOutBeforeFinalReplay: true` in this case.

The thought is stored in `thoughtsAcc` and eventually persisted on the assistant
`chat_messages` row. The frontend normalizes streamed thoughts so a late
`recall` appears before the native `思考` run in the visible thought chain.

### 11. Generate with Tools

`generateAndValidateStream(...)` calls `generateWithToolsStream(...)`, traced as
`llm.response_generation`.

Tool behavior:

- tools are enabled for draft generation
- `getOpenAISchemas()` exposes provider-native tool schemas
- the provider chooses tools automatically
- the loop dispatches the first tool call returned by a model step
- default maximum assistant completion rounds is `MAX_TOOL_STEPS = 4`

Available tool dispatch comes from `llm/tools`.

Common tools:

- `canon_lookup`: embeds the lookup query and retrieves canon context
- `web_search`: uses the configured external search provider when available

During draft generation, normal assistant prose deltas are withheld from the
client until validation and persistence complete. Native provider reasoning
deltas may be converted into `native` thoughts. Tool calls and summarized tool
results are streamed as events.

### 12. Validate, Rewrite, or Deflect

`runResponseValidator(...)` validates the generated draft against character,
continuity, canon attribution, safety, and recent context.

If validation passes:

- the draft becomes the final reply

If validation requests a rewrite:

- system/transport-only issues are filtered out
- if no drafter-facing issues remain, the original draft is kept
- otherwise a `rewrite` thought is emitted
- `llm.response_rewrite_generation` runs with tools enabled and
  `maxToolSteps: 2`
- the rewrite is validated once more

If the second validation still has actionable issues:

- a `deflect` thought is emitted
- the final reply becomes `characterDefaults.safe_deflection`

Tool-loop exhaustion during draft or rewrite also produces a safe deflection.

### 13. Persist Completed Turn

`persistCompletedTurn(...)` performs the durable turn write inside one database
transaction, now traced with a `persistence.completed_turn` trace payload
attached to the result.

Inside the transaction:

1. Ensures a `session_state` row exists.
2. Locks the session state row with `FOR UPDATE`.
3. Reads `MAX(turn_index)` from `chat_messages`.
4. Computes next user/assistant turn indexes with
   `calculateNextTurnIndexes(...)`.
5. Inserts one user `chat_messages` row with `route`.
6. Inserts one assistant `chat_messages` row with validator result and thoughts.
7. Upserts `session_state` with derived state, a cheap latest-turn delta in
   `temporary_assumptions`, and assistant turn index.
8. Updates `chat_sessions.updated_at`.
9. Inserts one `post_turn_jobs` row with payload snapshot and pending step
   status.

The `route` stored on both messages reflects the persisted route:

- Roleplay turns: `persistedRouteForRoleplayResult(...)` maps deflected results
  to `unsupported`, otherwise `roleplay_turn`.
- App command / unsupported turns: stored directly as the classified route.

The persistence result carries a `BuildCompletedTurnPersistenceTracePayload`
with message IDs, turn indexes, session metadata, and total token usage from the
generation/validation spans. This payload is attached to the top-level turn
span.

This transaction is the handoff between foreground response work and background
memory work.

The latest-turn delta is rendered for only the next few turns and is omitted
after it expires.

### 14. Final Response

After persistence, `runCharacterTurnStream(...)` calls `postTurnRunner.wake()`.

Streaming then replays the final reply in fixed-size slices and emits `done`
with:

- `message_id`
- `content`
- `turn_index`
- `was_rewritten`
- `was_deflected`
- `route` — the persisted turn route
- accumulated thoughts

Non-streaming drains the same stream and returns a `TurnOutput`:

- `assistantMessageId`
- `content`
- `turnIndex`
- `wasRewritten`
- `wasDeflected`
- `route` — the persisted turn route

## Post-Turn Workflow

`postTurnRunner` extends `BackgroundRunner`. It starts on backend bootstrap,
polls by `POST_TURN_JOB_POLL_INTERVAL_MS`, and can also be awakened immediately
after a turn commits.

After signal extraction, the runner calls `buildPostTurnWritePlan(session, env,
signals)` from `jobs/postTurnPolicies.ts`. The plan centralizes write/skip
decisions for StructMem entries, StructMem consolidation enqueueing, extractor
session chunks, durable memory, and summary compaction. Each decision includes a
`skipReason` when a step is skipped.

The traced `post_turn.write_plan` span records:

- `durableMemory.write` / `sessionChunks.write` / `structMem.write` /
  `structMemConsolidation.write` — boolean gate decisions
- `durableMemory.skipReason` / `sessionChunks.skipReason` / etc. — why a step
  was skipped
- `memoryFactCount`, `structMemEntryCount`, `shouldWriteMemory` — signal counts

The write plan is built after extraction because it needs extracted signal
counts and memory scopes.

### 15. Claim Durable Job

`claimNextJob()` atomically updates one eligible `post_turn_jobs` row to
`running`.

Eligible jobs are:

- `pending` or `retry` with `run_after <= now`
- stale `running` jobs whose lock is older than
  `POST_TURN_JOB_LOCK_TTL_MS`

The claim query uses `FOR UPDATE SKIP LOCKED`, which allows multiple backend
processes to avoid claiming the same job.

On failure:

- status becomes `retry` until `max_attempts` is exhausted
- status becomes `failed` when exhausted
- `last_error` stores a truncated stack/message
- retry delay uses exponential backoff capped at 5 minutes

### 16. Step Progress

Each post-turn job carries a `step_status` JSON object with these steps:

1. `raw_chunk`
2. `extract_signals`
3. `structmem`
4. `session_chunks`
5. `durable_memory`
6. `summary_compact`

After each successful step, the runner persists the updated payload and
`step_status`. Retries skip completed steps.

### 17. Raw Turn Pair Chunk

Step: `raw_chunk`

`writeRawTurnPairSessionChunkTraced(...)` writes a raw session-local chunk for
the full user/assistant pair.

The chunk includes:

- user and assistant turn indexes
- user message and assistant reply
- embedding generated from the chunk text
- metadata tying it back to the turn

### 18. Extract Post-Turn Signals

Step: `extract_signals`

`extractPostTurnSignals(...)` calls the extractor model using:

- user message
- assistant reply
- session mode
- recent retrieved memory summaries
- derived session state

It returns memory candidates and, when native StructMem extraction is enabled,
StructMem entry candidates. Embeddings for memory candidates are created during
extraction.

The returned `signals` object is stored back into the `post_turn_jobs.payload`
so retries do not need to re-extract after the step completes.

The post-turn write plan is built after this step because it needs extracted
signal counts and memory scopes.

### 19. Write StructMem Entries

Step: `structmem`

When the post-turn write plan allows StructMem writes:

- native mode writes `signals.structMemEntries`
- non-native mode maps current-session `memoryFacts` through
  `collectPhase1StructMemPersistRows(...)`

`writeStructMemTurn(...)` inserts:

- one `structmem_events` row
- provenance links in `structmem_event_messages`
- typed rows in `structmem_entries`

After this step, if the write plan allows StructMem consolidation enqueueing,
the runner calls `maybeEnqueueStructMemConsolidation(...)`. This may insert a
`structmem_consolidation_jobs` row and wake `structmemConsolidationRunner`.

### 20. Write Extractor Session Chunks

Step: `session_chunks`

For each current-session memory candidate, the runner may insert an extractor
`session_memory_chunks` row.

The write plan skips the whole extractor chunk step when:

- the session is sandbox
- StructMem policy suppresses extractor chunks

Within the step, each candidate is skipped when:

- the candidate is not `current_session`
- an equivalent assistant-message/candidate-index chunk already exists

### 21. Write Durable Interactive Memory

Step: `durable_memory`

If the write plan allows durable memory, cross-session memory candidates are
passed to `writeInteractiveMemory(...)`.

Durable memory writes:

- require the namespace to match the continuity family
- require importance to clear the configured threshold
- deduplicate by vector similarity against existing `interactive_memory_events`
- update an existing near-duplicate or insert a new durable memory row

### 22. Compact Session Summary

Step: `summary_compact`

`maybeCompactSessionSummary(...)` checks whether enough older turns have fallen
out of the raw recent window. If compaction is due, it reads the relevant
`chat_messages`, calls the summary merger model, and upserts `session_summaries`.

## StructMem Consolidation Workflow

`structmemConsolidationRunner` is a second background runner. It starts from
`server.ts` only when both `STRUCTMEM_ENABLED` and
`STRUCTMEM_CONSOLIDATION_ENABLED` are true.

### 23. Enqueue Consolidation

`maybeEnqueueStructMemConsolidation(...)` checks unconsolidated
`structmem_entries` for the session.

It enqueues only when:

- StructMem consolidation is enabled
- the session is not sandbox
- minimum unconsolidated turn and entry thresholds are met
- no active consolidation job already exists for the session

### 24. Run Consolidation

`runStructMemConsolidation(...)`:

1. Selects unconsolidated buffer entries.
2. Optionally embeds the buffer and retrieves older semantic seed entries.
3. Calls `synthesizeStructMemConsolidation(...)`.
4. Embeds the synthesized summary.
5. Inserts one current-session `structmem_consolidations` row.
6. Inserts `structmem_consolidation_sources`.
7. Marks source `structmem_entries` as consolidated.
8. Marks the job completed.

After current-session consolidation, the runner may write cross-session
StructMem consolidations:

- `distillCrossSessionStructMem(...)` extracts stable cross-session items
- stable items are embedded and inserted as `scope = 'cross_session'`
- if promotion is enabled, they can be promoted into
  `interactive_memory_events`

## Parallelism Summary

### Before Retrieval

Session load and turn route classification are sequential. The classifier LLM
call (`llm.classify_turn_route`) runs before any retrieval work.

### Embedding Batch

In tier-3 mode, memory, canon, optional raw-memory fusion, and optional HyDE
query embeddings run together in a single `Promise.all` inside the traced
`embedding.query_batch` span.

### Main Retrieval

These run together:

- durable interactive memories
- canon retrieval
- recent raw turns
- session summary
- session state

Tier-3 canon has its own internal fan-out for scene summaries, facts, unit
vectors, and lexical search.

### Older Recall

These now run together after the recent-window boundary is known:

- session memory chunks
- StructMem entries
- StructMem consolidations

### Generation and Validation

Generation, validation, optional rewrite, second validation, and safe deflection
are sequential. Tool calls inside a generation step are handled one at a time;
only the first tool call from a model step is dispatched.

### Background Work

The post-turn job is background relative to the response. Inside one claimed job
the steps are mostly sequential, with step progress persisted after each stage.
StructMem consolidation is a separate durable job queue.

## LLM and Model Call Summary

| Step | Model kind | Required every turn? |
| --- | --- | --- |
| Turn route classification | Extractor chat JSON | Yes, fail-open (defaults to `roleplay_turn`). |
| Query rewrite phase B | Extractor chat JSON stream | Yes, fail-open. |
| Query embeddings | Embedding model (batched) | Yes for retrieval; memory + canon always, raw-memory + HyDE conditional. |
| Recall thought | Extractor chat | Only when recall context exists and streaming thoughts are produced. Now first-class `llm.recall_thought` span. |
| Draft reply | Generation streaming chat | Yes; only for `roleplay_turn`. |
| Tool thought summaries | Chat LLM | Only when tools are called. |
| Tool query embeddings | Embedding model | Only for tools such as `canon_lookup`. |
| Response validator | Validator chat JSON stream | Yes after first draft; only for `roleplay_turn`. |
| Attribution judge | Validator/judge chat | Only when strict attribution path applies. |
| Rewrite reply | Generation streaming chat | Only when validator requests actionable rewrite. |
| Second validator | Validator chat JSON stream | Only after rewrite. |
| Post-turn extraction | Extractor chat JSON | Background job step. |
| Raw chunk embedding | Embedding model | Background job step. |
| StructMem consolidation synthesis | Extractor/chat model | Only when consolidation job runs. |
| Cross-session StructMem distillation | Extractor/chat model | Only when phase-4 write is enabled. |
| Summary merger | Extractor chat JSON | Only when compaction threshold is met. |

## Database Interaction Summary

### `chat_sessions`

Read to load the active session. Updated at turn persistence time with
`updated_at = now`.

### `chat_messages`

Stores the canonical transcript. Each completed turn inserts one user row and
one assistant row. Recent-turn retrieval and summary compaction read from this
table.

### `session_state`

Tracks `last_turn_index` and derived state. It is locked during turn persistence
to allocate the next turn indexes safely.

### `post_turn_jobs`

Durable queue for post-turn memory work. Inserted in the same transaction as the
assistant message. Claimed and retried by `postTurnRunner`.

### `interactive_memory_events`

Durable cross-session memory. Read during prompt retrieval and durable-memory
deduplication; updated on access/dedup; inserted for new durable memories.
Lifecycle columns `status` (default `'active'`) and `superseded_by_id` allow
active-only retrieval and explicit correction-based supersession. The
`correctionSupersessionPolicy.ts` module checks retrieved candidates against
active memory corrections from `session_summaries`; matching candidates produce
supersession decisions that drop the outdated memory from prompt injection.

### `session_memory_chunks`

Session-local semantic memory. Read for older recall. Written as raw turn-pair
chunks and optionally extractor-derived current-session chunks.

### `session_summaries`

Compact summary of older session context. Read during prompt context resolution
and upserted by summary compaction.

### `structmem_events`

Groups a post-turn batch of structured memory entries.

### `structmem_event_messages`

Links StructMem events to exact user and assistant `chat_messages` rows.

### `structmem_entries`

Typed current-session event memory. Read during older recall and consolidation
selection. Written by the post-turn StructMem step. Lifecycle columns `status`
(default `'active'`) and `superseded_by_entry_id` allow active-only retrieval;
resolved or superseded open-thread rows are excluded from active open-thread
retrieval. Correction-based supersession also drops entries whose text matches
corrected old claims from session summaries.

### `structmem_consolidation_jobs`

Durable queue for StructMem synthesis jobs. Claimed by
`structmemConsolidationRunner`.

### `structmem_consolidations`

Synthesized structured memory. Can be current-session or cross-session. Read by
turn retrieval when consolidation retrieval is enabled.

### `structmem_consolidation_sources`

Provenance links from consolidation rows back to their source StructMem entries
and events.

### Canon Tables

The chatbot backend reads canon tables but does not write them:

- `relationship_arcs`
- `au_worlds`
- `story_chapters`
- `story_episodes`
- `story_scenes`
- `story_facts`
- `story_units`

## Mode and Environment Conditions

### Session Mode and Writeback

`writeback_policy` controls whether durable cross-session memories may be
written. `sandbox` mode skips raw chunks, StructMem writes, extractor session
chunks, and StructMem consolidation eligibility.

### Canon Retrieval

`CANON_RETRIEVAL_PIPELINE` selects:

- `tier1`: legacy unit-level canon retrieval
- `tier3`: current coarse-to-fine scene pipeline

`CANON_QUERY_HYDE` can add a hypothetical query embedding to tier-3 canon
searches.

### StructMem

Relevant flags:

- `STRUCTMEM_ENABLED`
- `STRUCTMEM_NATIVE_EXTRACTOR`
- `STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS`
- `STRUCTMEM_CONSOLIDATION_ENABLED`
- `STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED`
- `STRUCTMEM_CROSS_SESSION_WRITE_ENABLED`
- `STRUCTMEM_PROMOTION_TO_IME_ENABLED`

Effects:

- disabled StructMem skips entry retrieval and writes
- native extraction writes native StructMem candidates
- non-native extraction maps current-session memory facts into StructMem rows
- consolidation retrieval adds `STRUCTURED MEMORY SYNTHESIS` to the prompt
- cross-session consolidation retrieval can recall stable synthesized memories
  by namespace
- promotion can copy stable StructMem items into durable interactive memory

Common flag recipes:

| Recipe | Flags | Behavior |
| --- | --- | --- |
| StructMem off | `STRUCTMEM_ENABLED=false` | Skips StructMem entry writes/retrieval and consolidation jobs. |
| Current-session StructMem only | `STRUCTMEM_ENABLED=true`, `STRUCTMEM_CONSOLIDATION_ENABLED=false`, `STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED=false`, `STRUCTMEM_CROSS_SESSION_WRITE_ENABLED=false` | Writes and retrieves current-session StructMem entries, without synthesized consolidation. |
| Current-session synthesis | `STRUCTMEM_ENABLED=true`, `STRUCTMEM_CONSOLIDATION_ENABLED=true`, `STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED=false`, `STRUCTMEM_CROSS_SESSION_WRITE_ENABLED=false` | Adds current-session consolidation jobs and retrieves current-session synthesis. |
| Cross-session read-only | `STRUCTMEM_ENABLED=true`, `STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED=true`, `STRUCTMEM_CROSS_SESSION_WRITE_ENABLED=false` | Reads existing cross-session consolidations by namespace; does not write new cross-session rows. |
| Cross-session write and read | `STRUCTMEM_ENABLED=true`, `STRUCTMEM_CONSOLIDATION_ENABLED=true`, `STRUCTMEM_CROSS_SESSION_WRITE_ENABLED=true`, `STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED=true` | Distills stable items after consolidation and can retrieve them in later sessions. |
| Promote stable StructMem to durable memory | Cross-session write/read flags plus `STRUCTMEM_PROMOTION_TO_IME_ENABLED=true` | Allows stable cross-session StructMem items to be copied into `interactive_memory_events`. |

Startup validation warns for suspicious combinations, such as consolidation
without `STRUCTMEM_ENABLED`, cross-session write with no read or promotion path,
or cross-session retrieval without consolidation enabled.

## End-to-End Timeline

```mermaid
sequenceDiagram
  participant Client
  participant API as Fastify chatHandlers
  participant Orch as runCharacterTurnStream
  participant Class as classifyTurnRoute
  participant Ctx as resolveContext
  participant DB as Postgres
  participant LLM as LLM Providers
  participant Post as postTurnRunner
  participant Cons as structmemConsolidationRunner

  Client->>API: POST /api/sessions/:id/messages[/stream]
  API->>Orch: runCharacterTurn or runCharacterTurnStreamTraced
  Orch->>DB: SELECT chat_sessions (loadSession)
  Orch->>Class: classifyTurnRoute(session, userMessage)
  Class->>LLM: extractor classify (roleplay/app/unsupported)
  alt roleplay_turn
    Orch->>Orch: tracedRoleplayTurn
    Orch->>Ctx: resolveContext(session, userMessage)
    Ctx->>LLM: query rewrite
    Ctx->>LLM: embedding.query_batch (memory/canon/raw/hyde)
    par Main retrieval fan-out
      Ctx->>DB: SELECT/UPDATE interactive_memory_events
      Ctx->>DB: SELECT canon tables
      Ctx->>DB: SELECT chat_messages recent turns
      Ctx->>DB: SELECT session_summaries
      Ctx->>DB: SELECT session_state
    end
    par Older recall
      Ctx->>DB: SELECT session_memory_chunks
      Ctx->>DB: SELECT structmem_entries
      Ctx->>DB: SELECT structmem_consolidations
    end
    Ctx->>DB: SELECT active open threads
    Ctx->>DB: retrieve active memory corrections
    Ctx->>Ctx: select prompt memory context (with correction drops)
    Ctx->>DB: expand selected StructMem entries
    Ctx->>Ctx: emit retrieval diagnostics
    Ctx-->>Orch: context inputs
    Orch->>LLM: prompt.build_context
    par Nonblocking thought and draft
      Orch->>LLM: llm.recall_thought
      Orch->>LLM: llm.response_generation, optional tools
    end
    Orch->>LLM: validate draft
    opt validation needs rewrite
      Orch->>LLM: rewrite draft
      Orch->>LLM: validate rewrite
    end
    Orch->>Orch: tracedRouteSwitch
    Orch->>DB: TX insert chat_messages (with route)
    Orch->>DB: TX upsert session_state
    Orch->>DB: TX update chat_sessions
    Orch->>DB: TX insert post_turn_jobs
    Orch->>Post: wake
    Orch-->>API: final reply events/result (with route)
    API-->>Client: SSE done or JSON
  else app_command / unsupported
    Orch->>DB: persist safe reply (no LLM generation)
    Orch-->>API: done with route
    API-->>Client: SSE done or JSON
  end

  Post->>DB: claim post_turn_jobs
  Post->>LLM: embed/write raw turn chunk
  Post->>LLM: extract post-turn signals
  Post->>Post: build write plan (post_turn.write_plan)
  Post->>DB: INSERT structmem_events/entries
  opt consolidation eligible
    Post->>DB: INSERT structmem_consolidation_jobs
    Post->>Cons: wake
  end
  Post->>DB: INSERT session_memory_chunks
  Post->>DB: INSERT/UPDATE interactive_memory_events
  Post->>LLM: maybe merge session summary
  Post->>DB: UPSERT session_summaries
  Post->>DB: mark post_turn_jobs completed

  Cons->>DB: claim structmem_consolidation_jobs
  Cons->>LLM: synthesize consolidation
  Cons->>DB: INSERT structmem_consolidations/sources
  opt cross-session write enabled
    Cons->>LLM: distill stable cross-session items
    Cons->>DB: INSERT cross-session structmem_consolidations
    Cons->>DB: maybe promote to interactive_memory_events
  end
```

## Source Files Worth Reading First

- `chatbot/backend/src/http/routes/chatRoutes.ts`
- `chatbot/backend/src/features/chat/chatHandlers.ts`
- `chatbot/backend/src/orchestration/runCharacterTurn.ts`
- `chatbot/backend/src/orchestration/classifyTurnRoute.ts`
- `chatbot/backend/src/orchestration/turnRoutes.ts`
- `chatbot/backend/src/orchestration/recallThoughtTask.ts`
- `chatbot/backend/src/orchestration/resolveContext.ts`
- `chatbot/backend/src/orchestration/buildPromptContext.ts`
- `chatbot/backend/src/orchestration/promptMemoryContextSelector.ts`
- `chatbot/backend/src/orchestration/retrievalDiagnostics.ts`
- `chatbot/backend/src/orchestration/retrievalEmbeddingBatch.ts`
- `chatbot/backend/src/orchestration/memoryCorrections.ts`
- `chatbot/backend/src/orchestration/generateAndValidate.ts`
- `chatbot/backend/src/orchestration/generateWithTools.ts`
- `chatbot/backend/src/orchestration/turnPersistence.ts`
- `chatbot/backend/src/orchestration/turnDelta.ts`
- `chatbot/backend/src/jobs/backgroundRunner.ts`
- `chatbot/backend/src/jobs/postTurnRunner.ts`
- `chatbot/backend/src/jobs/postTurnPolicies.ts`
- `chatbot/backend/src/jobs/postTurnJobPayload.ts`
- `chatbot/backend/src/jobs/structmemConsolidationRunner.ts`
- `chatbot/backend/src/observability/langsmithTracing.ts`
- `chatbot/backend/src/observability/traceMetadata.ts`
- `chatbot/backend/src/observability/traceTags.ts`
- `chatbot/backend/src/observability/tracePayloads.ts`
- `chatbot/backend/src/retrieval/query/rewriteQuery.ts`
- `chatbot/backend/src/retrieval/canon/retrieveCanonNarrative.ts`
- `chatbot/backend/src/retrieval/canon/retrieveCanonTier3Pipeline.ts`
- `chatbot/backend/src/retrieval/memory/retrieveInteractiveMemories.ts`
- `chatbot/backend/src/retrieval/memory/retrieveOpenThreads.ts`
- `chatbot/backend/src/retrieval/memory/retrieveSessionMemoryChunks.ts`
- `chatbot/backend/src/retrieval/memory/retrieveStructMemEntries.ts`
- `chatbot/backend/src/retrieval/memory/retrieveStructMemEntryContextExpansions.ts`
- `chatbot/backend/src/retrieval/memory/retrieveStructMemConsolidations.ts`
- `chatbot/backend/src/memory/lifecycle/correctionSupersessionPolicy.ts`
- `chatbot/backend/src/memory/session/writeSessionMemoryChunk.ts`
- `chatbot/backend/src/memory/interactive/writeInteractiveMemory.ts`
- `chatbot/backend/src/memory/structmem/writeStructMemTurn.ts`
- `chatbot/backend/src/memory/structmem/structmemConsolidationRepo.ts`
- `chatbot/backend/src/memory/structmem/structmemConsolidationSynthesis.ts`
- `chatbot/backend/src/memory/session/compactSessionSummary.ts`
- `chatbot/backend/src/db/schema/chat.ts`
- `chatbot/backend/src/db/schema/jobs.ts`
- `chatbot/backend/src/db/schema/memory.ts`
- `chatbot/backend/src/db/schema/structmem.ts`
- `chatbot/backend/src/db/schema/canon.ts`
- `chatbot/frontend/src/hooks/useStreamMessage.ts`
- `chatbot/frontend/src/lib/thoughtDisplay.ts`
