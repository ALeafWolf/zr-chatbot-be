/**
 * Pure CLI argument/validation helpers for runAgentEvalCli.
 *
 * This module has NO import of live agent eval code, making it safe to import
 * in unit tests without triggering model calls or LangSmith API usage.
 */
import {
  loadScenariosBySet,
  type ScenarioSet,
} from "./loadEvalScenarios";

/**
 * Resolve the EVAL_SCENARIO_SET env var to a ScenarioSet value.
 */
export function resolveScenarioSet(): ScenarioSet {
  const val = (process.env.EVAL_SCENARIO_SET ?? "default").trim().toLowerCase();
  if (val === "rerank" || val === "probes" || val === "emotional_axis" || val === "all") return val;
  return "default";
}

/**
 * Find a scenario by id in the given scenario set and convert it to the raw
 * input shape expected by `runAgentEval`. Returns null when the id is not found.
 *
 * Does NOT default `eval_mode` — the scenario's actual value (or undefined) is
 * preserved so callers can reject non-agent_turn scenarios.
 */
export function findScenarioForAgentEval(
  id: string,
  set: ScenarioSet,
): Record<string, unknown> | null {
  const { scenarios } = loadScenariosBySet(set);
  const match = scenarios.find((s) => s.id === id);
  if (!match) return null;

  const input: Record<string, unknown> = {
    scenario_id: match.id,
    description: match.description,
    session: match.session,
  };

  if (match.eval_mode !== undefined) {
    input.eval_mode = match.eval_mode;
  }
  if (match.messages) input.messages = match.messages;
  if (match.primed_memories) input.primed_memories = match.primed_memories;
  if (match.sessionSeed) input.sessionSeed = match.sessionSeed;
  if (match.recentMessages) input.recentMessages = match.recentMessages;
  if (match.sessionSummary) input.sessionSummary = match.sessionSummary;
  if (match.sessionState) input.sessionState = match.sessionState;
  if (match.seedAxisState) input.seedAxisState = match.seedAxisState;
  if (match.durableMemories) input.durableMemories = match.durableMemories;
  if (match.sessionChunks) input.sessionChunks = match.sessionChunks;
  if (match.structMemEntries) input.structMemEntries = match.structMemEntries;
  if (match.structMemConsolidations)
    input.structMemConsolidations = match.structMemConsolidations;
  if (match.canonReferenceIds) input.canonReferenceIds = match.canonReferenceIds;
  if (match.configOverrides) input.configOverrides = match.configOverrides;

  return input;
}

export type CliValidationResult =
  | { ok: true; input: Record<string, unknown>; scenarioId: string }
  | { ok: false; error: string; exitCode: number };

/**
 * Validate CLI arguments and scenario selection without importing live eval code.
 *
 * Returns a `CliValidationResult`:
 * - `{ ok: true, input, scenarioId }` when validation passes.
 * - `{ ok: false, error, exitCode }` with a user-facing error message and
 *   exit code when validation fails.
 */
export function validateCliArgs(
  scenarioId: string | undefined,
  scenarioSet: ScenarioSet,
): CliValidationResult {
  if (!scenarioId) {
    return {
      ok: false,
      error: [
        "Usage: npx tsx src/eval/runAgentEvalCli.ts --scenario <id>",
        "  EVAL_SCENARIO_SET=rerank|all  load rerank scenarios",
      ].join("\n"),
      exitCode: 1,
    };
  }

  const input = findScenarioForAgentEval(scenarioId, scenarioSet);

  if (!input) {
    return {
      ok: false,
      error: `Scenario "${scenarioId}" not found in set "${scenarioSet}".`,
      exitCode: 1,
    };
  }

  const evalMode = input.eval_mode as string | undefined;
  if (evalMode !== "agent_turn") {
    return {
      ok: false,
      error: `Scenario "${scenarioId}" has eval_mode="${evalMode ?? "(omitted)"}". Only "agent_turn" is supported.`,
      exitCode: 1,
    };
  }

  return { ok: true, input, scenarioId };
}
