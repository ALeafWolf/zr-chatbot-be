import * as z from "zod";

/**
 * Zod schema for the coarse roleplay graph state (Phase 3 preparation).
 *
 * Carries session, character context, resolved context, prompt context,
 * generation result, persistence output, and errors through the graph.
 */
export const RoleplayGraphStateSchema = z.object({
  /** Provided as input. */
  sessionId: z.string(),
  userMessage: z.string(),

  /** Populated by loadSession node. */
  session: z.any().optional(),

  /** Populated by loadCharacterContext node. */
  characterContext: z.any().optional(),

  /** Populated by resolveContext node. */
  resolvedContext: z.any().optional(),

  /** Populated by buildPrompt node. */
  promptContext: z.any().optional(),

  /** Populated by generateAndValidate node (captured from _complete). */
  generationResult: z.any().optional(),

  /** Non-delta generation events accumulated for trace/test inspection. */
  generationEvents: z.array(z.any()).optional(),

  /** Populated by persistTurn node. */
  persistedRoute: z.string().optional(),
  persisted: z.any().optional(),

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

/** Inferred TypeScript type for the roleplay graph state. */
export type RoleplayGraphState = z.infer<typeof RoleplayGraphStateSchema>;
