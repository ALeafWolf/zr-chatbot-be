import { z } from "zod";
import { formatInternalLogic } from "../../character/psychology/formatInternalLogic";
import type {
  CharacterDefaults,
  PersonaOverlayDefaults,
} from "../../character/characterDefaults";
import type { DerivedState } from "../../state/sessionStateRepo";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type {
  RetrievedCanonChunk,
  RetrievedCanonScene,
} from "../../retrieval/canon/retrieveCanonNarrative";
import type { ConversationTurn } from "../../retrieval/conversation/getRecentConversationWindow";
import type { ChatSession } from "../../db/schema/chat";
import type { SessionSummary } from "../../db/schema/memory";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";
import type { StructMemEntryContextExpansion } from "../../retrieval/memory/retrieveStructMemEntryContextExpansions";
import type { StructMemMotifProbeSummary } from "../context/motifTypes";
import type { MemoryRerankOutput } from "../retrieval/memoryRerank";
import type { QueryRewriteResult } from "../../retrieval/query/rewriteQuery";
import { env } from "../../config/env";
import { USER_MESSAGE_ANNOTATION_RULES } from "../annotations/userMessageAnnotations";
import {
  annotationHeuristicFallback,
  shouldUseAnnotationFallback,
} from "../../retrieval/query/rewriteQuery";
import * as promptFormatters from "./promptFormatters";
import { formatTurnDelta, type LatestTurnDelta } from "../turn/turnDelta";
import {
  formatMemoryCorrections,
  type MemoryCorrectionContext,
} from "../context/memoryCorrections";
import { traceStageWithIO } from "../../observability/langsmithTracing";
import {
  attachTracePayload,
  buildPromptTracePayload,
  estimateInjectedTokensBySource,
  getAttachedTracePayload,
} from "../../observability/tracePayloads";

/**
 * Canon truth mode controls how strictly the model must adhere to injected
 * canon when responding to user prompts about story history.
 *
 * - `strict_canon_recall`: The user is explicitly asking about canon history.
 *   Unsupported concrete story-history claims must be rejected.
 * - `canon_blend`: Canon is injected as helpful background, but the turn is
 *   a live/current interaction. Harmless roleplay embellishment is allowed.
 * - `open_roleplay`: No canon was injected. Normal behavior.
 */
export type CanonTruthMode =
  | "strict_canon_recall"
  | "canon_blend"
  | "open_roleplay";

/**
 * Deterministically derive the canon truth mode for the current turn.
 *
 * Returns `open_roleplay` when no canon is injected.
 * Returns `strict_canon_recall` when canon is injected and the user is asking
 * about concrete canon history (attribution intent, or any selected canon
 * fact/chunk source with recall cues in the user message).
 * Returns `canon_blend` for all other canon-injected turns.
 */
export function deriveCanonTruthMode(input: {
  userMessage: string;
  queryRewrite?: QueryRewriteResult | null;
  hasCanonNarrative: boolean;
  selectedMemorySources?: Array<{ source: string; relevance: string; usageInstruction: string }>;
}): CanonTruthMode {
  if (!input.hasCanonNarrative) return "open_roleplay";

  // Attribution intent always triggers strict mode
  if (input.queryRewrite?.intent === "attribution") return "strict_canon_recall";

  // Check for any selected canon source (fact or chunk) with recall cues.
  // Hybrid/LLM rerank may label useful canon as "useful" / "use_subtly",
  // so we no longer require "required" or "must_use" for strict mode.
  const hasStrictCanonSource = (input.selectedMemorySources ?? []).some(
    (s) => s.source === "canon_fact" || s.source === "canon_chunk",
  );
  if (hasStrictCanonSource) {
    const msg = input.userMessage.toLowerCase();
    const recallCues = [
      "记得", "第一次", "第二次", "剧情", "原作", "那封信",
      "民宿", "谁", "哪里", "什么时候", "为什么",
    ];
    const hasRecallCue = recallCues.some((c) => msg.includes(c));
    if (hasRecallCue) return "strict_canon_recall";
  }

  return "canon_blend";
}

export interface PromptContext {
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  /** Plain text of canon section for validator attribution checks. */
  retrievedCanonNarrative?: string;
  /** Reranker-selected memory sources for validator plumbing. */
  selectedMemorySources?: Array<{ source: string; relevance: string; usageInstruction: string }>;
  /** Canon truth mode for this turn. */
  canonTruthMode?: CanonTruthMode;
}

/** Runtime Zod schema for PromptContext. Catches missing required keys and wrong types. */
export const PromptContextSchema = z.object({
  systemPrompt: z.string(),
  conversationHistory: z.array(
    z.object({ role: z.enum(["user", "assistant"]), content: z.string() }),
  ),
  retrievedCanonNarrative: z.string().optional(),
  selectedMemorySources: z
    .array(
      z.object({
        source: z.string(),
        relevance: z.string(),
        usageInstruction: z.string(),
      }),
    )
    .optional(),
  canonTruthMode: z.enum(["strict_canon_recall", "canon_blend", "open_roleplay"]).optional(),
});

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
  motifProbe?: StructMemMotifProbeSummary;
  memoryRerank?: MemoryRerankOutput | null;
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
    motifProbe,
    memoryRerank,
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

  // Canon scenes/chunks received here are already filtered by
  // filterCanonBySelection() in rerankContext. We no longer duplicate that
  // filtering here. Keep only a safety clear: when the reranker ran but
  // selected no canon, clear everything to prevent unselected canon leakage.
  const hasRerank = memoryRerank?.selected != null;
  const rerankHasAnyCanonSelected = hasRerank
    ? memoryRerank!.selected.some(
        (s) => (s.source as string) === "canon_fact" || (s.source as string) === "canon_chunk",
      )
    : false;

  let filteredCanonChunks: RetrievedCanonChunk[];
  let filteredCanonScenes: RetrievedCanonScene[];

  if (!hasRerank) {
    // No reranker — trust whatever was passed in
    filteredCanonChunks = canonChunks;
    filteredCanonScenes = canonScenes;
  } else if (!rerankHasAnyCanonSelected) {
    // Reranker exists but selected no canon — clear all canon (safety: never
    // re-inject unselected canon beyond what the reranker chose)
    filteredCanonChunks = [];
    filteredCanonScenes = [];
  } else {
    // Reranker selected some canon — trust already-filtered input from
    // rerankContext.filterCanonBySelection()
    filteredCanonChunks = canonChunks;
    filteredCanonScenes = canonScenes;
  }
  const hasCanonNarrative =
    filteredCanonScenes.length > 0 || filteredCanonChunks.length > 0;
  const canonTruthMode = deriveCanonTruthMode({
    userMessage,
    queryRewrite,
    hasCanonNarrative,
    selectedMemorySources: memoryRerank?.selected?.map((s) => ({
      source: s.source,
      relevance: s.relevance,
      usageInstruction: s.usageInstruction,
    })),
  });
  const canonNarrativeBody = hasCanonNarrative
    ? filteredCanonScenes.length > 0
      ? promptFormatters.formatCanonScenes(filteredCanonScenes)
      : promptFormatters.formatCanon(filteredCanonChunks)
    : "";

  const hardRules = (characterDefaults.hard_rules ?? []).join("\n");
  const coreTraits = (characterDefaults.core_traits ?? [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join("\n- ");
  const basePersonaParts: string[] = [
    coreTraits
      ? `${characterDefaults.identity}\n\n[核心特征]\n- ${coreTraits}`
      : characterDefaults.identity,
    subsection("叙事文笔", characterDefaults.narrative_prose_guidelines),
    subsection("沟通风格", formatSpeechStyle(characterDefaults.speech_style)),
    subsection("角色表达", characterDefaults.in_character_expression),
    subsection("格式抗性", characterDefaults.format_resistance),
    subsection("纠正方式", characterDefaults.canon_correction),
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

若存在 \`[STRUCTURED USER QUERY]\`，优先按其中分区理解用户输入，并必须遵守 \`[STRUCTURED USER QUERY LABEL RULES]\`；否则按 \`[USER MESSAGE ANNOTATIONS]\`（若出现）与原始用户消息理解。

冲突时优先级（更高者优先）：RECENT CHAT（含当前用户消息）> DERIVED STATE > ACTIVE OPEN THREADS > MEMORY CORRECTIONS > LATEST TURN DELTA > SESSION SUMMARY > RELEVANT SESSION RECALL > STRUCTURED EVENT MEMORY > STRUCTURED MEMORY SYNTHESIS > INTERACTIVE MEMORY > CANON NARRATIVE。较近来源视为更可信；会话级检索块可能早于近期对白，请以 RECENT CHAT 与用户当前消息消解冲突。

工具：web_search 可用于查证公开实时信息（天气、新闻等），请少用且保持入戏。`,
    ),

    // CHARACTER INTERNAL LOGIC — before BASE PERSONA so Layer 1 (why) precedes
    // Layer 2 surface content (how). Renders only when internal_logic data is present.
    ...(characterDefaults.internal_logic &&
    Object.values(characterDefaults.internal_logic).some((v) => v?.trim())
      ? [buildBlock("CHARACTER INTERNAL LOGIC", formatInternalLogic(characterDefaults.internal_logic))]
      : []),

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

    ...((env.STRUCTMEM_ENABLED &&
    (env.STRUCTMEM_CONSOLIDATION_ENABLED ||
      env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED) &&
    structMemConsolidations.length > 0)
      ? [
          buildBlock(
            "STRUCTURED MEMORY SYNTHESIS",
            promptFormatters.formatStructMemConsolidationsForPrompt(
              structMemConsolidations,
            ),
          ),
        ]
      : []),

    ...((env.STRUCTMEM_MOTIF_PROBE_ENABLED &&
    motifProbe?.hasStrongMatch)
      ? [
          buildBlock(
            "RELEVANT STRUCTURED MEMORY — RELATIONSHIP MOTIF",
            promptFormatters.formatStructMemMotifBlock(motifProbe),
          ),
        ]
      : []),

    ...(memories.length > 0
      ? [buildBlock("INTERACTIVE MEMORY", promptFormatters.formatMemories(memories))]
      : []),

    ...(hasCanonNarrative
      ? [
          buildBlock("CANON NARRATIVE", canonNarrativeBody),
          // TEMPORAL PREMISE HANDLING — immediately after CANON NARRATIVE to
          // instruct the model on resolving temporal/sequence false premises
          // (e.g. user says "第一次去枫河" but canon proves it's a return visit).
          buildBlock(
            "TEMPORAL PREMISE HANDLING",
            "时序前提处理规则（仅当上方 [CANON NARRATIVE] 存在时适用）：\n"
            + "- 将用户消息中的时序/地点表述与 canon 的开场背景、章节背景、摘要、关键事实进行对比。\n"
            + "- 如果用户消息包含「第一次」「首次」等首次访问表述，而已注入的 canon 中明确显示该事件/地点是再次访问（包含「再次」「又」「上回」「前次」「第二次」等线索），则用户的前提与 canon 直接矛盾。\n"
            + "- 当 canon 直接矛盾时：回复的第一句话必须进行平静的纠正（例如「我记得不太一样，那应该是我们第二次去枫河了……」），然后再继续回应记忆内容。\n"
            + "- 例外：当前对话（RECENT CHAT）中的明确信息优先于 canon；不要在没有直接矛盾的情况下强行纠正。\n"
            + "- 不要因为不同章节的 canon 片段而合并时间线或过度推断。",
          ),
          ...(canonTruthMode === "strict_canon_recall"
            ? [
                buildBlock(
                  "CANON TRUTH MODE",
                  "当前问题是在询问具体剧情/过去事件。你可以用动作和语气自然回应，但凡涉及剧情事实、时间、地点、顺序、原因、信件内容、物品位置、谁做了什么，只能使用上方 canon 或 RECENT CHAT 明确支持的信息。纠正用户前提后，不要补写第一次行程、第一封信、服务区、枕头底下等未提供细节；不确定时保持克制或略过。",
                ),
              ]
            : []),
          // STYLE SALIENCE REMINDER — after TEMPORAL PREMISE HANDLING, before
          // canon-heavy blocks end, to defend against Type 2 register breaks.
          buildBlock(
            "STYLE SALIENCE REMINDER",
            "即使参考了上方剧情资料，回复仍必须保持左然的表达方式：克制、短句、少解释、不科普化；情绪通过停顿、动作和转移体现，不直接剖白。",
          ),
        ]
      : []),

    ...(showStructured
      ? [
          buildBlock("STRUCTURED USER QUERY LABEL RULES", STRUCTURED_QUERY_LABEL_RULES),
          buildBlock("STRUCTURED USER QUERY", structuredBlock),
        ]
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
    selectedMemorySources: memoryRerank?.selected.map((s) => ({
      source: s.source,
      relevance: s.relevance,
      usageInstruction: s.usageInstruction,
    })),
    canonTruthMode,
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
      injectedTokensBySource: estimateInjectedTokensBySource(promptContext.systemPrompt),
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

const STRUCTURED_QUERY_LABEL_RULES = `[STRUCTURED USER QUERY] 内部的各类标签并不等同。

[user speech] = 用户在场景内说出口的对白；角色可感知。
[user action] = 用户在场景内做出的身体动作或叙事动作；若场景条件允许，角色可感知。
[user thought] = 用户的私人内心想法；角色不可感知。
[reply direction suggestion] = 场景外的回复方向指引；角色不可感知。

角色绝不能推断 [reply direction suggestion] 是由 <user> 说出、发送、输入、知晓、意图表达或主动透露的内容。

当 [reply direction suggestion] 与当前连续性不冲突时，角色应将其作为回复生成方向，自然地执行或叙述该方向；但不得把它当作 <user> 在场景内传达的信息。`;
