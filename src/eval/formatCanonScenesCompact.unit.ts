import test from "node:test";
import assert from "node:assert/strict";
import { formatCanonScenes, formatCanonScenesCompact } from "../orchestration/prompt/promptFormatters";
import type { RetrievedCanonScene } from "../retrieval/canon/retrieveCanonNarrative";

const baseScene = (): RetrievedCanonScene => ({
  sceneId: "s1",
  chapterId: "c1",
  episodeId: "e1",
  arcKey: "main_zhiai",
  chapterName: "章一",
  episodeLabel: "第一话",
  episodeSummary: null,
  episodeOpeningUnits: [],
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

// ---------------------------------------------------------------------------
// Episode summary rendering
// ---------------------------------------------------------------------------

function episodeScene(overrides?: Partial<RetrievedCanonScene>): RetrievedCanonScene {
  return {
    sceneId: "s1",
    chapterId: "c1",
    episodeId: "e1",
    arcKey: "main_zhiai",
    chapterName: "章一",
    episodeLabel: "第一话",
    episodeSummary: overrides?.episodeSummary ?? null,
    episodeOpeningUnits: overrides?.episodeOpeningUnits ?? [],
    sceneTitle: "测试场景",
    sceneSummary: overrides?.sceneSummary ?? "摘要一行",
    units: [
      { unitIndex: 1, speaker: "—", contentType: "narration", textContent: "第一句" },
    ],
    facts: [
      { subject: "左然", predicate: "安排", object: "行程", textForm: "左然安排了行程" },
    ],
    rankScore: 0.9,
    provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null },
  };
}

test("formatCanonScenes renders 章节背景 when episodeSummary differs from sceneSummary", () => {
  const s = formatCanonScenes([episodeScene({
    episodeSummary: "秋季结束前我们又去了回枫河，仍然住在上回那间民宿。",
    sceneSummary: "在枫河民宿小院，左然独自等待。",
  })]);
  assert.ok(s.includes("章节背景：秋季结束前我们又去了回枫河"), "章节背景 line should appear");
  assert.ok(s.includes("摘要：在枫河民宿小院"), "摘要 line should appear");
  // 章节背景 should come before 摘要
  const bgIdx = s.indexOf("章节背景");
  const summaryIdx = s.indexOf("摘要：在枫河民宿小院");
  assert.ok(bgIdx >= 0 && summaryIdx >= 0 && bgIdx < summaryIdx, "章节背景 should precede 摘要");
});

test("formatCanonScenes omits 章节背景 when episodeSummary equals sceneSummary", () => {
  const s = formatCanonScenes([episodeScene({
    episodeSummary: "在枫河民宿小院，左然独自等待。",
    sceneSummary: "在枫河民宿小院，左然独自等待。",
  })]);
  assert.ok(!s.includes("章节背景"), "章节背景 should be omitted when duplicate of sceneSummary");
  assert.ok(s.includes("摘要：在枫河民宿小院"), "摘要 should still render");
});

test("formatCanonScenes omits 章节背景 when episodeSummary is empty", () => {
  const s = formatCanonScenes([episodeScene({ episodeSummary: "" })]);
  assert.ok(!s.includes("章节背景"), "章节背景 should be omitted when episodeSummary is empty");
});

test("formatCanonScenesCompact renders 章节背景 when episodeSummary differs from sceneSummary", () => {
  const s = formatCanonScenesCompact([episodeScene({
    episodeSummary: "秋季结束前我们又去了回枫河。",
    sceneSummary: "在枫河民宿小院。",
  })], { maxUnitsPerScene: 3 });
  assert.ok(s.includes("章节背景：秋季结束前我们又去了回枫河"), "章节背景 line should appear in compact");
});

test("formatCanonScenesCompact omits 章节背景 when episodeSummary equals sceneSummary", () => {
  const s = formatCanonScenesCompact([episodeScene({
    episodeSummary: "相同背景。",
    sceneSummary: "相同背景。",
  })], { maxUnitsPerScene: 3 });
  assert.ok(!s.includes("章节背景"), "章节背景 should be omitted when duplicate in compact");
});

test("formatCanonScenesCompact omits 章节背景 when episodeSummary is empty", () => {
  const s = formatCanonScenesCompact([episodeScene({ episodeSummary: "" })], { maxUnitsPerScene: 3 });
  assert.ok(!s.includes("章节背景"), "章节背景 should be omitted when episodeSummary is empty in compact");
});

// ---------------------------------------------------------------------------
// Opening context rendering
// ---------------------------------------------------------------------------

function openingScene(overrides?: Partial<RetrievedCanonScene>): RetrievedCanonScene {
  return {
    sceneId: "s1",
    chapterId: "c1",
    episodeId: "e1",
    arcKey: "main_zhiai",
    chapterName: "章一",
    episodeLabel: "第一话",
    episodeSummary: overrides?.episodeSummary ?? null,
    episodeOpeningUnits: overrides?.episodeOpeningUnits ?? [
      { unitIndex: 0, speaker: null, contentType: "narration", textContent: "秋季结束前我们又去了回枫河。" },
      { unitIndex: 1, speaker: "左然", contentType: "dialogue", textContent: "又来这里了。" },
    ],
    sceneTitle: "测试场景",
    sceneSummary: overrides?.sceneSummary ?? "摘要一行",
    units: [
      { unitIndex: 2, speaker: "左然", contentType: "dialogue", textContent: "场景内对白" },
    ],
    facts: [{ subject: "左然", predicate: "安排", object: "行程", textForm: "左然安排了行程" }],
    rankScore: 0.9,
    provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null },
  };
}

test("formatCanonScenes renders 开场背景 before 章节背景 and 摘要", () => {
  const s = formatCanonScenes([openingScene({
    episodeSummary: "秋季的枫河之旅。",
    sceneSummary: "在枫河民宿小院。",
  })]);
  assert.ok(s.includes("开场背景：秋季结束前我们又去了回枫河"), "开场背景 should render");
  assert.ok(s.includes("章节背景：秋季的枫河之旅"), "章节背景 should render");
  assert.ok(s.includes("摘要：在枫河民宿小院"), "摘要 should render");
  const openingIdx = s.indexOf("开场背景");
  const episodeIdx = s.indexOf("章节背景");
  const summaryIdx = s.indexOf("摘要：在枫河民宿小院");
  assert.ok(openingIdx < episodeIdx && episodeIdx < summaryIdx,
    "order should be: 开场背景 < 章节背景 < 摘要");
});

test("formatCanonScenes omits 开场背景 when episodeOpeningUnits is empty", () => {
  const s = formatCanonScenes([openingScene({ episodeOpeningUnits: [] })]);
  assert.ok(!s.includes("开场背景"), "开场背景 should be omitted when no opening units");
});

test("formatCanonScenesCompact renders 开场背景 before 章节背景 and 摘要", () => {
  const s = formatCanonScenesCompact([openingScene({
    episodeSummary: "秋季重游。",
    sceneSummary: "枫河小院。",
  })], { maxUnitsPerScene: 3 });
  assert.ok(s.includes("开场背景：秋季结束前我们又去了回枫河"), "compact should render 开场背景");
  const openingIdx = s.indexOf("开场背景");
  const episodeIdx = s.indexOf("章节背景");
  const summaryIdx = s.indexOf("摘要：枫河小院");
  assert.ok(openingIdx < episodeIdx && episodeIdx < summaryIdx,
    "compact order should be: 开场背景 < 章节背景 < 摘要");
});

test("formatCanonScenesCompact omits 开场背景 when episodeOpeningUnits is empty", () => {
  const s = formatCanonScenesCompact([openingScene({ episodeOpeningUnits: [] })], { maxUnitsPerScene: 3 });
  assert.ok(!s.includes("开场背景"), "compact should omit 开场背景 when no opening units");
});
