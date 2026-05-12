import type {
  CharacterDefaults,
  PersonaOverlayDefaults,
} from "../character/characterDefaults";
import type { DerivedState } from "../state/sessionStateRepo";
import type { RetrievedMemory } from "../retrieval/retrieveInteractiveMemories";
import type {
  RetrievedCanonChunk,
  RetrievedCanonScene,
} from "../retrieval/retrieveCanonNarrative";
import { CANON_PROMPT_LIMITS } from "../character/canonRules";
import type { ConversationTurn } from "../retrieval/getRecentConversationWindow";
import type { ChatSession } from "../db/schema/chat";
import type { SessionSummary } from "../db/schema/memory";
import type { RetrievedSessionMemoryChunk } from "../retrieval/retrieveSessionMemoryChunks";
import { env } from "../config/env";
import { USER_MESSAGE_ANNOTATION_RULES } from "./userMessageAnnotations";
import type { QueryRewriteResult } from "../retrieval/rewriteQuery";
import {
  annotationHeuristicFallback,
  shouldUseAnnotationFallback,
} from "../retrieval/rewriteQuery";

const SESSION_RECALL_MAX_CHARS_PER_CHUNK = 1200;

function formatSessionRecall(chunks: RetrievedSessionMemoryChunk[]): string {
  if (chunks.length === 0) return "";
  const lines = chunks.map((c, i) => {
    const label = `[${i + 1}] [类型:${c.chunkType}] Turn ${c.turnStart}–${c.turnEnd}`;
    let body = c.chunkText.trim();
    if (body.length > SESSION_RECALL_MAX_CHARS_PER_CHUNK) {
      body = `${body.slice(0, SESSION_RECALL_MAX_CHARS_PER_CHUNK)}…`;
    }
    return `${label}\n${body}`;
  });
  return `以下内容来自本会话更早片段的语义检索，可能比 RECENT CHAT 更不新；仍以 RECENT CHAT 与用户当前消息为准。\n\n${lines.join("\n\n")}`;
}

export interface PromptContext {
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  /** Plain text of canon section (for validator attribution checks). */
  retrievedCanonNarrative?: string;
}

/**
 * Build the full prompt context following the §9 Phase 1–2 block order:
 *
 * [SYSTEM] ... [CANON NARRATIVE] [STRUCTURED USER QUERY]? [USER MESSAGE ANNOTATIONS]?
 * [RECENT CHAT]   ← history passed separately to provider
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
  sessionRecall?: RetrievedSessionMemoryChunk[];
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
    sessionRecall = [],
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
      ? formatCanonScenes(canonScenes)
      : formatCanon(canonChunks);

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
    buildBlock(
      "SYSTEM",
      `你是${characterDefaults.name}，一个虚构角色扮演系统中的角色。
严格保持角色扮演。以下规则必须始终遵守：
${hardRules}

若存在 \`[STRUCTURED USER QUERY]\`，优先按其中分区理解用户输入；否则按 \`[USER MESSAGE ANNOTATIONS]\`（若出现）与原始用户消息理解。

冲突时优先级（更高者优先）：RECENT CHAT（含当前用户消息）> DERIVED STATE > SESSION SUMMARY > RELEVANT SESSION RECALL > INTERACTIVE MEMORY > CANON NARRATIVE。较近来源视为更可信；会话级检索块可能早于近期对白，请以 RECENT CHAT 与用户当前消息消解冲突。

工具：web_search 可用于查证公开实时信息（天气、新闻等），请少用且保持入戏。canon_lookup 可在断言剧情归属或行为主体（谁提议、谁安排、谁先发起等）之前核对检索到的原文摘要与片段；仅在确有断言需要佐证时调用，避免频繁检索。`,
    ),

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
            formatSessionRecall(sessionRecall),
          ),
        ]
      : []),

    buildBlock("INTERACTIVE MEMORY", formatMemories(memories)),

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

  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> =
    recentTurns.map((t) => ({ role: t.role, content: t.content }));

  return {
    systemPrompt,
    conversationHistory,
    retrievedCanonNarrative: canonNarrativeBody,
  };
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

function formatCanonChunkHeader(
  first: RetrievedCanonChunk,
  unitMin: number,
  unitMax: number,
): string {
  const parts = [
    first.arcKey ? `弧 ${first.arcKey}` : "",
    first.chapterName?.trim() || first.chapterKey
      ? `章 ${(first.chapterName ?? first.chapterKey ?? "").trim()}`
      : "",
    first.chapterLabel?.trim() ? `卷标 ${first.chapterLabel.trim()}` : "",
    first.episodeLabel ? `节 ${first.episodeLabel}` : "",
    first.sceneTitle?.trim() ? `场 ${first.sceneTitle.trim()}` : "",
    first.sceneOrder != null ? `场序 ${first.sceneOrder}` : "",
  ].filter(Boolean);
  const range =
    unitMin === unitMax ? `单元#${unitMin}` : `单元#${unitMin}–${unitMax}`;
  const head = parts.length > 0 ? parts.join(" | ") : "Canon";
  return `—— ${head} · ${range}`;
}

function formatCanon(chunks: RetrievedCanonChunk[]): string {
  if (chunks.length === 0) return "(无相关剧情内容)";

  type Group = { blockIndex: number; items: RetrievedCanonChunk[] };
  const groups: Group[] = [];
  for (const c of chunks) {
    const bi = c.blockIndex ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.blockIndex === bi) last.items.push(c);
    else groups.push({ blockIndex: bi, items: [c] });
  }

  let totalChars = 0;
  const out: string[] = [];

  for (let g = 0; g < groups.length; g++) {
    const { items } = groups[g];
    if (items.length === 0) continue;

    const indices = items
      .map((c) => c.unitIndex)
      .filter((n): n is number => typeof n === "number");
    const unitMin = indices.length ? Math.min(...indices) : 0;
    const unitMax = indices.length ? Math.max(...indices) : 0;

    const header = formatCanonChunkHeader(items[0]!, unitMin, unitMax);
    const lines: string[] = [];
    let lineN = 1;
    let blockChars = header.length + 2;

    for (const c of items) {
      if (lineN > CANON_PROMPT_LIMITS.maxLinesPerBlock) break;
      const speaker = c.speaker ? `${c.speaker}: ` : "";
      const idx = c.unitIndex != null ? `[#${c.unitIndex}] ` : "";
      let body = `${lineN}. ${idx}${speaker}${c.textContent}`;
      const remainingBlock = CANON_PROMPT_LIMITS.maxCharsPerBlock - blockChars;
      const remainingTotal = CANON_PROMPT_LIMITS.maxTotalChars - totalChars;
      const cap = Math.min(remainingBlock, remainingTotal);
      if (cap < 12) break;
      if (body.length > cap) {
        body = `${body.slice(0, Math.max(0, cap - 1))}…`;
      }
      lines.push(body);
      blockChars += body.length + 1;
      lineN += 1;
      if (blockChars >= CANON_PROMPT_LIMITS.maxCharsPerBlock) break;
    }

    const blockText = [header, ...lines].join("\n");
    if (totalChars + blockText.length + 2 > CANON_PROMPT_LIMITS.maxTotalChars) {
      const room = CANON_PROMPT_LIMITS.maxTotalChars - totalChars;
      if (room < 24) break;
      out.push(`${blockText.slice(0, room - 1)}…`);
      break;
    }
    out.push(blockText);
    totalChars += blockText.length + 2;
  }

  return out.join("\n\n");
}

export function formatCanonScenes(scenes: RetrievedCanonScene[]): string {
  if (scenes.length === 0) return "(无相关剧情内容)";

  const maxTotal = CANON_PROMPT_LIMITS.maxTotalChars;
  const maxPerScene = CANON_PROMPT_LIMITS.maxCharsPerBlock;
  let total = 0;
  const parts: string[] = [];

  sceneLoop: for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    let facts = [...s.facts];
    let units = [...s.units].sort((a, b) => a.unitIndex - b.unitIndex);

    const render = () => {
      const head = `[场景 ${i + 1}] 章节《${s.chapterName}》/ ${s.episodeLabel} / 场景：${s.sceneTitle?.trim() || "—"}`;
      let t = `${head}\n摘要：${(s.sceneSummary ?? "").trim() || "—"}\n`;
      if (facts.length > 0) {
        t += `关键事实：\n${facts
          .map((f) =>
            `- ${[f.subject, f.predicate, f.object].filter(Boolean).join(" ")}`.trim(),
          )
          .join("\n")}\n`;
      } else {
        t += `关键事实：(无检索到结构化事实)\n`;
      }
      t += `原文片段（按 unit_index 升序）：\n`;
      t += units
        .map(
          (u) =>
            `  ${u.unitIndex} ${u.speaker?.trim() || "—"} [${u.contentType}] ${u.textContent}`,
        )
        .join("\n");
      return t;
    };

    let text = render();
    while (text.length > maxPerScene && facts.length > 0) {
      facts = facts.slice(0, -1);
      text = render();
    }
    if (text.length > maxPerScene && units.length > 2) {
      const keepHead = Math.ceil(CANON_PROMPT_LIMITS.maxLinesPerBlock / 2);
      const tailN = Math.max(
        1,
        CANON_PROMPT_LIMITS.maxLinesPerBlock - keepHead - 1,
      );
      units = [
        ...units.slice(0, keepHead),
        ...units.slice(Math.max(keepHead, units.length - tailN)),
      ];
      text = render();
    }
    if (text.length > maxPerScene) {
      text = `${text.slice(0, maxPerScene - 1)}…`;
    }

    if (total + text.length + 2 > maxTotal) {
      const room = maxTotal - total - 2;
      if (room < 48) break sceneLoop;
      parts.push(`${text.slice(0, room - 1)}…`);
      break;
    }
    parts.push(text);
    total += text.length + 2;
  }

  return parts.join("\n\n");
}

/** Compact scene formatting for tool outputs (e.g. canon_lookup verification). */
export function formatCanonScenesCompact(
  scenes: RetrievedCanonScene[],
  opts: { maxUnitsPerScene: number },
): string {
  if (scenes.length === 0) return "(无相关剧情内容)";

  const maxUnits = Math.max(1, opts.maxUnitsPerScene);
  const maxTotalChars = 8000;
  let total = 0;
  const parts: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i]!;
    const units = [...s.units]
      .sort((a, b) => a.unitIndex - b.unitIndex)
      .slice(0, maxUnits);
    const factsLine =
      s.facts.length > 0
        ? `[FACTS] ${s.facts.map((f) => f.textForm.trim()).filter(Boolean).join(" | ")}`
        : "[FACTS] (无)";

    const head = `[场景 ${i + 1}] 《${s.chapterName}》/ ${s.episodeLabel} / ${s.sceneTitle?.trim() || "—"}`;
    const summaryLine = `摘要：${(s.sceneSummary ?? "").trim() || "—"}`;
    const unitLines = units
      .map(
        (u) =>
          `  ${u.unitIndex} ${u.speaker?.trim() || "—"} [${u.contentType}] ${u.textContent}`,
      )
      .join("\n");

    const block = [head, summaryLine, factsLine, "片段：", unitLines].join("\n");

    if (total + block.length + 2 > maxTotalChars) {
      const room = maxTotalChars - total - 2;
      if (room < 48) break;
      parts.push(`${block.slice(0, room - 1)}…`);
      break;
    }
    parts.push(block);
    total += block.length + 2;
  }

  return parts.join("\n\n");
}
