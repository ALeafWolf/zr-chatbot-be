import { extractPostTurnSignals } from "../llm/extractPostTurnSignals";
import { writeInteractiveMemory } from "../memory/writeInteractiveMemory";
import { maybeCompactSessionSummary } from "../memory/compactSessionSummary";
import {
  persistSessionMemoryChunk,
  writeRawTurnPairSessionChunkTraced,
} from "../memory/writeSessionMemoryChunk";
import type { ChatSession } from "../db/schema/chat";
import type { SessionChunkTypePersisted } from "../memory/writeSessionMemoryChunk";
import type { RetrievedMemory } from "../retrieval/retrieveInteractiveMemories";
import type { DerivedState } from "../state/sessionStateRepo";
import type { MemoryNamespace } from "../memory/memoryNamespace";
import { traceStage } from "../observability/langsmithTracing";
import { env } from "../config/env";
import { collectPhase1StructMemPersistRows } from "../memory/structmemMapping";
import { writeStructMemTurn } from "../memory/writeStructMemTurn";

export interface PostTurnJob {
  sessionId: string;
  userMessage: string;
  assistantReply: string;
  session: ChatSession;
  memories: RetrievedMemory[];
  derivedState: DerivedState;
  shouldWriteMemory: boolean;
  /** Assistant message turn_index just written for this turn. */
  latestTurnIndex: number;
  userMessageId: string;
  assistantMessageId: string;
}

/**
 * Queue-shaped post-turn runner (Phase 1: in-process, single-flight).
 *
 * The interface deliberately mirrors a job queue so Phase 2 can swap in
 * BullMQ / PG-boss without touching call sites in runCharacterTurn.
 *
 * All enqueued jobs are tracked so graceful shutdown can drain them.
 */
class PostTurnRunner {
  private pending: Promise<void>[] = [];

  enqueue(job: PostTurnJob): void {
    const task = this.run(job).catch((err) => {
      console.error(
        `[postTurnRunner] job failed for session ${job.sessionId}:`,
        err,
      );
    });
    this.pending.push(task);
    // Cleanup resolved promises to avoid memory growth on long-lived servers
    task.finally(() => {
      this.pending = this.pending.filter((p) => p !== task);
    });
  }

  /** Await all pending jobs — called on graceful shutdown. */
  async drain(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  private async run(job: PostTurnJob): Promise<void> {
    const {
      sessionId,
      userMessage,
      assistantReply,
      session,
      memories,
      derivedState,
      shouldWriteMemory,
      latestTurnIndex,
      userMessageId,
      assistantMessageId,
    } = job;

    // Extract post-turn signals (memory facts + emotionalDelta=null in Phase 1)
    const recentMemoriesStr = memories
      .slice(0, 3)
      .map((m) => m.summary)
      .join("\n");

    await writeRawTurnPairSessionChunkTraced({
      session,
      userTurnIndex: latestTurnIndex - 1,
      assistantTurnIndex: latestTurnIndex,
      userMessage,
      assistantReply,
    });

    const signals = await tracedExtract({
      userMessage,
      assistantReply,
      sessionMode: session.mode,
      recentMemories: recentMemoriesStr,
      sessionState: JSON.stringify(derivedState),
    });

    /* StructMem: Phase 1 maps memory_candidates; Phase 2 native uses structmem_entries only (non-sandbox). */
    if (env.STRUCTMEM_ENABLED && session.mode !== "sandbox") {
      const useNative = env.STRUCTMEM_NATIVE_EXTRACTOR;
      const rows = useNative
        ? signals.structMemEntries
        : collectPhase1StructMemPersistRows(signals.memoryFacts);
      if (rows.length > 0) {
        await writeStructMemTurn({
          session,
          latestTurnIndex,
          userMessageId,
          assistantMessageId,
          rows,
          extractorBatchConfidence:
            signals.modelReportedConfidence.memoryFacts,
          mergeNativeStructMemSource: useNative,
        });
      }
    }

    /* Session-local recall rows from extractor output (sandbox: no indexing). */
    if (session.mode !== "sandbox") {
      const userTi = latestTurnIndex - 1;
      const asstTi = latestTurnIndex;
      const suppressChunks =
        env.STRUCTMEM_ENABLED &&
        (env.STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS ||
          env.STRUCTMEM_NATIVE_EXTRACTOR);
      for (const candidate of signals.memoryFacts) {
        if ((candidate.memoryScope ?? "cross_session") !== "current_session") {
          continue;
        }
        if (suppressChunks) {
          continue;
        }
        const chunkType = (candidate.sessionChunkType ??
          "scene_moment") as SessionChunkTypePersisted;
        await persistSessionMemoryChunk({
          sessionId,
          characterId: session.characterId,
          playerId: session.playerId,
          turnStart: userTi,
          turnEnd: asstTi,
          chunkText: candidate.summary,
          chunkType,
          metadata: {
            source: "extractor",
            memoryType: candidate.memoryType,
          },
          embedding: candidate.embedding,
        });
      }
    }

    if (shouldWriteMemory) {
      for (const candidate of signals.memoryFacts) {
        if ((candidate.memoryScope ?? "cross_session") !== "cross_session") {
          continue;
        }
        await writeInteractiveMemory({
          candidate,
          characterId: session.characterId,
          playerId: session.playerId,
          sessionId,
          continuityScope: session.continuityScope,
          continuityFamily: session.continuityFamily as "main_world" | "au",
          memoryNamespace: session.memoryNamespace as MemoryNamespace,
        });
      }
    }

    await maybeCompactSessionSummary({
      session,
      latestTurnIndex,
    });
  }
}

const tracedExtract = traceStage(
  "llm.extract_post_turn_signals",
  extractPostTurnSignals,
);

export const postTurnRunner = new PostTurnRunner();
