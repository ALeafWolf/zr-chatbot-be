/**
 * TG0 — OOC Replay Harness CLI.
 *
 * Usage:
 *   npx tsx src/eval/ooc/runOocReplayCli.ts [--variant raw|sanitized] [--max-turns N]
 *
 * This CLI replays turns 260–291 of session-2dc74568 through the live backend
 * pipeline (runCharacterTurn), computes OOC metrics on the generated replies,
 * and prints a machine-readable report.
 *
 * Run without arguments for a quick smoke test (raw variant, max 2 turns):
 *   npx tsx src/eval/ooc/runOocReplayCli.ts --max-turns 2
 *
 * For the baseline run (TG0.4):
 *   npx tsx src/eval/ooc/runOocReplayCli.ts --variant raw
 *   npx tsx src/eval/ooc/runOocReplayCli.ts --variant sanitized
 *
 * ⚠ This script calls the live model pipeline and requires DB + API keys.
 *   It is NOT part of unit verification (test:unit).
 *
 * # Sanitized variant limitation (F1)
 *
 * The `sanitized` variant applies `sanitizeAssistantHistory` only to the
 * SEED history (turns 1–259 from the transcript). Replies generated during
 * the 260→291 loop are written to the DB and read back as history for later
 * turns WITHOUT sanitization — the in-pipeline generation-facing sanitizer
 * does not exist until TG1.3 lands.
 *
 * Consequence: the sanitized variant is fully clean only for the earliest
 * replay turns and degrades as generated `（心想：/（内心：` replies accumulate
 * in the DB during the run. The true full-sanitization measurement arrives
 * once TG1.3's sanitizer runs in-pipeline, sanitizing every conversationHistory
 * read regardless of origin.
 *
 * This is inherent: the harness cannot intercept `buildPromptContext`'s DB
 * read pre-TG1.3.
 */

import { parseArgs } from "node:util";
import { loadOocReplayScenario } from "./loadOocReplayScenario";
import {
  computeOocPerTurnMetrics,
  computeAggregateMetrics,
} from "./oocMetrics";
import { sanitizeAssistantHistory } from "../../orchestration/prompt/historySanitizer";
import type {
  HistoryVariant,
  OocAggregateMetrics,
  ReplayScenario,
} from "./replayTypes";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  variant: HistoryVariant;
  skipModelCalls: boolean;
  maxTurns: number;
  scenarioPath?: string;
}

function parseCliArgs(): CliArgs {
  const args = parseArgs({
    options: {
      variant: {
        type: "string",
        short: "v",
        default: "raw",
      },
      "max-turns": {
        type: "string",
        short: "m",
        default: "999",
      },
      "skip-model": {
        type: "boolean",
        short: "s",
        default: false,
      },
      scenario: {
        type: "string",
        short: "c",
      },
    },
    strict: true,
  });

  const variantRaw = args.values.variant as string;
  if (variantRaw !== "raw" && variantRaw !== "sanitized") {
    console.error(
      `Invalid variant "${variantRaw}". Use "raw" or "sanitized".`,
    );
    process.exit(1);
  }

  return {
    variant: variantRaw as HistoryVariant,
    skipModelCalls: args.values["skip-model"] ?? false,
    maxTurns: parseInt(args.values["max-turns"] ?? "999", 10),
    scenarioPath: args.values.scenario as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// Stub reply (for smoke testing without model calls)
// ---------------------------------------------------------------------------

const STUB_REPLY =
  "（心想：从胚胎学数据分析，对称性结构定义了……）" +
  "他沉默了片刻。\n" +
  "（停顿）\n" +
  "“……好。”\n" +
  "（内心：这个反应模式阈值偏低）\n";

// ---------------------------------------------------------------------------
// Metrics computation
// ---------------------------------------------------------------------------

function computePerTurnMetricsForReplies(
  replies: Array<{ turnIndex: number; content: string }>,
  variant: HistoryVariant,
): OocAggregateMetrics {
  const perTurn = replies.map((r) =>
    computeOocPerTurnMetrics(r.content, r.turnIndex),
  );
  return computeAggregateMetrics(perTurn, variant);
}

// ---------------------------------------------------------------------------
// Markdown report builder
// ---------------------------------------------------------------------------

function formatMetricsReport(
  scenario: ReplayScenario,
  aggregate: OocAggregateMetrics,
  elapsedMs: number,
): string {
  const lines: string[] = [];

  lines.push(`# OOC Replay Report`);
  lines.push(``);
  lines.push(`- **Session**: ${scenario.sessionId}`);
  lines.push(`- **Title**: ${scenario.title}`);
  lines.push(`- **Variant**: ${aggregate.variant}`);
  lines.push(`- **Turns**: ${aggregate.turnCount} (${scenario.replayTurns[0]?.turnIndex ?? "?"}–${scenario.replayTurns[scenario.replayTurns.length - 1]?.turnIndex ?? "?"})`);
  lines.push(`- **Elapsed**: ${(elapsedMs / 1000).toFixed(1)}s`);
  lines.push(``);

  // --- Aggregate metrics ---
  lines.push(`## Aggregate Metrics`);
  lines.push(``);
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(
    `| Mean reply length | ${aggregate.meanReplyLength.toFixed(1)} chars |`,
  );
  lines.push(
    `| Median reply length | ${aggregate.medianReplyLength.toFixed(1)} chars |`,
  );
  lines.push(`| Min reply length | ${aggregate.minReplyLength} chars |`);
  lines.push(`| Max reply length | ${aggregate.maxReplyLength} chars |`);
  lines.push(
    `| Mean short-sentence ratio | ${(aggregate.meanShortSentenceRatio * 100).toFixed(1)}% |`,
  );
  lines.push(
    `| Mean clinical-word density | ${aggregate.meanClinicalWordDensity.toFixed(2)} / 1000 chars |`,
  );
  lines.push(`| Total clinical-word hits | ${aggregate.totalClinicalWordHits} |`);
  lines.push(
    `| Total long parenthetical monologue | ${aggregate.totalLongParentheticalMonologue} |`,
  );
  lines.push(
    `| Turns with long monologue | ${aggregate.turnsWithLongMonologue} / ${aggregate.turnCount} |`,
  );
  lines.push(
    `| Turns with clinical words | ${aggregate.turnsWithClinicalWords} / ${aggregate.turnCount} |`,
  );
  lines.push(
    `| Total 心想/内心 hits | ${aggregate.totalLiteralXiangXinNeiXinHits} |`,
  );
  lines.push(
    `| Total strict tags | ${aggregate.totalXiangXinNeiXinSpanTags} |`,
  );
  lines.push(``);

  // --- Per-turn metrics ---
  lines.push(`## Per-Turn Metrics`);
  lines.push(``);
  lines.push(
    `| Turn | Length | Sentences | Short% | Clinical | Clinical/1k | LongParen | 心想/内心 | Strict tags |`,
  );
  lines.push(
    `|------|--------|-----------|--------|----------|-------------|-----------|----------|------------|`,
  );

  for (const m of aggregate.perTurn) {
    lines.push(
      `| ${m.turnIndex} | ${m.replyLength} | ${m.sentenceCount} | ${(m.shortSentenceRatio * 100).toFixed(0)}% | ${m.clinicalWordHits} | ${m.clinicalWordDensity.toFixed(2)} | ${m.longParentheticalMonologueCount} | ${m.literalXiangXinNeiXinHits} | ${m.xiangXinNeiXinSpanTagCount} |`,
    );
  }
  lines.push(``);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Machine-readable JSON report
// ---------------------------------------------------------------------------

function formatMetricsJson(
  scenario: ReplayScenario,
  aggregate: OocAggregateMetrics,
  elapsedMs: number,
): string {
  return JSON.stringify(
    {
      sessionId: scenario.sessionId,
      title: scenario.title,
      variant: aggregate.variant,
      turnCount: aggregate.turnCount,
      turnRange: {
        from: scenario.replayTurns[0]?.turnIndex,
        to: scenario.replayTurns[scenario.replayTurns.length - 1]?.turnIndex,
      },
      elapsedMs,
      aggregate: {
        meanReplyLength: Math.round(aggregate.meanReplyLength * 10) / 10,
        medianReplyLength: Math.round(aggregate.medianReplyLength * 10) / 10,
        minReplyLength: aggregate.minReplyLength,
        maxReplyLength: aggregate.maxReplyLength,
        meanShortSentenceRatio:
          Math.round(aggregate.meanShortSentenceRatio * 1000) / 1000,
        meanClinicalWordDensity:
          Math.round(aggregate.meanClinicalWordDensity * 100) / 100,
        totalClinicalWordHits: aggregate.totalClinicalWordHits,
        totalLongParentheticalMonologue:
          aggregate.totalLongParentheticalMonologue,
        turnsWithLongMonologue: aggregate.turnsWithLongMonologue,
        turnsWithClinicalWords: aggregate.turnsWithClinicalWords,
        totalLiteralXiangXinNeiXinHits:
          aggregate.totalLiteralXiangXinNeiXinHits,
        totalXiangXinNeiXinSpanTags: aggregate.totalXiangXinNeiXinSpanTags,
      },
      perTurn: aggregate.perTurn.map((m) => ({
        turnIndex: m.turnIndex,
        replyLength: m.replyLength,
        sentenceCount: m.sentenceCount,
        shortSentenceRatio: Math.round(m.shortSentenceRatio * 1000) / 1000,
        clinicalWordHits: m.clinicalWordHits,
        clinicalWordDensity: Math.round(m.clinicalWordDensity * 100) / 100,
        longParentheticalMonologueCount:
          m.longParentheticalMonologueCount,
        parentheticalSpanCount: m.parentheticalSpanCount,
        literalXiangXinNeiXinHits: m.literalXiangXinNeiXinHits,
        xiangXinNeiXinSpanTagCount: m.xiangXinNeiXinSpanTagCount,
        replyText: m.replyText,
      })),
    },
    null,
    2,
  );
}

// ---------------------------------------------------------------------------
// Replay execution
// ---------------------------------------------------------------------------

async function runReplay(
  scenario: ReplayScenario,
  variant: HistoryVariant,
  skipModelCalls: boolean,
  maxTurns: number,
): Promise<{ aggregate: OocAggregateMetrics; elapsedMs: number }> {
  const startTime = Date.now();
  const limitedTurns = scenario.replayTurns.slice(0, maxTurns);
  const replies: Array<{ turnIndex: number; content: string }> = [];

  if (skipModelCalls) {
    // Smoke-test mode: use stub reply for each turn
    for (const turn of limitedTurns) {
      const content =
        variant === "sanitized"
          ? sanitizeAssistantHistory(STUB_REPLY)
          : STUB_REPLY;
      replies.push({ turnIndex: turn.turnIndex, content });
    }
  } else {
    // ============================================================
    // FULL LIVE REPLAY MODE
    //
    // This path seeds a DB session with the transcript history and
    // runs runCharacterTurn for each replay user message.
    //
    // Implementation note: The session is created once, seeded with
    // all turns 1–259, then each replay turn is run sequentially so
    // the assistant reply from turn N is visible as history for turn N+1.
    // ============================================================

    // Dynamic imports (only when actually running)
    const { seedEvalSession } = await import(
      "../langsmith/seedEvalSession"
    );
    const { runCharacterTurn } = await import(
      "../../orchestration/turn/runCharacterTurn"
    );
    const { cleanupEvalSession } = await import(
      "../langsmith/cleanupEvalSession"
    );
    const { postTurnRunner } = await import(
      "../../jobs/postTurnRunner"
    );
    const {
      createAgentEvalCapture,
      withAgentEvalCapture,
    } = await import("../evalSnapshots");

    // Build the seed input
    const seedMessages = scenario.seedMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content:
        variant === "sanitized" && m.role === "assistant"
          ? sanitizeAssistantHistory(m.content)
          : m.content,
      turnIndex: m.turnIndex,
    }));

    const seedInput: import("../langsmith/evalTypes").AgentEvalInput = {
      scenarioId: `ooc_replay_${variant}`,
      userMessage: limitedTurns[0]?.userMessage ?? "",
      sessionSeed: {
        mode: "canonical_live",
        continuityScope: "main_married",
        continuityFamily: "main_world",
        writebackPolicy: "no_writeback",
        thinking: true,
      },
      recentMessages: seedMessages,
      // TG0.7b: Wire the transcript's turn-259 axis state so the replay
      // starts from the correct arousal/restraint baseline, not cold.
      seedAxisState: scenario.seedAxisState as import("../langsmith/evalTypes").AgentEvalInput["seedAxisState"],
      // TG0.7c: Forward accumulated memory from the transcript where available.
      sessionSummary: scenario.sessionSummary,
      durableMemories: scenario.durableMemories as import("../langsmith/evalTypes").AgentEvalInput["durableMemories"],
      structMemEntries: scenario.structMemEntries as import("../langsmith/evalTypes").AgentEvalInput["structMemEntries"],
      sessionChunks: scenario.sessionChunks as import("../langsmith/evalTypes").AgentEvalInput["sessionChunks"],
    };

    // Seed the session
    console.error(`Seeding session (${seedMessages.length} seed messages)...`);
    const seeded = await seedEvalSession(seedInput);
    console.error(
      `Session seeded: ${seeded.sessionId} (maxTurnIndex: ${seeded.maxSeededTurnIndex})`,
    );

    let successCount = 0;
    let failCount = 0;

    // TG0.7a-fix: Run each turn's post-turn job SYNCHRONOUSLY before cleanup
    // (mirrors runAgentEval.ts:200-212). Prevents the FK-violation race where
    // cleanupEvalSession deletes the session before the async post-turn job
    // writes session_memory_chunks.
    try {
      for (let i = 0; i < limitedTurns.length; i++) {
        const turn = limitedTurns[i];
        console.error(
          `  [${i + 1}/${limitedTurns.length}] Running turn ${turn.turnIndex}...`,
        );

        try {
          const capture = createAgentEvalCapture({
            scenarioId: `ooc_replay_${variant}`,
            evalSessionId: seeded.sessionId,
          });

          await withAgentEvalCapture(capture, async () => {
            const result = await runCharacterTurn({
              sessionId: seeded.sessionId,
              userMessage: turn.userMessage,
            });

            const jobId = capture.memoryWrite.postTurnJobId;
            if (jobId) {
              await postTurnRunner.runJobByIdForEval(jobId);
            }

            const replyContent = result.content;
            replies.push({
              turnIndex: turn.turnIndex,
              content: replyContent,
            });
            successCount++;
            console.error(
              `    → ${replyContent.length} chars`,
            );
          });
        } catch (err) {
          failCount++;
          const errMsg =
            err instanceof Error ? err.message : String(err);
          console.error(`    ✗ Error: ${errMsg}`);
          replies.push({
            turnIndex: turn.turnIndex,
            content: `[ERROR: ${errMsg}]`,
          });
        }
      }
    } finally {
      // Always attempt cleanup
      console.error(`Cleaning up session...`);
      await cleanupEvalSession(seeded);
    }

    console.error(
      `\nDone: ${successCount} succeeded, ${failCount} failed`,
    );
  }

  const elapsedMs = Date.now() - startTime;

  // Compute metrics
  const aggregate = computePerTurnMetricsForReplies(
    replies,
    variant,
  );

  return { aggregate, elapsedMs };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cli = parseCliArgs();

  console.error(`Loading OOC replay scenario...`);
  const scenario = loadOocReplayScenario(cli.scenarioPath);

  console.error(
    `Scenario: "${scenario.title}" (${scenario.replayTurns.length} replay turns, ${scenario.seedMessages.length} seed messages)`,
  );
  console.error(`Variant: ${cli.variant}`);

  if (cli.skipModelCalls) {
    console.error(`Mode: smoke test (no model calls, using stub replies)`);
  } else {
    console.error(`Mode: live replay (calls model pipeline)`);
  }

  const { aggregate, elapsedMs } = await runReplay(
    scenario,
    cli.variant,
    cli.skipModelCalls,
    cli.maxTurns,
  );

  // Output: Markdown report to stderr, JSON report to stdout
  const markdown = formatMetricsReport(scenario, aggregate, elapsedMs);
  console.error(markdown);

  const json = formatMetricsJson(scenario, aggregate, elapsedMs);
  console.log(json);
}

// ---------------------------------------------------------------------------
// Guard: only run main when this module is the entry point
// ---------------------------------------------------------------------------

const isMainModule =
  typeof require !== "undefined" &&
  require.main === module &&
  process.argv[1]?.includes("runOocReplayCli");

if (isMainModule) {
  main().catch((err) => {
    console.error("OOC replay CLI error:", err);
    process.exitCode = 1;
  });
}
