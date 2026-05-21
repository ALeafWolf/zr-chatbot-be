/**
 * Phase 1 Dev Script — invoke the one-node turn graph directly.
 *
 * Usage:
 *   npx tsx scripts/dev-run-turn-graph.ts --sessionId <id> --userMessage <msg>
 *
 * Requires a local DB and LLM provider configuration to produce a real
 * `runCharacterTurn(...)` result.  No production HTTP route is touched.
 *
 * Example:
 *   npx tsx scripts/dev-run-turn-graph.ts \
 *     --sessionId 0195a0b0-... \
 *     --userMessage "Hey, how are you?"
 */

function printUsage() {
  console.log(`
Usage:
  npx tsx scripts/dev-run-turn-graph.ts --sessionId <id> --userMessage <msg>

Options:
  --sessionId     (required) A valid session UUID from the chat_sessions table.
  --userMessage   (required) The user message text to send.

Requires a running database and configured LLM providers.
`);
}

async function main() {
  const args = process.argv.slice(2);

  const sessionIdIdx = args.indexOf("--sessionId");
  const userMessageIdx = args.indexOf("--userMessage");

  if (sessionIdIdx === -1 || userMessageIdx === -1) {
    printUsage();
    process.exit(1);
  }

  const sessionId = args[sessionIdIdx + 1];
  const userMessage = args[userMessageIdx + 1];

  if (!sessionId || !userMessage) {
    printUsage();
    process.exit(1);
  }

  console.log(" Invoking turnGraph...");
  console.log("  sessionId  :", sessionId);
  console.log("  userMessage:", userMessage);
  console.log();

  // Deferred import: don't load the production stack until args are valid.
  const { turnGraph } = await import("../src/orchestration/graphs/turnGraph");

  const start = performance.now();
  const state = await turnGraph.invoke({ sessionId, userMessage });
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  if (state.errors && state.errors.length > 0) {
    console.error(" Turn graph completed with errors:");
    for (const err of state.errors) {
      console.error(`  [${err.stage}] ${err.message}`);
    }
    process.exit(1);
  }

  if (!state.result) {
    console.error(" Turn graph returned no result and no errors (unexpected).");
    process.exit(1);
  }

  console.log(` Turn graph completed in ${elapsed}s`);
  console.log("  assistantMessageId:", state.result.assistantMessageId);
  console.log("  content preview   :", state.result.content.slice(0, 120) + (state.result.content.length > 120 ? "..." : ""));
  console.log("  turnIndex         :", state.result.turnIndex);
  console.log("  route             :", state.result.route);
  console.log("  wasRewritten      :", state.result.wasRewritten);
  console.log("  wasDeflected      :", state.result.wasDeflected);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
