import test from "node:test";
import assert from "node:assert/strict";
import { formatCanonScenesCompact } from "../orchestration/buildPromptContext";
import type { RetrievedCanonScene } from "../retrieval/retrieveCanonNarrative";

const baseScene = (): RetrievedCanonScene => ({
  sceneId: "s1",
  chapterId: "c1",
  episodeId: "e1",
  arcKey: "main_zhiai",
  chapterName: "章一",
  episodeLabel: "第一话",
  sceneTitle: "测试场景",
  sceneSummary: "摘要一行",
  units: [
    {
      unitIndex: 2,
      speaker: "左然",
      contentType: "dialogue",
      textContent: "第二句",
    },
    {
      unitIndex: 1,
      speaker: "—",
      contentType: "narration",
      textContent: "第一句",
    },
  ],
  facts: [
    {
      subject: "左然",
      predicate: "安排",
      object: "行程",
      textForm: "左然安排了行程",
    },
  ],
  rankScore: 0.9,
  provenance: {
    fromSummary: 0.1,
    fromFact: 0.2,
    fromUnit: 0.3,
    fromLex: null,
  },
});

test("formatCanonScenesCompact sorts units and caps count", () => {
  const s = formatCanonScenesCompact([baseScene()], { maxUnitsPerScene: 1 });
  assert.ok(s.includes("[FACTS]"));
  assert.ok(s.includes("左然安排了行程"));
  assert.ok(s.includes("1 — [narration] 第一句"));
  assert.ok(!s.includes("第二句"));
});

test("formatCanonScenesCompact empty scenes", () => {
  assert.equal(formatCanonScenesCompact([], { maxUnitsPerScene: 8 }), "(无相关剧情内容)");
});
