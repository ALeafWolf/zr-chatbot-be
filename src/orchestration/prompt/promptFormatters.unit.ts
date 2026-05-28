import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStructMemEntriesForPrompt } from "./promptFormatters";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";

const entry: RetrievedStructMemEntry = {
  id: "entry-1",
  eventId: "event-1",
  turnIndex: 4,
  entryType: "decision",
  text: "They agreed to revisit the question later.",
  importanceScore: 0.8,
  confidenceScore: 0.8,
  cosineSimilarity: 0.8,
  finalScore: 0.8,
};

describe("formatStructMemEntriesForPrompt", () => {
  it("renders compact context expansion when present", () => {
    const text = formatStructMemEntriesForPrompt([entry], [
      {
        entryId: "entry-1",
        eventId: "event-1",
        messages: [
          { turnIndex: 3, role: "user", content: "Can we talk later?" },
          { turnIndex: 4, role: "assistant", content: "Yes, we will." },
        ],
      },
    ]);

    assert.match(text, /Context:/);
    assert.match(text, /turn 3 user: Can we talk later\?/);
    assert.match(text, /turn 4 assistant: Yes, we will\./);
  });

  it("does not render context for unexpanded entries", () => {
    const text = formatStructMemEntriesForPrompt([entry], []);
    assert.equal(text.includes("Context:"), false);
  });
});

import { formatInternalLogicEvidence } from "./promptFormatters";
import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

const evidenceHit: InternalLogicEvidenceHit = {
  id: "ev_001", characterId: "zuo_ran", node: "core_fear",
  claimText: "左然害怕暴露不成熟的一面。",
  evidenceText: "六年级生日想要棉花糖却说要钢笔。",
  arcKey: "main_zhiai", chapterKey: "jin_shu_feng_hui",
  episodeLabel: "Episode 6", sceneOrder: null, unitIndex: null,
  scopeApplicability: { continuityFamily: "main_world" },
  sourceKind: "canon", confidenceScore: 0.9, metadata: {},
  cosineSimilarity: 0.5, finalScore: 0.5,
};

describe("formatInternalLogicEvidence", () => {
  it("renders node, claim, evidence, and provenance", () => {
    const text = formatInternalLogicEvidence([evidenceHit]);
    assert.ok(text.includes("core_fear"), "should include node");
    assert.ok(text.includes("左然害怕暴露不成熟的一面"), "should include claimText");
    assert.ok(text.includes("六年级生日想要棉花糖却说要钢笔"), "should include evidenceText");
    assert.ok(text.includes("main_zhiai / jin_shu_feng_hui / Episode 6"), "should include provenance");
    assert.ok(text.includes("以上是生成行为的依据"), "should include instruction line");
  });

  it("returns empty string for empty hits", () => {
    assert.equal(formatInternalLogicEvidence([]), "");
  });

  it("renders multiple hits separated", () => {
    const hit2 = { ...evidenceHit, id: "ev_002", node: "core_belief", claimText: "规则意识", evidenceText: "事实准确" };
    const text = formatInternalLogicEvidence([evidenceHit, hit2]);
    assert.ok(text.includes("core_fear"), "first hit node");
    assert.ok(text.includes("core_belief"), "second hit node");
  });

  it("renders provenance only when available", () => {
    const noProvenance = { ...evidenceHit, arcKey: null, chapterKey: null, episodeLabel: null };
    const text = formatInternalLogicEvidence([noProvenance]);
    assert.ok(text.includes("core_fear"), "still renders node");
    assert.ok(!text.includes("出处："), "no provenance line when all provenance fields are null");
  });
});
