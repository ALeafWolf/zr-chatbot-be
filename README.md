# Chatbot backend

Fastify 5 HTTP API for the Zuoran character chat bot. TypeScript, Drizzle ORM, PostgreSQL with `pgvector`, multi-provider LLM routing (Anthropic / OpenAI / DeepSeek).

The backend reads canon data from the Postgresql database. Chat-owned tables — sessions, messages, memory embeddings, persona overlays — are defined here and migrated with Drizzle.

## Prerequisites

- Node.js 20+
- PostgreSQL with `CREATE EXTENSION IF NOT EXISTS vector;`
- Existing `zuoran` database populated with canon via the ingest pipeline
- Provider API keys: OpenAI (embeddings), Anthropic (generation + validation), DeepSeek (post-turn extraction)

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

Health check:

```bash
curl http://localhost:4000/health
```

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Hot reload: `tsx watch` on `src/server.ts` and `src/**/*.yaml` (character/overlays). Use this for local API work — not `start`. |
| `npm run build` | Bundle to `dist/` with `tsup` |
| `npm run start` | Run `dist/server.js` (after `build`; no file watcher) |
| `npm run db:generate` | Generate Drizzle migrations from schema |
| `npm run db:migrate` | Apply migrations via Drizzle Kit |
| `npm run db:init` | Apply `drizzle/migrations/0000_init.sql` directly with `pg` (alternative path) |
| `npm run eval` | Local regression eval from `scenarios.json` |
| `npm run eval:dataset:push` | Replace LangSmith dataset from scenarios |
| `npm run eval:langsmith` | Run LangSmith experiment on that dataset |

## Environment variables

Validation is enforced in `src/config/env.ts`. Required vs optional summary:

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | yes | — | Same DB as scene ingestor |
| `OPENAI_API_KEY` | yes | — | Embeddings |
| `ANTHROPIC_API_KEY` | yes | — | Generation + validation |
| `DEEPSEEK_API_KEY` | yes | — | Post-turn extractor |
| `GENERATION_MODEL` | no | `anthropic:claude-sonnet-4-5` | `provider:model` |
| `VALIDATOR_MODEL` | no | `anthropic:claude-haiku-4-5` | |
| `EXTRACTOR_MODEL` | no | `deepseek:deepseek-chat` | |
| `EMBEDDING_MODEL` | no | `openai:text-embedding-3-small` | |
| `EMBEDDING_DIMENSIONS` | no | `1536` | |
| `LANGSMITH_TRACING` | no | `false` | Set `true` to trace |
| `LANGSMITH_API_KEY` | if tracing / eval push | — | Required for LangSmith CLI flows that call the API |
| `LANGSMITH_PROJECT` | no | `zuoran-chatbot-phase1` | |
| `LANGSMITH_ENDPOINT` | no | `https://api.smith.langchain.com` | |
| `LANGSMITH_EVAL_DATASET` | no | `zuoran-phase1-eval` | Dataset name for push + experiment |
| `PORT` | no | `4000` | |
| `FRONTEND_ORIGIN` | no | `http://localhost:5173` | CORS origin |
| `DEFAULT_PLAYER_ID` | no | `local_dev` | Phase 1 single-player stub |
| `DEFAULT_CHARACTER_ID` | no | `zou_ran` | |

See `.env.example` for a copy-paste template.

## HTTP API (summary)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/characters` | List characters |
| `GET` | `/api/scopes` | List main-world continuity scopes |
| `GET` | `/api/modes` | List session modes |
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Session + messages |
| `POST` | `/api/sessions/:id/messages` | User message → full character turn |
| `DELETE` | `/api/sessions/:id` | Soft-delete session |
| `GET` | `/health` | Liveness |

Example create session JSON:

```json
{
  "character_id": "zou_ran",
  "mode": "canonical_live",
  "continuity_scope": "main_married",
  "pinned_time": null,
  "pinned_location": null
}
```

Example send message JSON: `{ "content": "你好。" }`.

## Drizzle schema

`drizzle.config.ts` only includes chatbot-owned schema files (`src/db/schema/chat.ts`, `memory.ts`, `persona.ts`). Canon tables remain owned by script-extractor; do not regenerate migrations that alter those definitions from this package.

## LangSmith tracing

When `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY` is set, the pipeline emits named spans (orchestration, retrieval, LLM stages). Detail list lives in [../README.md](../README.md#langsmith-tracing).

## Regression eval

- **`npm run eval`** — Loads scenarios from the eval scenarios file; for rows with `input_draft`, runs the response validator only; stub path skips full LLM replay without a wired turn runner.

  ```bash
  npx tsx src/eval/runEval.ts --scenario no_ai_claim
  ```

- **`npm run eval:dataset:push`** — Requires `LANGSMITH_API_KEY`. Pushes scenarios to LangSmith dataset `LANGSMITH_EVAL_DATASET` (replacing examples in that dataset).

- **`npm run eval:langsmith`** — Runs a LangSmith experiment on that dataset after push.

## Source layout (orientation)

| Path | Role |
|------|------|
| `src/server.ts` | Fastify bootstrap, routes |
| `src/api/` | Session + chat controllers |
| `src/orchestration/` | Turn pipeline (`runCharacterTurn`, prompt context, validation loop) |
| `src/llm/` | Providers, generation, embeddings, validator, post-turn extractor |
| `src/retrieval/` | Canon + interactive memory + recent turns |
| `src/memory/` | Write path, summarization, dedupe, importance |
| `src/character/` | Profiles, persona overlays, YAML-backed defaults |
| `src/db/` | Pool client + Drizzle schemas |
| `src/jobs/` | Background post-turn work (drained on SIGINT/SIGTERM) |
| `src/observability/` | LangSmith client wiring |
| `src/eval/` | Scenario eval CLI + LangSmith integration |
| `scripts/` | One-off scripts (e.g. `db-init`) |
| `drizzle/migrations/` | Generated SQL migrations |
