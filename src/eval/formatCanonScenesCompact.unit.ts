import test from "node:test";
import assert from "node:assert/strict";
import { formatCanonScenes, formatCanonScenesCompact } from "../orchestration/prompt/promptFormatters";
import type { RetrievedCanonScene } from "../retrieval/canon/retrieveCanonNarrative";

function baseScene(overrides?: Partial<RetrievedCanonScene>): RetrievedCanonScene {
  return { sceneId: "s1", chapterId: "c1", episodeId: "e1", arcKey: "main_zhiai", chapterName: "章一", episodeLabel: "第一话", episodeSummary: null, episodeOpeningUnits: [], sceneTitle: "测试场景", sceneSummary: "摘要一行", units: [{ unitIndex: 2, speaker: "左然", contentType: "dialogue", textContent: "第二句" }, { unitIndex: 1, speaker: "—", contentType: "narration", textContent: "第一句" }], facts: [{ subject: "左然", predicate: "安排", object: "行程", textForm: "左然安排了行程" }], rankScore: 0.9, provenance: { fromSummary: 0.1, fromFact: 0.2, fromUnit: 0.3, fromLex: null }, ...overrides };
}

test("formatCanonScenesCompact sorts units, caps count, handles empty", () => {
  const r = formatCanonScenesCompact([baseScene()], { maxUnitsPerScene: 1 });
  assert.ok(r.includes("[FACTS]"), "[FACTS] header");
  assert.ok(r.includes("左然安排了行程"), "FACTS textForm renders");
  assert.ok(r.includes("1 — [narration] 第一句"), "unit sort order + line formatting");
  assert.ok(!r.includes("第二句"), "capped at 1 unit");
  assert.equal(formatCanonScenesCompact([], { maxUnitsPerScene: 8 }), "(无相关剧情内容)", "empty scenes");
});

test("formatCanonScenes and formatCanonScenesCompact handle episode summary matching/omission and opening context ordering", () => {
  // episodeSummary differs from sceneSummary → 章节背景 renders
  let s = formatCanonScenes([baseScene({ episodeSummary: "秋季结束前我们又去了回枫河，仍然住在上回那间民宿。", sceneSummary: "在枫河民宿小院，左然独自等待。" })]);
  assert.ok(s.includes("章节背景：秋季结束前我们又去了回枫河"), "formatCanonScenes —章节背景when different");
  assert.ok(s.includes("摘要：在枫河民宿小院"), "摘要 renders");
  assert.ok(s.indexOf("章节背景") < s.indexOf("摘要：在枫河民宿小院"), "章节背景 precedes 摘要");

  // episodeSummary equals sceneSummary → 章节背景 omitted
  assert.ok(!formatCanonScenes([baseScene({ episodeSummary: "相同", sceneSummary: "相同" })]).includes("章节背景"), "omitted when equal");

  // episodeSummary empty → 章节背景 omitted
  assert.ok(!formatCanonScenes([baseScene({ episodeSummary: "" })]).includes("章节背景"), "omitted when empty");

  // formatCanonScenesCompact: same three scenarios
  s = formatCanonScenesCompact([baseScene({ episodeSummary: "秋季结束前我们又去了回枫河。", sceneSummary: "在枫河民宿小院。" })], { maxUnitsPerScene: 3 });
  assert.ok(s.includes("章节背景：秋季结束前我们又去了回枫河"), "compact —章节背景when different");
  assert.ok(!formatCanonScenesCompact([baseScene({ episodeSummary: "相同", sceneSummary: "相同" })], { maxUnitsPerScene: 3 }).includes("章节背景"), "compact —omitted when equal");
  assert.ok(!formatCanonScenesCompact([baseScene({ episodeSummary: "" })], { maxUnitsPerScene: 3 }).includes("章节背景"), "compact —omitted when empty");

  // Opening context rendering
  const opener = (epSum?: string) => baseScene({ episodeSummary: epSum ?? "秋季的枫河之旅。", sceneSummary: "在枫河民宿小院。", episodeOpeningUnits: [{ unitIndex: 0, speaker: null, contentType: "narration", textContent: "秋季结束前我们又去了回枫河。" }, { unitIndex: 1, speaker: "左然", contentType: "dialogue", textContent: "又来这里了。" }] });
  s = formatCanonScenes([opener()]);
  assert.ok(s.includes("开场背景：秋季结束前我们又去了回枫河"), "开场背景 renders");
  assert.ok(s.indexOf("开场背景") < s.indexOf("章节背景"), "开场背景 before 章节背景");
  assert.ok(!formatCanonScenes([baseScene({ episodeOpeningUnits: [], episodeSummary: "秋。", sceneSummary: "院。" })]).includes("开场背景"), "开场背景 omitted when no opening units");

  s = formatCanonScenesCompact([opener()], { maxUnitsPerScene: 3 });
  assert.ok(s.includes("开场背景"), "compact —开场背景 renders");
  assert.ok(s.indexOf("开场背景") < s.indexOf("章节背景"), "compact —开场背景 before 章节背景");
  assert.ok(!formatCanonScenesCompact([baseScene({ episodeOpeningUnits: [], episodeSummary: "秋之旅。", sceneSummary: "院。" })], { maxUnitsPerScene: 3 }).includes("开场背景"), "compact —omitted when no opening units");
});
