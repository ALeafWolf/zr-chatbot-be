import * as z from "zod";
import type { TurnOutput } from "../turn/runCharacterTurn";

/**
 * Zod schema for the turn graph state.
 * LangGraph v1 accepts Zod schemas directly as state definitions.
 */
export const TurnGraphStateSchema = z.object({
  sessionId: z.string(),
  userMessage: z.string(),
  result: z
    .object({
      assistantMessageId: z.string(),
      content: z.string(),
      wasRewritten: z.boolean(),
      wasDeflected: z.boolean(),
      turnIndex: z.number(),
      route: z.string(),
    })
    .optional(),
  errors: z
    .array(
      z.object({
        stage: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

/** Inferred TypeScript type matching the Zod schema. */
export type TurnGraphState = z.infer<typeof TurnGraphStateSchema>;

/** The subset of TurnOutput that the graph reads from the runner result. */
export type TurnGraphResult = TurnOutput;
