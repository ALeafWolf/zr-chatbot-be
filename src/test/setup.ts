/**
 * Preloaded before unit tests via `tsx --import ./src/test/setup.ts`.
 * Forces LangSmith off before env.ts / langsmith modules load.
 */
import { mock } from "node:test";

process.env.NODE_ENV ??= "test";

for (const key of [
  "LANGSMITH_TRACING",
  "LANGSMITH_TRACING_V2",
  "LANGCHAIN_TRACING",
  "LANGCHAIN_TRACING_V2",
  "TRACING",
  "TRACING_V2",
]) {
  process.env[key] = "false";
}

for (const key of ["LANGSMITH_API_KEY", "LANGCHAIN_API_KEY"]) {
  process.env[key] = "";
}

process.env.LANGSMITH_TRACING_BACKGROUND = "false";
process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false";

mock.module("langsmith/traceable", {
  namedExports: {
    traceable: <T>(fn: T): T => fn,
  },
});
