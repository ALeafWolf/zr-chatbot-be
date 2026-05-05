/**
 * Push scenarios.json to a LangSmith dataset (kv). Replaces existing examples
 * in the dataset with the same name (delete all, then bulk create).
 *
 * Usage:
 *   npx tsx src/eval/pushLangSmithDataset.ts
 *
 * Requires LANGSMITH_API_KEY and uses LANGSMITH_EVAL_DATASET / LANGSMITH_ENDPOINT.
 */
import { Client } from "langsmith";
import type { ExampleCreate } from "langsmith/schemas";
import { env } from "../config/env";
import { flushLangSmithClient } from "./evalProcessDrain";
import { loadScenariosFromFile, scenarioToEvalInputs } from "./loadEvalScenarios";

function requireLangSmithKey(): void {
  if (!env.LANGSMITH_API_KEY?.trim()) {
    console.error("LANGSMITH_API_KEY is required to push a dataset.");
    throw new Error("Missing LANGSMITH_API_KEY");
  }
}

async function clearDatasetExamples(
  client: Client,
  datasetName: string,
): Promise<void> {
  const ids: string[] = [];
  for await (const ex of client.listExamples({ datasetName })) {
    ids.push(ex.id);
  }
  if (ids.length === 0) return;
  const chunk = 500;
  for (let i = 0; i < ids.length; i += chunk) {
    await client.deleteExamples(ids.slice(i, i + chunk));
  }
}

async function main(): Promise<void> {
  requireLangSmithKey();

  const client = new Client({
    apiKey: env.LANGSMITH_API_KEY,
    apiUrl: env.LANGSMITH_ENDPOINT,
  });

  try {
    const datasetName = env.LANGSMITH_EVAL_DATASET;
    const { version, scenarios } = loadScenariosFromFile();

    let dataset = await client.readDataset({ datasetName }).catch(() => null);
    if (!dataset) {
      dataset = await client.createDataset(datasetName, {
        description: `Zuoran Phase 1 regression eval (scenarios v${version})`,
        dataType: "kv",
      });
    }

    await clearDatasetExamples(client, datasetName);

    const uploads: ExampleCreate[] = scenarios.map((scenario) => ({
      dataset_id: dataset.id,
      inputs: scenarioToEvalInputs(scenario),
      metadata: {
        assertions: scenario.assertions,
        scenarios_file_version: version,
      },
    }));

    await client.createExamples(uploads);

    const url = await client.getDatasetUrl({ datasetId: dataset.id });
    console.log(
      `Uploaded ${uploads.length} examples to dataset "${datasetName}" (${dataset.id}).`,
    );
    console.log(url);
  } finally {
    await flushLangSmithClient(client);
  }
}

main().catch((err) => {
  console.error("pushLangSmithDataset error:", err);
  process.exitCode = 1;
});
