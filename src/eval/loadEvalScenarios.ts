import * as fs from "fs";
import * as path from "path";
import type { Scenario, ScenariosFile } from "./evalTypes";

export const EVAL_SCENARIOS_PATH = path.join(__dirname, "scenarios.json");

export const STUB_REPLY =
  "[STUB — full turn replay requires live DB + API keys]";

export function loadScenariosFromFile(filePath: string = EVAL_SCENARIOS_PATH): {
  version: string;
  scenarios: Scenario[];
} {
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw) as ScenariosFile;
  return { version: data.version, scenarios: data.scenarios };
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
    ...(scenario.input_draft !== undefined && { input_draft: scenario.input_draft }),
    ...(scenario.validator_retrieved_canon !== undefined && {
      validator_retrieved_canon: scenario.validator_retrieved_canon,
    }),
    ...(scenario.retrieval_expected_needle !== undefined && {
      retrieval_expected_needle: scenario.retrieval_expected_needle,
    }),
  };
}
