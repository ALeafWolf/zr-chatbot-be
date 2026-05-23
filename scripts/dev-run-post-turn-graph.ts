/**
 * TG1 Dev Script — invoke the post-turn memory graph directly.
 *
 * Usage:
 *   npx tsx scripts/dev-run-post-turn-graph.ts --jobId <id>
 *
 * Requires a local DB with a pending post_turn_jobs row. No production
 * HTTP route is touched.
 *
 * Example:
 *   npx tsx scripts/dev-run-post-turn-graph.ts --jobId 0195a0b0-...
 */

function printUsage() {
  console.log([
    "Usage:",
    "  npx tsx scripts/dev-run-post-turn-graph.ts --jobId <id>",
    "",
    "Options:",
    "  --jobId     (required) A valid post_turn_job id with status 'pending' or 'retry'.",
    "",
    "Requires a running database and configured LLM providers.",
  ].join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  const jobIdIdx = args.indexOf('--jobId');

  if (jobIdIdx === -1) {
    printUsage();
    process.exit(1);
  }

  const jobId = args[jobIdIdx + 1];
  if (!jobId) {
    printUsage();
    process.exit(1);
  }

  console.log(' Invoking postTurnMemoryGraph...');
  console.log('  jobId:', jobId);
  console.log();

  // Deferred import: don't load the production stack until args are valid.
  const { db } = await import('../src/db/client');
  const { postTurnJobs } = await import('../src/db/schema/jobs');
  const { eq } = await import('drizzle-orm');
  const { parsePostTurnJobPayload, normalizeStepStatus, chatSessionFromSnapshot } = await import('../src/jobs/postTurnJobPayload');
  const { defaultPostTurnMemoryGraphDeps, createPostTurnMemoryGraph } = await import('../src/orchestration/graphs/postTurnMemoryGraph');
  const { createInitialPostTurnRuntimeState } = await import('../src/orchestration/graphState/postTurnGraphState');

  // Load the job from DB
  const rows = await db.select().from(postTurnJobs).where(eq(postTurnJobs.id, jobId)).limit(1);
  const job = rows[0];
  if (!job) {
    console.error('Job ' + jobId + ' not found.');
    process.exit(1);
  }

  const payload = parsePostTurnJobPayload(job.payload);
  const stepStatus = normalizeStepStatus(job.stepStatus);
  const session = chatSessionFromSnapshot(payload.session);
  const recentMemoriesStr = payload.recentMemorySummaries.slice(0, 3).join('\n');

  const initialState = createInitialPostTurnRuntimeState(
    { jobId: job.id, attempts: job.attempts, payload, stepStatus },
    session,
    recentMemoriesStr,
  );

  // Create graph with default deps (real implementations)
  const deps = defaultPostTurnMemoryGraphDeps();
  const graph = createPostTurnMemoryGraph(deps);

  const start = performance.now();

  try {
    const state = await graph.invoke(initialState);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    if (state.errors && state.errors.length > 0) {
      console.error(' Post-turn graph completed with errors:');
      for (const err of state.errors) {
        console.error('  [' + err.stage + '] ' + err.message);
      }
      process.exit(1);
    }

    console.log(' Post-turn graph completed in ' + elapsed + 's');
    console.log('  completedSteps:', state.completedSteps?.join(', ') ?? '(none)');
    console.log('  stepStatus:', JSON.stringify(state.stepStatus, null, 2));
    console.log('  lastRetryReason:', state.lastRetryReason ?? '(none)');
    console.log('  consolidationEnqueued:', state.consolidationEnqueued);
  } catch (err) {
    console.error(' Graph invocation threw:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
