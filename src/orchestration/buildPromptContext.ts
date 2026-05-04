import type { CharacterDefaults, PersonaOverlayDefaults } from "../character/characterDefaults";
import type { DerivedState } from "../state/sessionStateRepo";
import type { RetrievedMemory } from "../retrieval/retrieveInteractiveMemories";
import type { RetrievedCanonChunk } from "../retrieval/retrieveCanonNarrative";
import type { ConversationTurn } from "../retrieval/getRecentConversationWindow";
import type { ChatSession } from "../db/schema/chat";

export interface PromptContext {
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Build the full prompt context following the §9 Phase 1–2 block order:
 *
 * [SYSTEM] [BASE PERSONA] [CONTINUITY OVERLAY] [CHARACTER DEFAULTS]
 * [SESSION STATE] [DERIVED STATE] [INTERACTIVE MEMORY] [CANON NARRATIVE]
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

  const systemPrompt = [
    buildBlock("SYSTEM", `你是${characterDefaults.name}，一个虚构角色扮演系统中的角色。
严格保持角色扮演。以下规则必须始终遵守：
${hardRules}`),

    buildBlock("BASE PERSONA", `${characterDefaults.identity}

[核心特征]
- ${coreTraits}

[沟通风格]
措辞精准、简洁，语气冷静客观，偏好结构化表达，不使用夸张或玩笑。`),

    buildBlock("CONTINUITY OVERLAY", `范围：${personaOverlay.continuity_scope}
关系状态：${personaOverlay.relationship_status}
基线温柔度：${personaOverlay.baseline_warmth}
基线成人内容开放度：${personaOverlay.baseline_nsfw_openness} | 最高成人内容级别：${personaOverlay.max_nsfw_level} | 升级规则：${personaOverlay.escalation_rule}
超范围章节行为：${personaOverlay.out_of_scope_chapter_behavior}

${personaOverlay.overlay_identity}`),

    buildBlock("CHARACTER DEFAULTS", `默认连续性范围：${characterDefaults.interaction_defaults.default_continuity_scope}
默认情绪基线：${characterDefaults.interaction_defaults.default_emotional_baseline}
默认关系基线：${characterDefaults.interaction_defaults.default_relationship_baseline}`),

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
