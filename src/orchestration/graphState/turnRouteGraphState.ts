import * as z from "zod";
import type { TurnOutput } from "../turn/runCharacterTurn";

/**
 * Zod schema for the route-branch graph state (Phase 2).
 * LangGraph v1 accepts Zod schemas directly as state definitions.
 */
export const TurnRouteGraphStateSchema = z.object({
  /** Provided as input. */
  sessionId: z.string(),
  userMessage: z.string(),

  /** Populated by loadSessionNode. */
  session: z.any().optional(),

  /** Populated by classifyTurnRouteNode. */
  routeIntent: z.any().optional(),

  /** Set by routeSwitchNode — drives conditional edges. */
  route: z.string().optional(),

  /** Populated by whichever branch node executes. */
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

  /** Error accumulator. */
  errors: z
    .array(
      z.object({
        stage: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

/** Inferred TypeScript type for the route graph state. */
export type TurnRouteGraphState = z.infer<typeof TurnRouteGraphStateSchema>;

/** Convenience result shape used across all three branches. */
export type RouteBranchResult = TurnOutput;
