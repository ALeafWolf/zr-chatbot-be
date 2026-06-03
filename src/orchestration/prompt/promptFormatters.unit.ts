import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStructMemEntriesForPrompt, formatInternalLogicEvidence } from "./promptFormatters";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

const entry: RetrievedStructMemEntry = {
  id: "entry-1", eventId: "event-1", turnIndex: 4,
  entryType: "decision", text: "They agreed to revisit the question later.",
  importanceScore: 0.8, confidenceScore: 0.8, cosineSimilarity: 0.8, finalScore: 0.8,
};

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

describe("formatStructMemEntriesForPrompt", () => {
  it("renders context when expansions present and omits when absent", () => {
    const cases = [
      {
        name: "compact context expansion present",
        expansions: [{ entryId: "entry-1", eventId: "event-1", messages: [{ turnIndex: 3, role: "user" as const, content: "Can we talk later?" }, { turnIndex: 4, role: "assistant" as const, content: "Yes, we will." }] }],
        checks: (text: string) => { assert.match(text, /Context:/); assert.match(text, /turn 3 user: Can we talk later\?/); assert.match(text, /turn 4 assistant: Yes, we will\./); },
      },
      {
        name: "no context for unexpanded entries",
        expansions: [],
        checks: (text: string) => { assert.equal(text.includes("Context:"), false); },
      },
    ];
    for (const c of cases) {
      const text = formatStructMemEntriesForPrompt([entry], c.expansions);
      c.checks(text);
    }
  });
});

describe("formatInternalLogicEvidence", () => {
  it("renders node/claim/evidence/provenance, handles empty/multiple/null-provenance", () => {
    const cases = [
      {
        name: "renders full entry",
        hits: [evidenceHit],
        checks: (text: string) => {
          assert.ok(text.includes("core_fear"), "should include node");
          assert.ok(text.includes("左然害怕暴露不成熟的一面"), "should include claimText");
          assert.ok(text.includes("六年级生日想要棉花糖却说要钢笔"), "should include evidenceText");
          assert.ok(text.includes("main_zhiai / jin_shu_feng_hui / Episode 6"), "should include provenance");
          assert.ok(text.includes("以上是生成行为的依据"), "should include instruction line");
        },
      },
      {
        name: "empty hits",
        hits: [],
        checks: (text: string) => { assert.equal(text, ""); },
      },
      {
        name: "multiple hits separated",
        hits: [evidenceHit, { ...evidenceHit, id: "ev_002", node: "core_belief", claimText: "规则意识", evidenceText: "事实准确" }],
        checks: (text: string) => { assert.ok(text.includes("core_fear"), "first hit node"); assert.ok(text.includes("core_belief"), "second hit node"); },
      },
      {
        name: "renders provenance only when available",
        hits: [{ ...evidenceHit, arcKey: null, chapterKey: null, episodeLabel: null }],
        checks: (text: string) => { assert.ok(text.includes("core_fear"), "still renders node"); assert.ok(!text.includes("出处："), "no provenance line when all provenance fields are null"); },
      },
    ];
    for (const c of cases) {
      const text = formatInternalLogicEvidence(c.hits);
      c.checks(text);
    }
  });
});
