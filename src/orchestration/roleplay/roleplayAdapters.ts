import { z } from "zod";
import {
  loadCharacterDefaults,
  loadPersonaOverlay,
  type CharacterDefaults,
  type PersonaOverlayDefaults,
} from "../../character/characterDefaults";
import type { ChatSession } from "../../db/schema/chat";
import { resolveContext } from "../context/resolveContext";
import type { ResolvedContext } from "../context/resolveContext";
import { buildPromptContextTraced } from "../prompt/buildPromptContext";
import type { PromptContext } from "../prompt/buildPromptContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoadRoleplayCharacterContextInput {
  session: ChatSession;
}

export interface LoadRoleplayCharacterContextOutput {
  characterDefaults: CharacterDefaults;
  overlayId: string;
  personaOverlay: PersonaOverlayDefaults;
  voiceHints: string;
}

/** Runtime Zod schema for LoadRoleplayCharacterContextOutput.
 * CharacterDefaults and PersonaOverlayDefaults are large types with complex nesting;
 * keep those as z.custom() to avoid duplicating their full schemas. */
export const LoadRoleplayCharacterContextOutputSchema = z.object({
  characterDefaults: z.custom<CharacterDefaults>(),
  overlayId: z.string(),
  personaOverlay: z.custom<PersonaOverlayDefaults>(),
  voiceHints: z.string(),
});

export interface ResolveRoleplayContextInput {
  session: ChatSession;
  userMessage: string;
  characterDefaults: CharacterDefaults;
}

export interface BuildRoleplayPromptContextInput {
  characterDefaults: CharacterDefaults;
  personaOverlay: PersonaOverlayDefaults;
  session: ChatSession;
  resolvedContext: ResolvedContext;
  userMessage: string;
}

// ---------------------------------------------------------------------------
// voiceHintsFrom (extracted from runCharacterTurn.ts)
// ---------------------------------------------------------------------------

/**
 * Build voice-hints string from character speech-style defaults.
 */
export function voiceHintsFrom(
  characterDefaults: CharacterDefaults,
): string {
  const s = characterDefaults.speech_style;
  return [s.formality, s.emotionality, ...(s.preferred_patterns ?? [])].join(
    "，",
  );
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Load character defaults, persona overlay, overlay id (with fallback),
 * and build voice hints — preserving the existing inline behavior from
 * `runRoleplayTurnStream`.
 *
 * Accepts optional injected loaders for unit testing without disk I/O.
 */
export async function loadRoleplayCharacterContext(
  input: LoadRoleplayCharacterContextInput,
  deps?: {
    loadCharacterDefaults?: typeof loadCharacterDefaults;
    loadPersonaOverlay?: typeof loadPersonaOverlay;
  },
): Promise<LoadRoleplayCharacterContextOutput> {
  const { session } = input;
  const loadDefaults = deps?.loadCharacterDefaults ?? loadCharacterDefaults;
  const loadOverlay = deps?.loadPersonaOverlay ?? loadPersonaOverlay;

  const characterDefaults = loadDefaults(session.characterId);
  const overlayId =
    session.personaOverlayId ?? `${session.continuityScope}`;
  const personaOverlay = loadOverlay(overlayId);
  const voiceHints = voiceHintsFrom(characterDefaults);

  return { characterDefaults, overlayId, personaOverlay, voiceHints };
}

/**
 * Thin wrapper around the existing `resolveContext(...)`.
 *
 * Keeps retrieval internals, parallelism, rerank fallback, diagnostics,
 * and eval snapshots unchanged. Intended to become a LangGraph node in
 * Phase 3 without behavioral changes.
 *
 * Accepts an optional injected resolver for unit testing.
 */
export async function resolveRoleplayContext(
  input: ResolveRoleplayContextInput,
  deps?: {
    resolveContext?: typeof resolveContext;
  },
): Promise<ResolvedContext> {
  const resolve = deps?.resolveContext ?? resolveContext;
  return resolve({
    session: input.session,
    userMessage: input.userMessage,
    characterDefaults: input.characterDefaults,
  });
}

/**
 * Thin wrapper around the existing `buildPromptContextTraced(...)`.
 *
 * Maps the broad `ResolvedContext` fields to the specific prompt-context
 * input shape. Preserves the current resolved-context-to-prompt field
 * mapping and trace IO.
 *
 * Accepts an optional injected builder for unit testing without tracing.
 */
export async function buildRoleplayPromptContext(
  input: BuildRoleplayPromptContextInput,
  deps?: {
    buildPromptContext?: typeof buildPromptContextTraced;
  },
): Promise<PromptContext> {
  const build = deps?.buildPromptContext ?? buildPromptContextTraced;
  const {
    characterDefaults,
    personaOverlay,
    session,
    resolvedContext: context,
    userMessage,
  } = input;

  return build({
    characterDefaults,
    personaOverlay,
    session,
    derivedState: context.derivedState,
    memories: context.memories,
    canonChunks: context.canonChunks,
    canonScenes: context.canonScenes,
    recentTurns: context.recentTurns,
    sessionSummary: context.sessionSummary,
    openThreads: context.openThreads,
    memoryCorrections: context.memoryCorrections,
    latestTurnDelta: context.latestTurnDelta,
    sessionRecall: context.sessionRecall,
    structMemEntries: context.structMemEntries,
    structMemEntryContextExpansions: context.structMemEntryContextExpansions,
    structMemConsolidations: context.structMemConsolidations,
    motifProbe: context.motifProbe,
    internalLogicEvidence: context.internalLogicEvidence,
    memoryRerank: context.rerankOutput,
    userMessage,
    queryRewrite: context.queryRewrite,
  });
}
