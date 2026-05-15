import { AsyncLocalStorage } from "node:async_hooks";
import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
import type { ModelBinding } from "../config/models";
import { env } from "../config/env";
import {
  buildLlmTraceMetadata,
  getAttachedTraceLlmMetadata,
  type TraceLlmMetadata,
  type TraceModelRole,
  type TraceUsageInput,
} from "./traceMetadata";
import {
  characterTag,
  environmentTag,
  evalTag,
  inferTraceSubsystem,
  sanitizeTraceTags,
  subsystemTag,
  turnTag,
  type TraceSubsystem,
  type TraceTurn,
} from "./traceTags";

// Configure LangSmith project (the SDK reads LANGSMITH_* env vars automatically).
export { traceable };

export interface TraceRuntimeContext {
  baseMetadata?: Record<string, unknown>;
  characterId?: string;
  turn?: TraceTurn;
  eval?: boolean;
  tags?: string[];
}

type TraceProcessInputs = (
  inputs: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;

type TraceProcessOutputs = (
  outputs: Readonly<Record<string, unknown>>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export interface TraceWrapperOptions {
  tags?: string[];
  metadata?: Record<string, unknown>;
  subsystem?: TraceSubsystem;
  turn?: TraceTurn;
  root?: boolean;
  includeEnvironmentTag?: boolean;
  eval?: boolean;
  llm?: {
    binding: ModelBinding;
    modelRole?: TraceModelRole;
  };
  getUsage?: (outputs: unknown) => TraceUsageInput | undefined;
  processInputs?: TraceProcessInputs;
  processOutputs?: TraceProcessOutputs;
}

const traceContextStorage = new AsyncLocalStorage<TraceRuntimeContext>();

export function getTraceContext(): TraceRuntimeContext | undefined {
  return traceContextStorage.getStore();
}

export async function withTraceContext<T>(
  context: TraceRuntimeContext,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = traceContextStorage.getStore();
  const merged = mergeTraceContext(parent, context);
  return await traceContextStorage.run(merged, fn);
}

function mergeTraceContext(
  parent: TraceRuntimeContext | undefined,
  child: TraceRuntimeContext,
): TraceRuntimeContext {
  return {
    ...parent,
    ...child,
    baseMetadata: {
      ...(parent?.baseMetadata ?? {}),
      ...(child.baseMetadata ?? {}),
    },
    tags: sanitizeTraceTags([...(parent?.tags ?? []), ...(child.tags ?? [])]),
  };
}

function normalizeOptions(
  options?: Record<string, unknown> | TraceWrapperOptions,
): TraceWrapperOptions {
  if (!options) return {};
  const {
    tags,
    metadata,
    subsystem,
    turn,
    root,
    includeEnvironmentTag,
    eval: evalRun,
    llm,
    getUsage,
    processInputs,
    processOutputs,
    ...legacyMetadata
  } = options as TraceWrapperOptions & Record<string, unknown>;
  return {
    tags: Array.isArray(tags) ? tags : undefined,
    metadata: {
      ...(metadata ?? {}),
      ...legacyMetadata,
    },
    subsystem,
    turn,
    root,
    includeEnvironmentTag,
    eval: evalRun,
    llm,
    getUsage,
    processInputs,
    processOutputs,
  };
}

function buildTags(name: string, opts: TraceWrapperOptions): string[] {
  const context = getTraceContext();
  const metadata = {
    ...(context?.baseMetadata ?? {}),
    ...(opts.metadata ?? {}),
  };
  const characterId =
    typeof metadata.characterId === "string"
      ? metadata.characterId
      : context?.characterId;
  const turn = opts.turn ?? context?.turn;
  const subsystem = opts.subsystem ?? inferTraceSubsystem(name);
  const includeEnvironment = opts.includeEnvironmentTag === true || opts.root === true;
  const environment =
    typeof metadata.environment === "string"
      ? metadata.environment
      : env.TRACE_ENVIRONMENT;
  return sanitizeTraceTags([
    ...(includeEnvironment ? [environmentTag(environment)] : []),
    ...(characterId ? [characterTag(characterId)] : []),
    ...(opts.root ? [] : turn ? [turnTag(turn)] : []),
    subsystemTag(subsystem),
    ...evalTag(Boolean(opts.eval ?? context?.eval)),
    ...(context?.tags ?? []),
    ...(opts.tags ?? []),
  ]);
}

function buildMetadata(
  opts: TraceWrapperOptions,
): Record<string, unknown> {
  const context = getTraceContext();
  return {
    ...scrubTraceMetadata(context?.baseMetadata ?? {}),
    ...scrubTraceMetadata(opts.metadata ?? {}),
    ...(opts.llm
      ? buildLlmTraceMetadata({
          binding: opts.llm.binding,
          modelRole: opts.llm.modelRole,
        })
      : {}),
  };
}

function scrubTraceMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const { playerId: _playerId, tags: _tags, ...safeMetadata } = metadata;
  return safeMetadata;
}

function extractLlmMetadata(
  outputs: unknown,
  opts: TraceWrapperOptions,
): TraceLlmMetadata | undefined {
  const attached = getAttachedTraceLlmMetadata(outputs);
  if (attached) return attached;
  const usage = opts.getUsage?.(outputs) ?? usageFromOutputShape(outputs);
  if (!usage || !opts.llm) return undefined;
  return buildLlmTraceMetadata({
    binding: opts.llm.binding,
    modelRole: opts.llm.modelRole,
    usage,
  });
}

function usageFromOutputShape(outputs: unknown): TraceUsageInput | undefined {
  if (!outputs || typeof outputs !== "object") return undefined;
  const rec = outputs as Record<string, unknown>;
  const inputTokens = rec.inputTokens;
  const outputTokens = rec.outputTokens;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return undefined;
  }
  return { inputTokens, outputTokens };
}

function withLlmOutputMetadata(
  processed: Record<string, unknown>,
  llmMetadata: TraceLlmMetadata | undefined,
): Record<string, unknown> {
  if (!llmMetadata?.usage_metadata) return processed;
  return {
    ...processed,
    inputTokens: llmMetadata.inputTokens,
    outputTokens: llmMetadata.outputTokens,
    totalTokens: llmMetadata.totalTokens,
    estimatedCostUsd: llmMetadata.estimatedCostUsd,
    pricingKnown: llmMetadata.pricingKnown,
    pricingVersion: llmMetadata.pricingVersion,
    usage_metadata: llmMetadata.usage_metadata,
  };
}

function buildProcessOutputs(
  opts: TraceWrapperOptions,
): TraceProcessOutputs | undefined {
  if (!opts.processOutputs && !opts.llm) return undefined;
  return async (outputs: Readonly<Record<string, unknown>>) => {
    const llmMetadata = extractLlmMetadata(outputs, opts);
    const processed = opts.processOutputs
      ? await opts.processOutputs(outputs)
      : outputs;
    return withLlmOutputMetadata(
      processed as Record<string, unknown>,
      llmMetadata,
    );
  };
}

function traceConfig(
  name: string,
  runType: "chain" | "llm",
  opts: TraceWrapperOptions,
) {
  return {
    name,
    run_type: runType,
    project_name: env.LANGSMITH_PROJECT,
    tags: buildTags(name, opts),
    metadata: buildMetadata(opts),
    processInputs: opts.processInputs as
      | ((inputs: Readonly<unknown>) => Record<string, unknown>)
      | undefined,
    processOutputs: buildProcessOutputs(opts) as
      | ((outputs: Readonly<unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>)
      | undefined,
  };
}

export function traceStage<TInput extends unknown[], TOutput>(
  name: string,
  fn: (...args: TInput) => Promise<TOutput>,
  options?: Record<string, unknown> | TraceWrapperOptions,
): (...args: TInput) => Promise<TOutput> {
  return async (...args: TInput) => {
    const opts = normalizeOptions(options);
    const traced = traceable(fn, traceConfig(name, "chain", opts)) as unknown as (
      ...innerArgs: TInput
    ) => Promise<TOutput>;
    return await traced(...args);
  };
}

export function traceStageWithIO<TInput extends unknown[], TOutput>(
  name: string,
  fn: (...args: TInput) => Promise<TOutput>,
  opts?: TraceWrapperOptions,
): (...args: TInput) => Promise<TOutput> {
  return traceStage(name, fn, opts);
}

export function traceLLMStage<TInput extends unknown[], TOutput>(
  name: string,
  fn: (...args: TInput) => Promise<TOutput>,
  options?: Record<string, unknown> | TraceWrapperOptions,
): (...args: TInput) => Promise<TOutput> {
  return async (...args: TInput) => {
    const opts = normalizeOptions(options);
    const traced = traceable(fn, traceConfig(name, "llm", opts)) as unknown as (
      ...innerArgs: TInput
    ) => Promise<TOutput>;
    return await traced(...args);
  };
}

export function traceStreamingLLM<
  TInput extends unknown[],
  TYield,
  TReturn,
  TNext,
>(
  name: string,
  fn: (...args: TInput) => AsyncGenerator<TYield, TReturn, TNext>,
  options?: Record<string, unknown> | TraceWrapperOptions,
): (...args: TInput) => AsyncGenerator<TYield, TReturn, TNext> {
  return (...args: TInput) => {
    const opts = normalizeOptions(options);
    const traced = traceable(fn, {
      ...traceConfig(name, "llm", opts),
      aggregator: (chunks: TYield[]) => {
        const done = [...chunks].reverse().find((chunk) => {
          return (
            chunk &&
            typeof chunk === "object" &&
            (chunk as Record<string, unknown>).type === "done"
          );
        });
        return done ?? { eventCount: chunks.length };
      },
    }) as unknown as (...innerArgs: TInput) => AsyncGenerator<TYield, TReturn, TNext>;
    return traced(...args) as AsyncGenerator<TYield, TReturn, TNext>;
  };
}

export const __testing = {
  buildTags,
  buildMetadata,
  withLlmOutputMetadata,
};

export { wrapOpenAI };
