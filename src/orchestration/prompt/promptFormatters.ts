import { CANON_PROMPT_LIMITS } from "../../character/canonRules";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type {
  RetrievedCanonChunk,
  RetrievedCanonScene,
} from "../../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";
import type { StructMemEntryContextExpansion } from "../../retrieval/memory/retrieveStructMemEntryContextExpansions";
import type { MemoryRerankOutput } from "../retrieval/memoryRerank";
import type { StructMemMotifProbeSummary } from "../context/motifTypes";


const SESSION_RECALL_MAX_CHARS_PER_CHUNK = 1200;
const STRUCTURED_EVENT_MEMORY_MAX_CHARS_PER_ENTRY = 1200;
const STRUCTURED_MEMORY_SYNTHESIS_MAX_CHARS_PER_ITEM = 1400;
const OPEN_THREAD_MAX_CHARS_PER_ITEM = 900;
const STRUCTMEM_EXPANSION_MAX_CHARS_PER_ENTRY = 1200;

export function formatOpenThreads(threads: RetrievedOpenThread[]): string {
  const lines = threads.map((thread, index) => {
    let body = thread.text.trim();
    if (body.length > OPEN_THREAD_MAX_CHARS_PER_ITEM) {
      body = `${body.slice(0, OPEN_THREAD_MAX_CHARS_PER_ITEM)}...`;
    }
    return `${index + 1}. [${thread.status}, ${thread.source}, turn ${thread.sourceTurnIndex}] ${body}`;
  });
  return `These are active unresolved threads or pending commitments from this session. Prefer them over broad summaries when deciding what still needs attention, but do not override RECENT CHAT.\n\n${lines.join("\n")}`;
}

export function formatStructMemEntriesForPrompt(
  entries: RetrievedStructMemEntry[],
  expansions: StructMemEntryContextExpansion[] = [],
): string {
  const expansionsByEntryId = new Map(
    expansions.map((expansion) => [expansion.entryId, expansion]),
  );
  const lines = entries.map((e) => {
    let body = e.text.trim();
    if (body.length > STRUCTURED_EVENT_MEMORY_MAX_CHARS_PER_ENTRY) {
      body = `${body.slice(0, STRUCTURED_EVENT_MEMORY_MAX_CHARS_PER_ENTRY)}…`;
    }
    const expansion = expansionsByEntryId.get(e.id);
    if (!expansion) {
      return `- [${e.entryType}, turn ${e.turnIndex}] ${body}`;
    }
    let expansionBody = expansion.messages
      .map(
        (message) =>
          `  turn ${message.turnIndex} ${message.role}: ${message.content.trim()}`,
      )
      .join("\n");
    if (expansionBody.length > STRUCTMEM_EXPANSION_MAX_CHARS_PER_ENTRY) {
      expansionBody = `${expansionBody.slice(
        0,
        STRUCTMEM_EXPANSION_MAX_CHARS_PER_ENTRY,
      )}...`;
    }
    return `- [${e.entryType}, turn ${e.turnIndex}] ${body}\n  Context:\n${expansionBody}`;
  });
  return `以下内容为本会话中提取的结构化事件记忆，作为辅助上下文。标签中 factual 多指已发生事实或明确表态，relational 多指信任、距离或情绪互动层面的变化；若与 RECENT CHAT 或 [RELEVANT SESSION RECALL] 中的对白原文块冲突，以更直接的来源为准。\n\n${lines.join("\n")}`;
}

export function formatSessionRecall(
  chunks: RetrievedSessionMemoryChunk[],
): string {
  if (chunks.length === 0) return "";
  const lines = chunks.map((c, i) => {
    const label = `[${i + 1}] [类型:${c.chunkType}] Turn ${c.turnStart}-${c.turnEnd}`;
    let body = c.chunkText.trim();
    if (body.length > SESSION_RECALL_MAX_CHARS_PER_CHUNK) {
      body = `${body.slice(0, SESSION_RECALL_MAX_CHARS_PER_CHUNK)}…`;
    }
    return `${label}\n${body}`;
  });
  return `以下内容来自本会话更早片段的语义检索，可能比 RECENT CHAT 更不新；仍以 RECENT CHAT 与用户当前消息为准。\n\n${lines.join("\n\n")}`;
}

export function formatStructMemConsolidationsForPrompt(
  consolidations: RetrievedStructMemConsolidation[],
): string {
  const lines = consolidations.map((c) => {
    let body = c.summaryText.trim();
    if (body.length > STRUCTURED_MEMORY_SYNTHESIS_MAX_CHARS_PER_ITEM) {
      body = `${body.slice(0, STRUCTURED_MEMORY_SYNTHESIS_MAX_CHARS_PER_ITEM)}...`;
    }
    const range =
      c.turnStart != null && c.turnEnd != null
        ? `turns ${c.turnStart}-${c.turnEnd}`
        : "turn range unknown";
    const label =
      c.scope === "cross_session"
        ? "cross-session synthesis"
        : `current-session synthesis, ${range}`;
    return `- [${label}] ${body}`;
  });
  return `The following is synthesized StructMem memory derived from multiple structured entries. Cross-session synthesis is inferred stable memory and is lower priority than RECENT CHAT, SESSION SUMMARY, RELEVANT SESSION RECALL, and STRUCTURED EVENT MEMORY. Use it for continuity only when it does not conflict with more direct sources.\n\n${lines.join("\n")}`;
}

export function formatMemories(memories: RetrievedMemory[]): string {
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
    unitMin === unitMax ? `单元#${unitMin}` : `单元#${unitMin}-${unitMax}`;
  const head = parts.length > 0 ? parts.join(" | ") : "Canon";
  return `—— ${head} / ${range}`;
}

export function formatCanon(chunks: RetrievedCanonChunk[]): string {
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

  for (const { items } of groups) {
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
      const head = `[场景 ${i + 1}] 章节《${s.chapterName}》 ${s.episodeLabel} / 场景：${s.sceneTitle?.trim() || "—"}`;
      let t = `${head}\n摘要：${(s.sceneSummary ?? "").trim() || "—"}\n`;
      if (facts.length > 0) {
        t += `关键事实：\n${facts
          .map((f) =>
            `- ${[f.subject, f.predicate, f.object].filter(Boolean).join(" ")}`.trim(),
          )
          .join("\n")}\n`;
      } else {
        t += `关键事实：无检索到结构化事实\n`;
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

    const head = `[场景 ${i + 1}] 《${s.chapterName}》 ${s.episodeLabel} / ${s.sceneTitle?.trim() || "—"}`;
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

const STRUCTMEM_MOTIF_MAX_CHARS = 2000;

export function formatStructMemMotifBlock(
  probe: StructMemMotifProbeSummary,
): string {
  if (!probe.hasStrongMatch) return "";

  const parts: string[] = [];
  parts.push(
    `The user's action contains a distinctive relationship gesture pattern: [${probe.triggeredTerms.join(", ")}]. ` +
    `The following structured memories may reflect recurring relational motifs relevant to this interaction.`,
  );

  if (probe.matchingEntries.length > 0) {
    parts.push("## Matching Structured Event Entries");
    for (const entry of probe.matchingEntries.slice(0, 3)) {
      const text = entry.text.length > 400
        ? `${entry.text.slice(0, 399)}…`
        : entry.text;
      parts.push(
        `- [${entry.entryType}, turn ${entry.turnIndex}] (matched: ${entry.matchedTerms.join(", ")}) ${text}`,
      );
    }
  }

  if (probe.matchingConsolidations.length > 0) {
    parts.push("## Related Memory Synthesis");
    for (const con of probe.matchingConsolidations.slice(0, 2)) {
      const range = con.turnStart != null
        ? `turns ${con.turnStart}-${con.turnEnd ?? "?"}`
        : "unknown range";
      parts.push(`- [${range}] ${con.summaryText.slice(0, 600)}`);
    }
  }

  const full = parts.join("\n\n");
  return full.length > STRUCTMEM_MOTIF_MAX_CHARS
    ? `${full.slice(0, STRUCTMEM_MOTIF_MAX_CHARS - 1)}…`
    : full;
}

const USAGE_LABELS: Record<string, string> = {
  must_use: "必须使用 — 回复中应体现此信息",
  use_subtly: "含蓄使用 — 作为潜台词或语气背景",
  do_not_mention_explicitly: "勿直述 — 仅作为私人连续性参考，不可在回复中挑明",
  tone_only: "仅语气 — 仅影响回复的情绪基调，无需提及内容",
};

const RELEVANCE_LABELS: Record<string, string> = {
  required: "必需",
  useful: "有用",
  subtle_tone_only: "含蓄语气",
  background_only: "背景参考",
};

const SOURCE_LABELS: Record<string, string> = {
  session_summary: "场次摘要",
  latest_turn_delta: "最近回合变更",
  open_thread: "开放线索",
  session_chunk: "场次片段",
  structmem_entry: "结构化事件",
  structmem_consolidation: "记忆合成",
  interactive_memory: "持久记忆",
  canon_scene: "原作场景",
  canon_chunk: "原作片段",
  motif_probe: "母题探测",
  memory_correction: "记忆纠正",
};

export function formatSelectedContextUsage(
  selected: MemoryRerankOutput["selected"],
): string {
  if (selected.length === 0) return "";

  const lines = selected.map((item, i) => {
    const source = SOURCE_LABELS[item.source] ?? item.source;
    const relevance = RELEVANCE_LABELS[item.relevance] ?? item.relevance;
    const usage = USAGE_LABELS[item.usageInstruction] ?? item.usageInstruction;
    return [
      `${i + 1}. 来源：${source}`,
      `   相关性：${relevance}`,
      `   使用指引：${usage}`,
      `   原因：${item.reasonCode}`,
    ].join("\n");
  });

  return lines.join("\n\n");
}

