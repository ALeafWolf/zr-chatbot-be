import type { SessionSummaryJson } from "./sessionSummaryJson";

const MAX_RENDER_CHARS = 6000;

function clip(s: string): string {
  if (s.length <= MAX_RENDER_CHARS) return s;
  return `${s.slice(0, MAX_RENDER_CHARS)}\n…（节选）`;
}

/**
 * Deterministic projection of structured summary_json → prompt-safe text.
 * Must stay in sync with SessionSummaryJson shape.
 */
export function renderSessionSummaryForPrompt(json: SessionSummaryJson): string {
  const parts: string[] = [];

  const situation = json.currentSituation.trim();
  if (situation) {
    parts.push(`当前情况：\n${situation}`);
  }

  if (json.establishedFacts.length > 0) {
    const lines = json.establishedFacts.map(
      (f) =>
        `- [置信:${f.confidence}] [回合:${f.sourceTurnIndex}] ${f.fact}`,
    );
    parts.push(`已确立事实：\n${lines.join("\n")}`);
  }

  const rs = json.relationshipState;
  const relBits: string[] = [];
  if (rs.emotionalTone?.trim()) relBits.push(`情感基调：${rs.emotionalTone.trim()}`);
  if (rs.trustLevel?.trim()) relBits.push(`信任度：${rs.trustLevel.trim()}`);
  if (rs.unresolvedTension?.length)
    relBits.push(`未解张力：${rs.unresolvedTension.join("；")}`);
  if (rs.recentShift?.trim()) relBits.push(`近期变化：${rs.recentShift.trim()}`);
  if (relBits.length) parts.push(`关系状态：\n${relBits.join("\n")}`);

  if (json.userPreferences.length > 0) {
    const lines = json.userPreferences.map(
      (p) =>
        `- [${p.scope}] [回合:${p.sourceTurnIndex}] ${p.preference}`,
    );
    parts.push(`用户偏好/倾向：\n${lines.join("\n")}`);
  }

  if (json.openThreads.length > 0) {
    const lines = json.openThreads.map(
      (t) => `- [${t.status}] [回合:${t.sourceTurnIndex}] ${t.thread}`,
    );
    parts.push(`开放线索：\n${lines.join("\n")}`);
  }

  if (json.decisionsAndCommitments.length > 0) {
    const lines = json.decisionsAndCommitments.map((d) => {
      const o = d.owner ? ` [${d.owner}]` : "";
      return `- [回合:${d.sourceTurnIndex}]${o} ${d.item}`;
    });
    parts.push(`决定与承诺：\n${lines.join("\n")}`);
  }

  if (json.contradictionsOrCorrections.length > 0) {
    const lines = json.contradictionsOrCorrections.map(
      (c) =>
        `- [回合:${c.sourceTurnIndex}] 原述：${c.oldClaim} → 更正：${c.correctedClaim}`,
    );
    parts.push(`矛盾与修正：\n${lines.join("\n")}`);
  }

  const body = parts.filter(Boolean).join("\n\n");
  return clip(body.trim());
}
