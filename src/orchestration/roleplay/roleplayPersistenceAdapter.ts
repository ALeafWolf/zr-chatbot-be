import type { ChatSession } from "../../db/schema/chat";
import type {
  GenerateAndValidateResult,
} from "../generation/generateAndValidate";
import type { DerivedState } from "../../state/sessionStateRepo";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { Thought } from "../thought/thoughtTypes";
import type { TurnRoute } from "../turn/turnRoutes";
import {
  ROLEPLAY_TURN_ROUTE,
  persistedRouteForRoleplayResult,
} from "../turn/turnRoutes";
import type {
  PersistCompletedTurnInput,
  PersistCompletedTurnResult,
} from "../persistence/turnPersistence";
import type { ModelBinding } from "../../config/models";
import type { TraceUsageInput } from "../../observability/traceMetadata";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistRoleplayTurnInput {
  session: ChatSession;
  userMessage: string;
  generationResult: GenerateAndValidateResult;
  derivedState: DerivedState;
  memories: RetrievedMemory[];
  thoughts: Thought[];
  generationModelBinding: ModelBinding;
  finalRecallTimedOut: boolean;
  /** Called with assistantMessageId when final recall wait timed out. */
  persistLateRecallThought?: (assistantMessageId: string) => void;
}

export interface PersistRoleplayTurnOutput {
  persistedRoute: TurnRoute;
  persisted: PersistCompletedTurnResult;
}

// Injectable dependency signatures
type TraceRouteSwitchFn = (input: {
  classifiedRoute: TurnRoute;
  persistedRoute?: TurnRoute;
}) => Promise<unknown>;

type EstimateModelCostFn = (
  binding: ModelBinding,
  usage: TraceUsageInput,
) => number | null;

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Persist the completed roleplay turn and wake the post-turn runner when a
 * background job was enqueued.
 *
 * Preserves the current order:
 *   persistedRoute ← wasDeflected
 *   tracedRouteSwitch(ROLEPLAY_TURN_ROUTE, persistedRoute)
 *   estimatedCostUsd ← estimateModelCost(generationModel, usage)
 *   persisted ← persistCompletedTurn(...)
 *   if finalRecallTimedOut → persistLateRecallThought(persisted.assistantMessageId)
 *   if persisted.jobId → wakePostTurnRunner()
 *   return { persistedRoute, persisted }
 *
 * The caller still owns final recall-thought wait/emission, final prose
 * replay, and the final `done` payload.
 */
export async function persistRoleplayTurn(
  input: PersistRoleplayTurnInput,
  deps?: {
    traceRouteSwitch?: TraceRouteSwitchFn;
    estimateModelCost?: EstimateModelCostFn;
    persistCompletedTurn?: (
      input: PersistCompletedTurnInput,
    ) => Promise<PersistCompletedTurnResult>;
    wakePostTurnRunner?: () => void;
  },
): Promise<PersistRoleplayTurnOutput> {
  const {
    session,
    userMessage,
    generationResult: result,
    derivedState,
    memories,
    thoughts,
    generationModelBinding,
    finalRecallTimedOut,
    persistLateRecallThought,
  } = input;

  const doRouteSwitch = deps?.traceRouteSwitch ?? defaultTraceRouteSwitch;
  const doCostEstimate = deps?.estimateModelCost ?? defaultEstimateModelCost;
  const doPersist = deps?.persistCompletedTurn ?? defaultPersistCompletedTurn;
  const doWake = deps?.wakePostTurnRunner ?? defaultWakePostTurnRunner;

  const persistedRoute = persistedRouteForRoleplayResult({
    wasDeflected: result.wasDeflected,
  });

  await doRouteSwitch({
    classifiedRoute: ROLEPLAY_TURN_ROUTE,
    persistedRoute,
  });

  const estimatedCostUsd = doCostEstimate(generationModelBinding, {
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  });

  const persisted = await doPersist({
    session,
    userMessage,
    assistantReply: result.content,
    validatorResult: result.validatorResult,
    route: persistedRoute,
    derivedState,
    memories,
    thoughts,
    usage: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      estimatedCostUsd,
    },
  });

  if (finalRecallTimedOut) {
    persistLateRecallThought?.(persisted.assistantMessageId);
  }

  if (persisted.jobId) {
    doWake();
  }

  return { persistedRoute, persisted };
}

// ---------------------------------------------------------------------------
// Default dependency implementations (production wiring)
// ---------------------------------------------------------------------------

async function defaultTraceRouteSwitch(_input: {
  classifiedRoute: TurnRoute;
  persistedRoute?: TurnRoute;
}): Promise<unknown> {
  // No-op by default — the real tracedRouteSwitch is injected from the caller.
  // This exists so tests can run without importing runCharacterTurn.ts.
  return undefined;
}

function defaultEstimateModelCost(
  _binding: ModelBinding,
  _usage: TraceUsageInput,
): number | null {
  return null;
}

async function defaultPersistCompletedTurn(
  _input: PersistCompletedTurnInput,
): Promise<PersistCompletedTurnResult> {
  throw new Error(
    "persistCompletedTurn is required — inject it via deps or wire production import",
  );
}

function defaultWakePostTurnRunner(): void {
  // No-op by default.
}
