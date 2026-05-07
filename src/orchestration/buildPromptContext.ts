import type {
  CharacterDefaults,
  PersonaOverlayDefaults,
} from "../character/characterDefaults";
import type { DerivedState } from "../state/sessionStateRepo";
import type { RetrievedMemory } from "../retrieval/retrieveInteractiveMemories";
import type { RetrievedCanonChunk } from "../retrieval/retrieveCanonNarrative";
import type { ConversationTurn } from "../retrieval/getRecentConversationWindow";
import type { ChatSession } from "../db/schema/chat";

/** Appended last in the system prompt: how to interpret ()/（） stage directions and 【】 meta. */
const USER_MESSAGE_ANNOTATION_RULES = `用户消息中可能包含非对白标注。
被 \`()\` 或 \`（）\` 包裹的内容表示非直接说出口的上下文，例如用户的内心活动、用户动作，或双方/场景动作。不要将其视为用户说出的对白。若其中描述的是可观察到的行为、表情、动作或语气变化，应让角色像自然观察到这些外在表现后作出回应。若其中描述的是私人内心活动，不要让角色表现得像能读心；只有当它能从外在表现中合理推断时，才可让角色以试探、猜测或含蓄察觉的方式回应，否则应忽略，或仅作为隐藏情绪背景参考。
被 \`【】\` 包裹的内容表示用户提供的出戏指导或回复方向，而不是情景内对白。它可能用于指定情景设定、下一轮回复角度、情绪基调、节奏或回复重点。生成回复时应参考这些指导来塑造回应，但不得违反更高优先级的系统规则、安全限制或角色一致性。
回复中不要主动提及用户使用了括号或方括号，除非必须请求澄清。`;

export interface PromptContext {
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Build the full prompt context following the §9 Phase 1–2 block order:
 *
 * [SYSTEM] [BASE PERSONA] [CONTINUITY OVERLAY] [RELATIONSHIP EXPRESSION]
 * [CHARACTER DEFAULTS]
 * [SESSION STATE] [DERIVED STATE] [INTERACTIVE MEMORY] [CANON NARRATIVE]
 * [USER MESSAGE ANNOTATIONS]
 * [RECENT CHAT]   ← history passed separately to provider
 */
export function buildPromptContext(input: {
  characterDefaults: CharacterDefaults;
  personaOverlay: PersonaOverlayDefaults;
  session: ChatSession;
  derivedState: DerivedState;
  memories: RetrievedMemory[];
  canonChunks: RetrievedCanonChunk[];
  recentTurns: ConversationTurn[];
}): PromptContext {
  const {
    characterDefaults,
    personaOverlay,
    session,
    derivedState,
    memories,
    canonChunks,
    recentTurns,
  } = input;

  const hardRules = (characterDefaults.hard_rules ?? []).join("\n");
  const coreTraits = (characterDefaults.core_traits ?? []).join("\n- ");
  const basePersonaParts: string[] = [
    `${characterDefaults.identity}

[核心特征]
- ${coreTraits}`,
    subsection("沟通风格", formatSpeechStyle(characterDefaults.speech_style)),
    subsection("情感内核", characterDefaults.emotional_core),
    subsection(
      "价值观",
      bulletsBlock(characterDefaults.values, "- "),
    ),
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
    buildBlock("SYSTEM", `你是${characterDefaults.name}，一个虚构角色扮演系统中的角色。
严格保持角色扮演。以下规则必须始终遵守：
${hardRules}`),

    buildBlock("BASE PERSONA", basePersonaBody),

    buildBlock("CONTINUITY OVERLAY", `范围：${personaOverlay.continuity_scope}
关系状态：${personaOverlay.relationship_status}
基线温柔度：${personaOverlay.baseline_warmth}
基线成人内容开放度：${personaOverlay.baseline_nsfw_openness} | 最高成人内容级别：${personaOverlay.max_nsfw_level} | 升级规则：${personaOverlay.escalation_rule}
超范围章节行为：${personaOverlay.out_of_scope_chapter_behavior}

${personaOverlay.overlay_identity}`),

    buildBlock("RELATIONSHIP EXPRESSION", relationshipExprBody),

    buildBlock(
      "CHARACTER DEFAULTS",
      `默认连续性范围：${characterDefaults.interaction_defaults.default_continuity_scope}
默认情绪基线：${characterDefaults.interaction_defaults.default_emotional_baseline}
默认关系基线：${characterDefaults.interaction_defaults.default_relationship_baseline}`,
    ),

    buildBlock("SESSION STATE", `模式：${session.mode}
连续性范围：${session.continuityScope}
${session.pinnedTime ? `固定时间：${session.pinnedTime}` : ""}
${session.pinnedLocation ? `固定地点：${session.pinnedLocation}` : ""}
回写策略：${session.writebackPolicy}`),

    buildBlock("DERIVED STATE", `推断情绪：${derivedState.inferredMood}
推断活动：${derivedState.inferredActivity}
对话立场：${derivedState.conversationalStance}`),

    buildBlock("INTERACTIVE MEMORY", formatMemories(memories)),

    buildBlock("CANON NARRATIVE", formatCanon(canonChunks)),

    buildBlock("USER MESSAGE ANNOTATIONS", USER_MESSAGE_ANNOTATION_RULES),
  ]
    .filter(Boolean)
    .join("\n\n");

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> =
    recentTurns.map((t) => ({ role: t.role, content: t.content }));

  return { systemPrompt, conversationHistory };
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

function bulletsBlock(items: string[] | undefined, bullet: string): string | undefined {
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
      [`语言：${lang || "—"}`, `正式度：${formal || "—"}`, `情绪表现：${emo || "—"}`].join(
        "；",
      ),
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

/** Select relationship_expression shards from defaults using overlay relationship_status. */
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

function formatMemories(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return "(无相关记忆)";
  return memories
    .map((m, i) => `${i + 1}. [${m.memoryType}] ${m.summary}`)
    .join("\n");
}

function formatCanon(chunks: RetrievedCanonChunk[]): string {
  if (chunks.length === 0) return "(无相关剧情内容)";
  return chunks
    .map((c, i) => {
      const speaker = c.speaker ? `${c.speaker}: ` : "";
      return `${i + 1}. ${speaker}${c.textContent}`;
    })
    .join("\n");
}
