# DB Deprecation Audit

Date: 2026-05-14

This audit documents cleanup candidates only. No tables are dropped in this pass.

## Local Row Counts

Captured from `postgres://postgres:***@localhost:5432/zuoran-memory` during the backend tidy-up:

| Table | Rows | Code usage |
| --- | ---: | --- |
| `session_archive` | 3 | Schema/type only; no runtime reads or writes found. |
| `player_profile` | 0 | `playerProfileRepo.ts` exists, but no imports of its exported functions were found. |
| `character_profiles` | 1 | Used by `listCharacters`; runtime persona/default prompting still comes from YAML. |
| `persona_overlays` | 6 | DB repository helpers exist, but runtime overlay loading still comes from YAML. |
| `interactive_memory_events` | 284 | Active write/retrieval path. |
| `session_summaries` | 2 | Active summary path. |
| `session_memory_chunks` | 331 | Active session recall path. |
| `post_turn_jobs` | 49 | Active background job path. |

## Deprecation Candidates

- `session_archive`: keep for now, but treat as deprecated until a restore/export workflow proves it is needed.
- `player_profile`: keep table for now, but treat repo code as deprecated because no runtime caller exists and the local table is empty.
- `character_profiles` and `persona_overlays`: decide whether these are admin-config tables or legacy mirrors. Current runtime source of truth for character defaults and overlays is YAML under `src/character/defaults` and `src/character/overlays`.

## Follow-Up Before Dropping Anything

- Re-run row counts in the target environment.
- Confirm backup coverage for any table with rows.
- Add reversible Drizzle migrations only after the product decision is made.
- Keep canon tables out of chatbot-owned migrations; they remain owned by the ingest/script-extractor pipeline.
