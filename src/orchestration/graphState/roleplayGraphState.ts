import * as z from "zod";
import type { ChatSession } from "../../db/schema/chat";
import { LoadRoleplayCharacterContextOutputSchema } from "../roleplay/roleplayAdapters";
import { ResolvedContextSchema } from "../context/resolveContext";
import { PromptContextSchema } from "../prompt/buildPromptContext";

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
  session: z.custom<ChatSession>().optional(),

  /** Populated by loadCharacterContext node. */
  characterContext: LoadRoleplayCharacterContextOutputSchema.optional(),

  /** Populated by resolveContext node (or by assembleResolvedContext via new graph nodes). */
  resolvedContext: ResolvedContextSchema.optional(),

  /** Populated by buildPreRerankContext node. */
  preRerankContext: z.any().optional(),

  /** Populated by rerankContext node. */
  rerankResult: z.any().optional(),

  /** Populated by rerank node when LLM rerank fails (contains fallbackReason and rerankMs). */
  rerankLlmError: z.any().optional(),

  /** Populated by buildPrompt node. */
  promptContext: PromptContextSchema.optional(),

  /** Populated by generateDraft node. */
  draft: z.any().optional(),

  /** Populated by validateDraft node (attempt 1). */
  validation1Result: z.any().optional(),

  /** Populated by rewriteDraft node. */
  rewriteDraft: z.any().optional(),

  /** Populated by validateDraft node (attempt 2). */
  validation2Result: z.any().optional(),

  /** Populated by generateAndValidate node (captured from _complete) or buildGenerationResult/safeDeflection nodes. */
  generationResult: z.any().optional(),

  /** Non-delta generation events accumulated for trace/test inspection. */
  generationEvents: z.array(z.any()).optional(),

  /** Populated by persistTurn node. */
  persistedRoute: z.string().optional(),
  persisted: z.any().optional(),

  /** Set before routing to safeDeflection to track the reason. */
  deflectionReason: z.string().optional(),

  /** Error accumulator. Uses passthrough() so graph routing metadata
   *  such as `toolLoopExceeded` survives state normalization. */
  errors: z
    .array(
      z
        .object({
          stage: z.string(),
          message: z.string(),
        })
        .passthrough(),
    )
    .optional(),

  // ---------------------------------------------------------------------------
  // Internal fields passed from the stream adapter into the generation subgraph
  // ---------------------------------------------------------------------------

  /** Abort signal forwarded from the stream adapter. */
  _signal: z.any().optional(),
  /** Thought summary cache shared with the stream adapter. */
  _cache: z.any().optional(),
  /** Thought accumulator shared with the stream adapter. */
  _thoughtsAcc: z.any().optional(),
  /** Whether this is the first user turn (shared with stream adapter). */
  _isFirstUserTurn: z.boolean().optional(),
  /** Voice hints string shared with the stream adapter. */
  _voiceHints: z.string().optional(),
});

/** Inferred TypeScript type for the roleplay graph state. */
export type RoleplayGraphState = z.infer<typeof RoleplayGraphStateSchema>;
