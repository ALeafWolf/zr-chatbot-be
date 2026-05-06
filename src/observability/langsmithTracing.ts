import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
import { env } from "../config/env";

// Configure LangSmith project (the SDK reads LANGSMITH_* env vars automatically)
// We just need LANGSMITH_TRACING, LANGSMITH_API_KEY, and LANGSMITH_PROJECT set.

export { traceable };

/**
 * Wrap a pipeline function with a LangSmith trace span.
 * When LANGSMITH_TRACING=false the SDK auto-disables; this is a no-op wrapper.
 *
 * Usage:
 *   const traced = traceStage("retrieval.interactive_memories", myFn);
 *   const result = await traced(input, { sessionId, mode });
 */
export function traceStage<TInput extends unknown[], TOutput>(
  name: string,
  fn: (...args: TInput) => Promise<TOutput>,
  metadata?: Record<string, unknown>,
): (...args: TInput) => Promise<TOutput> {
  return traceable(fn, {
    name,
    run_type: "chain",
    project_name: env.LANGSMITH_PROJECT,
    tags: ["phase1", ...(metadata?.tags as string[] ?? [])],
    metadata: metadata ?? {},
  }) as unknown as (...args: TInput) => Promise<TOutput>;
}

/**
 * Convenience wrapper for an LLM generation span.
 */
export function traceLLMStage<TInput extends unknown[], TOutput>(
  name: string,
  fn: (...args: TInput) => Promise<TOutput>,
  metadata?: Record<string, unknown>,
): (...args: TInput) => Promise<TOutput> {
  return traceable(fn, {
    name,
    run_type: "llm",
    project_name: env.LANGSMITH_PROJECT,
    tags: ["phase1", "llm", ...(metadata?.tags as string[] ?? [])],
    metadata: metadata ?? {},
  }) as unknown as (...args: TInput) => Promise<TOutput>;
}

/** LangSmith tracing for streaming LLM steps (async generator). */
export function traceStreamingLLM<
  TInput extends unknown[],
  TYield,
  TReturn,
  TNext,
>(
  name: string,
  fn: (...args: TInput) => AsyncGenerator<TYield, TReturn, TNext>,
  metadata?: Record<string, unknown>,
): (...args: TInput) => AsyncGenerator<TYield, TReturn, TNext> {
  return traceable(fn, {
    name,
    run_type: "llm",
    project_name: env.LANGSMITH_PROJECT,
    tags: ["phase1", "llm", "stream", ...(metadata?.tags as string[] ?? [])],
    metadata: metadata ?? {},
  }) as unknown as (...args: TInput) => AsyncGenerator<TYield, TReturn, TNext>;
}

export { wrapOpenAI };
