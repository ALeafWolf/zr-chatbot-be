/**
 * TG3 Dev Script — invoke the StructMem consolidation graph directly.
 *
 * Usage:
 *   npx tsx scripts/dev-run-structmem-consolidation-graph.ts --jobId <id>
 *
 * Requires a local DB with a running structmem_consolidation_jobs row.
 * No production route is touched.
 */

function printUsage() {
  console.log(`
Usage:
  npx tsx scripts/dev-run-structmem-consolidation-graph.ts --jobId <id>

Options:
  --jobId   (required) A valid structmem_consolidation_jobs UUID.

Requires a running database.
`);
}

async function main() {
  const args = process.argv.slice(2);
  const jobIdIdx = args.indexOf("--jobId");

  if (jobIdIdx === -1) { printUsage(); process.exit(1); }

  const jobId = args[jobIdIdx + 1];
  if (!jobId) { printUsage(); process.exit(1); }

  console.log(" Invoking structMemConsolidationGraph...");
  console.log("  jobId:", jobId);
  console.log();

  const { getStructMemConsolidationGraph } =
    await import("../src/orchestration/graphs/structMemConsolidationGraph");
  const { loadConsolidationJobById } =
    await import("../src/memory/structmem/structmemConsolidationRepo");

  const job = await loadConsolidationJobById(jobId);
  if (!job) {
    console.error(` StructMem consolidation job not found: ${jobId}`);
    process.exit(1);
  }

  console.log("  status         :", job.status);
  console.log("  sessionId      :", job.sessionId);
  console.log("  attemptCount   :", job.attemptCount);
  console.log("  maxAttempts    :", job.maxAttempts);
  console.log("  turnStart      :", job.turnStart);
  console.log("  turnEnd        :", job.turnEnd);
  console.log();

  const graph = getStructMemConsolidationGraph();

  const start = performance.now();
  const state = await graph.invoke(
    { jobId },
    {
      tags: ["turn:background", "subsystem:structmem", "graph:structMemConsolidationGraph"],
      metadata: {
        structmemConsolidationJobId: jobId,
        sessionId: job.sessionId,
        characterId: job.characterId,
        memoryNamespace: job.memoryNamespace,
        turnStart: job.turnStart,
        turnEnd: job.turnEnd,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
      },
    },
  );
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  if (state.errors && state.errors.length > 0) {
    console.error("  Graph completed with errors:");
    for (const err of state.errors) {
      console.error("   ", err.stage, "-", err.message);
    }
    if (state.failureReason) {
      console.error("  failureReason:", state.failureReason);
    }
    process.exit(1);
  }

  console.log(` Graph completed in ${elapsed}s`);
  console.log("  finalStatus      :", state.finalStatus);
  console.log("  skippedReason    :", state.skippedReason ?? "(none)");
  console.log("  bufferCount      :", state.bufferCount ?? 0);
  console.log("  semanticSeedCount:", state.semanticSeedCount ?? 0);
  console.log("  synthesisTokens  :", state.synthesisTokenCount ?? "(unknown)");
  console.log("  consolidationId  :", state.currentConsolidationId ?? "(none)");
  console.log("  crossSessionIds  :", state.crossSessionIds?.join(", ") ?? "(none)");
  console.log("  failureReason    :", state.failureReason ?? "(none)");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
