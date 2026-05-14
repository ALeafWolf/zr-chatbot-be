import { CANON_PROMPT_LIMITS } from "../character/canonRules";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type {
  RetrievedCanonChunk,
  RetrievedCanonScene,
} from "../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";

const SESSION_RECALL_MAX_CHARS_PER_CHUNK = 1200;
const STRUCTURED_EVENT_MEMORY_MAX_CHARS_PER_ENTRY = 1200;
const STRUCTURED_MEMORY_SYNTHESIS_MAX_CHARS_PER_ITEM = 1400;

export function formatStructMemEntriesForPrompt(
  entries: RetrievedStructMemEntry[],
): string {
  const lines = entries.map((e) => {
    let body = e.text.trim();
    if (body.length > STRUCTURED_EVENT_MEMORY_MAX_CHARS_PER_ENTRY) {
      body = `${body.slice(0, STRUCTURED_EVENT_MEMORY_MAX_CHARS_PER_ENTRY)}…`;
    }
    return `- [${e.entryType}, turn ${e.turnIndex}] ${body}`;
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
