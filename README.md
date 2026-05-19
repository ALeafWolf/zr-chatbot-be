# Chatbot backend

Fastify 5 HTTP API for the Zuoran character chat bot. TypeScript, Drizzle ORM, PostgreSQL with `pgvector`, multi-provider LLM routing (Anthropic / OpenAI / DeepSeek).

The backend reads canon data from PostgreSQL. Chat-owned tables — sessions, messages, memory embeddings, StructMem, post-turn jobs, persona overlays — are defined here and migrated with Drizzle.

## Prerequisites

- Node.js 20+
- PostgreSQL with `CREATE EXTENSION IF NOT EXISTS vector;`
- Existing `zuoran` database populated with canon via the ingest pipeline
- Provider API keys: OpenAI (embeddings), Anthropic (generation + validation), DeepSeek (post-turn extraction)
- Optional: `TAVILY_API_KEY` for the web-search tool during generation

## Quick start

From this directory:

```bash
cp .env.example .env
# Edit .env: DATABASE_URL and all provider keys are required.

npm install
npm run db:migrate
npm run dev
```

The server listens on `http://localhost:4000` by default (`PORT` overrides). CORS allows `FRONTEND_ORIGIN` (default `http://localhost:5173`).

On startup the process warms character YAML caches, starts the post-turn background worker, and optionally starts the StructMem consolidation worker when both `STRUCTMEM_ENABLED` and `STRUCTMEM_CONSOLIDATION_ENABLED` are true. SIGINT/SIGTERM drain in-flight jobs before exit.

Health check:

```bash
curl http://localhost:4000/health
```

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Hot reload: `tsx watch` on `src/server.ts` and `src/**/*.yaml` (character/overlays). Use this for local API work — not `start`. |
| `npm run typecheck` | Run TypeScript without emitting files |
| `npm run build` | Bundle to `dist/` with `tsup` |
| `npm run start` | Run `dist/server.js` (after `build`; no file watcher) |
| `npm run db:generate` | Generate Drizzle migrations from schema |
| `npm run db:migrate` | Apply migrations via Drizzle Kit |
| `npm run db:init` | Apply `drizzle/migrations/0000_init.sql` directly with `pg` (alternative path) |
| `npm run eval` | Local regression eval from `src/eval/scenarios.json` |
| `npm run eval:retrieval` | Retrieval-only scenarios (`eval_mode: retrieval`) |
| `npm run eval:dataset:push` | Replace LangSmith dataset from scenarios |
| `npm run eval:langsmith` | Run LangSmith experiment on that dataset |
| `npm run test:unit` | Node test runner on `src/**/*.unit.ts` |
| `npm run test:structural-parse` | Fixture runner for user-message structural parse |
| `npm run fixtures:parse-json` | Fixture runner for LLM JSON output parsing |

## Environment variables

All variables are validated at startup in `src/config/env.ts`. Copy `.env.example` for a full template with inline comments.

### Required

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Same DB as scene ingestor |
| `OPENAI_API_KEY` | Embeddings |
| `ANTHROPIC_API_KEY` | Generation + validation |
| `DEEPSEEK_API_KEY` | Post-turn extractor |

### Server and defaults

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `4000` | |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS origin |
| `DEFAULT_PLAYER_ID` | `local_dev` | Phase 1 single-player stub |
| `DEFAULT_CHARACTER_ID` | `zuo_ran` | |
| `DEFAULT_SESSION_THINKING` | `true` | Session-level extended thinking |
| `DEFAULT_SESSION_TEMPERATURE` | `1` | Clamped 0–2 |

### Model bindings

| Variable | Default |
|----------|---------|
| `GENERATION_MODEL` | `anthropic:claude-sonnet-4-5` |
| `VALIDATOR_MODEL` | `anthropic:claude-haiku-4-5` |
| `EXTRACTOR_MODEL` | `deepseek:deepseek-chat` |
| `EMBEDDING_MODEL` | `openai:text-embedding-3-small` |
| `EMBEDDING_DIMENSIONS` | `1536` |

`provider:model` syntax is parsed in `src/config/models.ts`. Several features accept `EXTRACTOR_MODEL` as a sentinel to reuse the extractor binding (memory rerank, StructMem consolidation).

### Retrieval, validation, and memory (optional)

| Variable | Default | Notes |
|----------|---------|-------|
| `CANON_RETRIEVAL_PIPELINE` | `tier3` | `tier1` or `tier3` |
| `CANON_QUERY_HYDE` | `false` | HyDE-style canon query expansion |
| `USE_REWRITTEN_QUERY_FOR_MEMORY_EMBEDDING` | `false` | |
| `REWRITE_CONFIDENCE_THRESHOLD` | `0.6` | |
| `VALIDATOR_STRICT_ATTRIBUTION` | `false` | |
| `VALIDATOR_ATTRIBUTION_JUDGE_MODEL` | — | Optional override |
| `MEMORY_RERANK_MODEL` | `EXTRACTOR_MODEL` | LLM context selection |
| `MEMORY_RERANK_MAX_CANDIDATES` | `24` | |
| `MEMORY_RERANK_MAX_SELECTED` | `8` | |
| `MEMORY_RERANK_TIMEOUT_MS` | `30000` | |

### StructMem and background jobs (optional)

StructMem flags (`STRUCTMEM_ENABLED`, consolidation thresholds, cross-session retrieval/writeback, motif probe) and post-turn worker tuning (`POST_TURN_JOB_*`) are documented in `.env.example`. Defaults keep StructMem and consolidation off unless explicitly enabled.

### LangSmith and tracing (optional)

| Variable | Default | Notes |
|----------|---------|-------|
| `LANGSMITH_TRACING` | `false` | Set `true` to trace |
| `LANGSMITH_API_KEY` | — | Required for LangSmith CLI flows |
| `LANGSMITH_PROJECT` | `zuoran-chatbot-phase1` | |
| `LANGSMITH_ENDPOINT` | `https://api.smith.langchain.com` | |
| `LANGSMITH_EVAL_DATASET` | `zuoran-phase1-eval` | Dataset name for push + experiment |
| `TRACE_ENVIRONMENT` | `NODE_ENV` or `development` | Attached to traces |
| `APP_VERSION` | `dev` | |
| `GIT_SHA` | `unknown` | |
| `TRACE_PLAYER_HASH_SALT` | `zuoran-local-trace-salt` | |

## HTTP API (summary)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/characters` | List characters |
| `GET` | `/api/scopes` | List main-world continuity scopes |
| `GET` | `/api/modes` | List session modes |
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Session + paginated messages |
| `PATCH` | `/api/sessions/:id` | Update `display_title`, `thinking`, and/or `temperature` |
| `POST` | `/api/sessions/:id/messages` | User message → full character turn (JSON response) |
| `POST` | `/api/sessions/:id/messages/stream` | Same turn over Server-Sent Events |
| `DELETE` | `/api/sessions/:id` | Soft-delete session |
| `GET` | `/health` | Liveness |

Example create session JSON:

```json
{
  "character_id": "zuo_ran",
  "mode": "canonical_live",
  "continuity_scope": "main_married",
  "pinned_time": null,
  "pinned_location": null,
  "thinking": true,
  "temperature": 1,
  "display_title": null
}
```

Example send message JSON: `{ "content": "你好。" }`.

Non-streaming turn response includes `message_id`, `content`, `turn_index`, `was_rewritten`, `was_deflected`, and `route`.

## Drizzle schema

`drizzle.config.ts` includes only chatbot-owned schema files:

- `src/db/schema/chat.ts` — sessions and messages
- `src/db/schema/memory.ts` — interactive memory, session summaries/chunks
- `src/db/schema/persona.ts` — persona overlays
- `src/db/schema/structmem.ts` — StructMem events, entries, consolidations
- `src/db/schema/jobs.ts` — post-turn job queue

`src/db/schema/canon.ts` and `vector.ts` mirror canon tables for typed queries; canon DDL remains owned by script-extractor. Do not regenerate migrations here that alter canon definitions.

Migrations live in `drizzle/migrations/` (currently `0000`–`0012`).

## Background jobs

Post-turn work (session memory chunks, interactive memory writes, StructMem turn writes, extraction) is enqueued in PostgreSQL and processed by `src/jobs/postTurnRunner.ts`. When StructMem consolidation is enabled, `src/jobs/structmemConsolidationRunner.ts` synthesizes in-session consolidations on a separate poll loop. Both workers are drained on graceful shutdown.

## LangSmith tracing

When `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` is set, the pipeline emits named spans (orchestration, retrieval, LLM stages). Detail list lives in [../README.md](../README.md#langsmith-tracing). For eval setup and experiment flow, see [docs/langsmith-eval-guide.md](docs/langsmith-eval-guide.md).

## Regression eval

- **`npm run eval`** — Loads `src/eval/scenarios.json`. Runs validator assertions on `input_draft` rows, Tier 3 retrieval assertions when `eval_mode` is `retrieval`, or stub paths where full LLM replay is not wired.

  ```bash
  npx tsx src/eval/runEval.ts --scenario no_ai_claim
  ```

- **`npm run eval:retrieval`** — Runs only retrieval-mode scenarios (no generation).

- **`npm run eval:dataset:push`** — Requires `LANGSMITH_API_KEY`. Pushes scenarios to dataset `LANGSMITH_EVAL_DATASET` (replacing examples in that dataset).

- **`npm run eval:langsmith`** — Runs a LangSmith experiment on that dataset after push. Full-turn agent eval uses isolated `eval_*` sessions (`src/eval/langsmith/`).

## Docs

| File | Contents |
|------|----------|
| [docs/langsmith-eval-guide.md](docs/langsmith-eval-guide.md) | LangSmith datasets, agent eval flow, snapshots |
| [docs/turn_workflow_analysis.md](docs/turn_workflow_analysis.md) | Turn pipeline design notes |
| [docs/db-deprecation-audit.md](docs/db-deprecation-audit.md) | Schema deprecation audit |

## Source layout (orientation)

| Path | Role |
|------|------|
| `src/server.ts` | Process lifecycle: app startup, workers, graceful shutdown |
| `src/http/` | Fastify app, route plugins (`sessionRoutes`, `chatRoutes`), error handling |
| `src/features/` | HTTP handlers and services: `sessions/`, `chat/` (incl. SSE), `turns/`, `memory/`, `structmem/` |
| `src/orchestration/` | Turn pipeline: `turn/runCharacterTurn`, context planning, retrieval fusion/rerank, prompt build, generation/validation, persistence |
| `src/llm/` | Providers, embeddings, generation, validation judges, extraction, JSON parsing, summarization, tools |
| `src/retrieval/` | Canon, conversation windows, memory/StructMem retrieval, query rewrite and structural parse |
| `src/memory/` | Session summaries/chunks, interactive writes, StructMem writes/consolidation, lifecycle policies |
| `src/character/` | Profiles, persona overlays, YAML defaults under `defaults/` and `overlays/` |
| `src/db/` | Pool client, Drizzle schemas |
| `src/jobs/` | Post-turn and StructMem consolidation background runners |
| `src/state/` | Player profile and session state repositories |
| `src/config/` | `env.ts`, model bindings, StructMem config validation |
| `src/observability/` | LangSmith tracing and trace metadata/payloads |
| `src/eval/` | Scenario eval CLI, retrieval eval, LangSmith dataset push and experiments |
| `scripts/` | One-off scripts (e.g. `db-init`) |
| `drizzle/migrations/` | Generated SQL migrations |
