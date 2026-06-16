import * as fs from "fs";
import * as path from "path";
import type { Scenario, ScenariosFile } from "./evalTypes";

export const EVAL_SCENARIOS_PATH = path.join(__dirname, "scenarios.json");
export const RERANK_SCENARIOS_PATH = path.join(
  __dirname,
  "datasets",
  "rerankScenarios.ts",
);

export const STUB_REPLY =
  "[STUB — full turn replay requires live DB + API keys]";

export type ScenarioSet = "default" | "rerank" | "probes" | "all";

export function loadScenariosFromFile(filePath: string = EVAL_SCENARIOS_PATH): {
  version: string;
  scenarios: Scenario[];
} {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as ScenariosFile;
  return { version: data.version, scenarios: data.scenarios };
}

/**
 * Load rerank scenarios from the rerank scenario library.
 * These are defined in a .ts file with a named export RERANK_EVAL_SCENARIOS.
 */
export function loadRerankScenarios(): Scenario[] {
  try {
    // Dynamic import of the TypeScript module
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./datasets/rerankScenarios");
    const scenarios: Scenario[] | undefined = mod.RERANK_EVAL_SCENARIOS;
    if (!Array.isArray(scenarios)) {
      console.warn("RERANK_EVAL_SCENARIOS export not found or not an array");
      return [];
    }
    return scenarios;
  } catch (err) {
    console.warn("Could not load rerank scenarios:", (err as Error).message);
    return [];
  }
}

/**
 * Load probe scenarios from the probe scenario library.
 */
export function loadProbeScenarios(): Scenario[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./datasets/probeScenarios");
    const scenarios: Scenario[] | undefined = mod.PROBE_EVAL_SCENARIOS;
    if (!Array.isArray(scenarios)) {
      console.warn("PROBE_EVAL_SCENARIOS export not found or not an array");
      return [];
    }
    return scenarios;
  } catch (err) {
    console.warn("Could not load probe scenarios:", (err as Error).message);
    return [];
  }
}

/**
 * Load scenarios based on EVAL_SCENARIO_SET.
 * - "default" (or unset): scenarios.json only
 * - "rerank": only rerank scenarios
 * - "probes": only probe scenarios
 * - "all": scenarios.json + rerank scenarios + probe scenarios
 */
export function loadScenariosBySet(
  set: ScenarioSet = "default",
): { version: string; scenarios: Scenario[] } {
  const { version, scenarios } = loadScenariosFromFile();

  if (set === "default") {
    return { version, scenarios };
  }

  if (set === "probes") {
    return { version, scenarios: loadProbeScenarios() };
  }

  const rerank = loadRerankScenarios();
  const probes = loadProbeScenarios();

  if (set === "rerank") {
    return { version, scenarios: rerank };
  }

  // "all"
  return { version, scenarios: [...scenarios, ...rerank, ...probes] };
}

export function scenarioToEvalInputs(scenario: Scenario): Record<string, unknown> {
  return {
    scenario_id: scenario.id,
    description: scenario.description,
    session: scenario.session,
    ...(scenario.group !== undefined && { group: scenario.group }),
    ...(scenario.eval_mode !== undefined && { eval_mode: scenario.eval_mode }),
    ...(scenario.messages !== undefined && { messages: scenario.messages }),
    ...(scenario.primed_memories !== undefined && {
      primed_memories: scenario.primed_memories,
    }),
    ...(scenario.sessionSeed !== undefined && { sessionSeed: scenario.sessionSeed }),
    ...(scenario.recentMessages !== undefined && {
      recentMessages: scenario.recentMessages,
    }),
    ...(scenario.sessionSummary !== undefined && {
      sessionSummary: scenario.sessionSummary,
    }),
    ...(scenario.sessionState !== undefined && { sessionState: scenario.sessionState }),
    ...(scenario.seedAxisState !== undefined && { seedAxisState: scenario.seedAxisState }),
    ...(scenario.durableMemories !== undefined && {
      durableMemories: scenario.durableMemories,
    }),
    ...(scenario.sessionChunks !== undefined && {
      sessionChunks: scenario.sessionChunks,
    }),
    ...(scenario.structMemEntries !== undefined && {
      structMemEntries: scenario.structMemEntries,
    }),
    ...(scenario.structMemConsolidations !== undefined && {
      structMemConsolidations: scenario.structMemConsolidations,
    }),
    ...(scenario.canonReferenceIds !== undefined && {
      canonReferenceIds: scenario.canonReferenceIds,
    }),
    ...(scenario.configOverrides !== undefined && {
      configOverrides: scenario.configOverrides,
    }),
    ...(scenario.input_draft !== undefined && { input_draft: scenario.input_draft }),
    ...(scenario.validator_retrieved_canon !== undefined && {
      validator_retrieved_canon: scenario.validator_retrieved_canon,
    }),
    ...(scenario.retrieval_expected_needle !== undefined && {
      retrieval_expected_needle: scenario.retrieval_expected_needle,
    }),
  };
}
