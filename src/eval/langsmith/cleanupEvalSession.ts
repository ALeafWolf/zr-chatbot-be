import { eq, or } from "drizzle-orm";
import { db } from "../../db/client";
import { chatSessions } from "../../db/schema/chat";
import { interactiveMemoryEvents } from "../../db/schema/memory";
import { structmemConsolidations } from "../../db/schema/structmem";
import type { EvalCleanupResult, EvalSeededSession } from "./evalTypes";

export async function cleanupEvalSession(
  seeded: EvalSeededSession | null,
): Promise<EvalCleanupResult> {
  if (!seeded) {
    return {
      attempted: false,
      completed: false,
      error: "no_seeded_session",
    };
  }

  try {
    await db
      .delete(interactiveMemoryEvents)
      .where(
        or(
          eq(interactiveMemoryEvents.sessionId, seeded.sessionId),
          eq(interactiveMemoryEvents.memoryNamespace, seeded.memoryNamespace),
        ),
      );
    await db
      .delete(structmemConsolidations)
      .where(
        or(
          eq(structmemConsolidations.sessionId, seeded.sessionId),
          eq(structmemConsolidations.memoryNamespace, seeded.memoryNamespace),
        ),
      );
    await db
      .delete(chatSessions)
      .where(eq(chatSessions.sessionId, seeded.sessionId));
    return { attempted: true, completed: true };
  } catch (err) {
    return {
      attempted: true,
      completed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
