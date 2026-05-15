import type {
  CharacterDefaults,
  PersonaOverlayDefaults,
} from "../character/characterDefaults";
import type { DerivedState } from "../state/sessionStateRepo";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type {
  RetrievedCanonChunk,
  RetrievedCanonScene,
} from "../retrieval/canon/retrieveCanonNarrative";
import type { ConversationTurn } from "../retrieval/conversation/getRecentConversationWindow";
import type { ChatSession } from "../db/schema/chat";
import type { SessionSummary } from "../db/schema/memory";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../retrieval/memory/retrieveOpenThreads";
import type { StructMemEntryContextExpansion } from "../retrieval/memory/retrieveStructMemEntryContextExpansions";
import { env } from "../config/env";
import { USER_MESSAGE_ANNOTATION_RULES } from "./userMessageAnnotations";
import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";
import {
  annotationHeuristicFallback,
  shouldUseAnnotationFallback,
} from "../retrieval/query/rewriteQuery";
import * as promptFormatters from "./promptFormatters";
import { formatTurnDelta, type LatestTurnDelta } from "./turnDelta";
import {
  formatMemoryCorrections,
  type MemoryCorrectionContext,
} from "./memoryCorrections";
import { traceStageWithIO } from "../observability/langsmithTracing";
import {
  attachTracePayload,
  buildPromptTracePayload,
  getAttachedTracePayload,
} from "../observability/tracePayloads";

export interface PromptContext {
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  /** Plain text of canon section for validator attribution checks. */
  retrievedCanonNarrative?: string;
}

export type BuildPromptContextInput = Parameters<typeof buildPromptContext>[0];

/**
 * Build the full prompt context following the Phase 1-2 block order:
 *
 * [SYSTEM] ... [CANON NARRATIVE] [STRUCTURED USER QUERY]? [USER MESSAGE ANNOTATIONS]?
 * [RECENT CHAT] history is passed separately to provider.
 */
export function buildPromptContext(input: {
  characterDefaults: CharacterDefaults;
  personaOverlay: PersonaOverlayDefaults;
  session: ChatSession;
  derivedState: DerivedState;
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  canonScenes?: RetrievedCanonScene[];
  recentTurns: ConversationTurn[];
  sessionSummary?: SessionSummary | null;
  openThreads?: RetrievedOpenThread[];
  memoryCorrections?: MemoryCorrectionContext[];
  latestTurnDelta?: LatestTurnDelta | null;
  sessionRecall?: RetrievedSessionMemoryChunk[];
  structMemEntries?: RetrievedStructMemEntry[];
  structMemEntryContextExpansions?: StructMemEntryContextExpansion[];
  structMemConsolidations?: RetrievedStructMemConsolidation[];
  userMessage: string;
  queryRewrite?: QueryRewriteResult;
}): PromptContext {
  const {
    characterDefaults,
    personaOverlay,
    session,
    derivedState,
    memories,
    canonChunks,
    canonScenes = [],
    recentTurns,
    sessionSummary,
    openThreads = [],
    memoryCorrections = [],
    latestTurnDelta = null,
    sessionRecall = [],
    structMemEntries = [],
    structMemEntryContextExpansions = [],
    structMemConsolidations = [],
    userMessage,
    queryRewrite,
  } = input;

  const structuredBlock = queryRewrite?.combined_for_embedding?.trim() ?? "";
  const useAnnotationFallback = queryRewrite
    ? env.ANNOTATION_RULES_ALWAYS ||
      shouldUseAnnotationFallback(queryRewrite) ||
      annotationHeuristicFallback(userMessage, queryRewrite)
    : true;

  const showStructured =
    structuredBlock.length > 0 && queryRewrite?.parseOk === true;
  const showAnnotations = useAnnotationFallback;

  const canonNarrativeBody =
    canonScenes.length > 0
      ? promptFormatters.formatCanonScenes(canonScenes)
      : promptFormatters.formatCanon(canonChunks);

  const hardRules = (characterDefaults.hard_rules ?? []).join("\n");
  const coreTraits = (characterDefaults.core_traits ?? []).join("\n- ");
  const basePersonaParts: string[] = [
    `${characterDefaults.identity}

[核心特征]
- ${coreTraits}`,
    subsection("叙事文笔", characterDefaults.narrative_prose_guidelines),
    subsection("沟通风格", formatSpeechStyle(characterDefaults.speech_style)),
    subsection("角色表达", characterDefaults.in_character_expression),
    subsection("情感内核", characterDefaults.emotional_core),
    subsection("价值观", bulletsBlock(characterDefaults.values, "- ")),
    subsection(
      "习惯与质感",
      bulletsBlock(characterDefaults.private_habits_and_texture, "- "),
    ),
  ].filter(Boolean);
  const basePersonaBody = joinNonEmpty(basePersonaParts);

  const relationshipExprBody = buildRelationshipExpressionContent(
    personaOverlay.relationship_status,
    characterDefaults.relationship_expression,
  );

  const systemPrompt = [
    buildBlock(
      "SYSTEM",
      `你是${characterDefaults.name}，一个虚构角色扮演系统中的角色。
严格保持角色扮演。以下规则必须始终遵守：
${hardRules}

若存在 \`[STRUCTURED USER QUERY]\`，优先按其中分区理解用户输入；否则按 \`[USER MESSAGE ANNOTATIONS]\`（若出现）与原始用户消息理解。

冲突时优先级（更高者优先）：RECENT CHAT（含当前用户消息）> DERIVED STATE > ACTIVE OPEN THREADS > MEMORY CORRECTIONS > LATEST TURN DELTA > SESSION SUMMARY > RELEVANT SESSION RECALL > STRUCTURED EVENT MEMORY > STRUCTURED MEMORY SYNTHESIS > INTERACTIVE MEMORY > CANON NARRATIVE。较近来源视为更可信；会话级检索块可能早于近期对白，请以 RECENT CHAT 与用户当前消息消解冲突。

工具：web_search 可用于查证公开实时信息（天气、新闻等），请少用且保持入戏。canon_lookup 可在断言剧情归属或行为主体（谁提议、谁安排、谁先发起等）之前核对检索到的原文摘要与片段；仅在确有断言需要佐证时调用，避免频繁检索。`,
    ),

    buildBlock("BASE PERSONA", basePersonaBody),

    buildBlock(
      "CONTINUITY OVERLAY",
      `范围：${personaOverlay.continuity_scope}
关系状态：${personaOverlay.relationship_status}
基线温柔度：${personaOverlay.baseline_warmth}
基线成人内容开放度：${personaOverlay.baseline_nsfw_openness} | 最高成人内容级别：${personaOverlay.max_nsfw_level} | 升级规则：${personaOverlay.escalation_rule}
超范围章节行为：${personaOverlay.out_of_scope_chapter_behavior}

${personaOverlay.overlay_identity}`,
    ),

    buildBlock("RELATIONSHIP EXPRESSION", relationshipExprBody),

    buildBlock(
      "CHARACTER DEFAULTS",
      `默认连续性范围：${characterDefaults.interaction_defaults.default_continuity_scope}
默认情绪基线：${characterDefaults.interaction_defaults.default_emotional_baseline}
默认关系基线：${characterDefaults.interaction_defaults.default_relationship_baseline}`,
    ),

    buildBlock(
      "SESSION STATE",
      `模式：${session.mode}
连续性范围：${session.continuityScope}
${session.pinnedTime ? `固定时间：${session.pinnedTime}` : ""}
${session.pinnedLocation ? `固定地点：${session.pinnedLocation}` : ""}
回写策略：${session.writebackPolicy}`,
    ),

    buildBlock(
      "DERIVED STATE",
      `推断情绪：${derivedState.inferredMood}
推断活动：${derivedState.inferredActivity}
对话立场：${derivedState.conversationalStance}`,
    ),

    ...(openThreads.length > 0
      ? [
          buildBlock(
            "ACTIVE OPEN THREADS",
            promptFormatters.formatOpenThreads(openThreads),
          ),
        ]
      : []),

    ...(memoryCorrections.length > 0
      ? [
          buildBlock(
            "MEMORY CORRECTIONS",
            formatMemoryCorrections(memoryCorrections),
          ),
        ]
      : []),

    ...(latestTurnDelta
      ? [buildBlock("LATEST TURN DELTA", formatTurnDelta(latestTurnDelta))]
      : []),

    ...(sessionSummary?.summaryText?.trim()
      ? [
          buildBlock(
            "SESSION SUMMARY",
            `本段概括当前场次中已离开「最近 Raw 窗口」的更早回合，用于连续性。若与 RECENT CHAT 冲突，以 RECENT CHAT 为准。\n\n${sessionSummary.summaryText.trim()}`,
          ),
        ]
      : []),

    ...(sessionRecall.length > 0
      ? [
          buildBlock(
            "RELEVANT SESSION RECALL",
            promptFormatters.formatSessionRecall(sessionRecall),
          ),
        ]
      : []),

    ...(env.STRUCTMEM_ENABLED && structMemEntries.length > 0
      ? [
          buildBlock(
            "STRUCTURED EVENT MEMORY",
            promptFormatters.formatStructMemEntriesForPrompt(
              structMemEntries,
              structMemEntryContextExpansions,
            ),
          ),
        ]
      : []),

    ...(env.STRUCTMEM_ENABLED &&
    (env.STRUCTMEM_CONSOLIDATION_ENABLED ||
      env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED) &&
    structMemConsolidations.length > 0
      ? [
          buildBlock(
            "STRUCTURED MEMORY SYNTHESIS",
            promptFormatters.formatStructMemConsolidationsForPrompt(
              structMemConsolidations,
            ),
          ),
        ]
      : []),

    buildBlock("INTERACTIVE MEMORY", promptFormatters.formatMemories(memories)),

    buildBlock("CANON NARRATIVE", canonNarrativeBody),

    ...(showStructured
      ? [buildBlock("STRUCTURED USER QUERY", structuredBlock)]
      : []),

    ...(showAnnotations
      ? [buildBlock("USER MESSAGE ANNOTATIONS", USER_MESSAGE_ANNOTATION_RULES)]
      : []),
  ]
    .filter(Boolean)
    .join("\n\n");

  const conversationHistory: Array<{
    role: "user" | "assistant";
    content: string;
  }> = recentTurns.map((t) => ({ role: t.role, content: t.content }));

  return {
    systemPrompt,
    conversationHistory,
    retrievedCanonNarrative: canonNarrativeBody,
  };
}

async function buildPromptContextTracedImpl(
  input: BuildPromptContextInput,
): Promise<PromptContext> {
  const promptContext = buildPromptContext(input);
  return attachTracePayload(
    promptContext,
    {
      ...buildPromptTracePayload({
      ...promptContext,
      selectedSourceCounts: {
        memories: input.memories.length,
        canonChunks: input.canonChunks.length,
        canonScenes: input.canonScenes?.length ?? 0,
        recentTurns: input.recentTurns.length,
        openThreads: input.openThreads?.length ?? 0,
        memoryCorrections: input.memoryCorrections?.length ?? 0,
        sessionRecall: input.sessionRecall?.length ?? 0,
        structMemEntries: input.structMemEntries?.length ?? 0,
        structMemEntryContextExpansions:
          input.structMemEntryContextExpansions?.length ?? 0,
        structMemConsolidations: input.structMemConsolidations?.length ?? 0,
      },
      }),
    },
  );
}

export const buildPromptContextTraced = traceStageWithIO(
  "prompt.build_context",
  buildPromptContextTracedImpl,
  {
    subsystem: "orchestration",
    turn: "foreground",
    processInputs: (inputs) => {
      const input = unwrapBuildPromptContextInput(inputs);
      return {
        selectedSourceCounts: {
          memories: input.memories.length,
          canonChunks: input.canonChunks.length,
          canonScenes: input.canonScenes?.length ?? 0,
          recentTurns: input.recentTurns.length,
          openThreads: input.openThreads?.length ?? 0,
          sessionRecall: input.sessionRecall?.length ?? 0,
          structMemEntries: input.structMemEntries?.length ?? 0,
          structMemConsolidations: input.structMemConsolidations?.length ?? 0,
        },
      };
    },
    processOutputs: (outputs) => getAttachedTracePayload(outputs) ?? {},
  },
);

function unwrapBuildPromptContextInput(
  inputs: Record<string, unknown>,
): BuildPromptContextInput {
  if ("input" in inputs && inputs.input) {
    return inputs.input as BuildPromptContextInput;
  }
  return inputs as unknown as BuildPromptContextInput;
}

function buildBlock(label: string, content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return `[${label}]\n${trimmed}`;
}

function subsection(innerTitle: string, body?: string): string {
  const t = (body ?? "").trim();
  if (!t) return "";
  return `[${innerTitle}]\n${t}`;
}

function joinNonEmpty(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join("\n\n");
}

function bulletsBlock(
  items: string[] | undefined,
  bullet: string,
): string | undefined {
  if (!items?.length) return undefined;
  const lines = items
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((line) => `${bullet}${line}`);
  return lines.length ? lines.join("\n") : undefined;
}

function formatSpeechStyle(
  style: CharacterDefaults["speech_style"] | undefined,
): string {
  const fallback =
    "措辞精准、简洁，语气冷静客观，偏好结构化表达，不使用夸张或玩笑。";
  if (!style || typeof style !== "object") return fallback;

  const lines: string[] = [];
  const lang =
    typeof style.language === "string" ? style.language.trim() : "";
  const formal =
    typeof style.formality === "string" ? style.formality.trim() : "";
  const emo =
    typeof style.emotionality === "string" ? style.emotionality.trim() : "";
  if (lang || formal || emo) {
    lines.push(
      [
        `语言：${lang || "—"}`,
        `正式度：${formal || "—"}`,
        `情绪表现：${emo || "—"}`,
      ].join("；"),
    );
  }

  const prefs = Array.isArray(style.preferred_patterns)
    ? style.preferred_patterns.map((p) => String(p).trim()).filter(Boolean)
    : [];
  if (prefs.length) lines.push(`偏好模式：${prefs.join("；")}`);

  const avoid = Array.isArray(style.avoid)
    ? style.avoid.map((p) => String(p).trim()).filter(Boolean)
    : [];
  if (avoid.length) lines.push(`避免：${avoid.join("；")}`);

  return lines.length > 0 ? lines.join("\n") : fallback;
}

function buildRelationshipExpressionContent(
  relationshipStatus: string,
  rel: CharacterDefaults["relationship_expression"],
): string {
  if (!rel) return "";
  const parts: string[] = [];
  const gen = rel.general?.trim();
  if (gen) parts.push(gen);

  const includeIntimate =
    relationshipStatus === "confirmed_relationship" ||
    relationshipStatus === "engaged" ||
    relationshipStatus === "married";
  if (includeIntimate) {
    const intimate = rel.intimate?.trim();
    if (intimate) parts.push(intimate);
  }
  if (relationshipStatus === "married") {
    const married = rel.married?.trim();
    if (married) parts.push(married);
  }

  return parts.join("\n\n");
}
