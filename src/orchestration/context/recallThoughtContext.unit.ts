import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRecallThoughtContext, __testing, type RecallThoughtContextItem } from "./recallThoughtContext";
import type { MemoryRerankOutput } from "../retrieval/memoryRerank";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedOpenThread } from "../../retrieval/memory/retrieveOpenThreads";

const { buildRerankLookup, visibleModeFor, privateHintText, truncate, RECALL_TOTAL_ITEM_CAP } = __testing;

describe("truncate", () => {
  it("returns short strings unchanged, truncates long with ellipsis", () => {
    assert.equal(truncate("hello", 10), "hello", "short unchanged");
    const r = truncate("a".repeat(50), 10);
    assert.equal(r.length, 10, "truncated length");
    assert.match(r, /…$/, "ends with ellipsis");
  });
});

describe("visibleModeFor", () => {
  it("returns direct/private_hint based on usageInstruction", () => {
    assert.equal(visibleModeFor(undefined), "direct", "undefined → direct");
    assert.equal(visibleModeFor({ id: "m1", source: "interactive_memory", relevance: "useful", usageInstruction: "do_not_mention_explicitly", reasonCode: "explicit_recall" }), "private_hint", "do_not_mention → private_hint");
    assert.equal(visibleModeFor({ id: "m1", source: "interactive_memory", relevance: "subtle_tone_only", usageInstruction: "tone_only", reasonCode: "tone_guidance" }), "private_hint", "tone_only → private_hint");
    assert.equal(visibleModeFor({ id: "m1", source: "interactive_memory", relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }), "direct", "must_use → direct");
  });
});

describe("privateHintText", () => {
  it("returns appropriate text for each usage instruction", () => {
    assert.match(privateHintText("do_not_mention_explicitly"), /private continuity reference/, "do_not_mention_hint");
    assert.match(privateHintText("tone_only"), /tone guidance/, "tone_only hint");
  });
});

describe("buildRerankLookup", () => {
  it("builds ID-to-selected map", () => {
    const rerank: MemoryRerankOutput = { selected: [{ id: "m1", source: "interactive_memory", relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }, { id: "s1", source: "session_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "user_preference" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false };
    const map = buildRerankLookup(rerank);
    assert.equal(map.size, 2, "2 items");
    assert.equal(map.get("m1")?.source, "interactive_memory", "m1 mapped");
    assert.equal(map.get("s1")?.source, "session_chunk", "s1 mapped");
    assert.equal(map.get("unknown"), undefined, "unknown → undefined");
  });
});

describe("buildRecallThoughtContext", () => {
  const baseInput = { memories: [] as RetrievedMemory[], sessionRecall: [] as RetrievedSessionMemoryChunk[], structMemEntries: [] as RetrievedStructMemEntry[], structMemConsolidations: [], openThreads: [], canonChunks: [], canonScenes: [], sessionSummary: null, latestTurnDelta: null, memoryCorrections: [], rerankOutput: null as MemoryRerankOutput | null };

  it("handles empty/fallback selections and selectionMode", () => {
    let r = buildRecallThoughtContext({ ...baseInput, rerankOutput: { selected: [], rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false } });
    assert.equal(r.items.length, 0, "empty rerank — no items");
    assert.equal(r.selectionMode, "rerank", "selectionMode=rerank");

    r = buildRecallThoughtContext(baseInput);
    assert.equal(r.items.length, 0, "no rerank — no items");
    assert.equal(r.selectionMode, "fallback", "selectionMode=fallback");
  });

  it("includes selected sources and excludes rejected", () => {
    // selected memory
    let r = buildRecallThoughtContext({ ...baseInput, memories: [{ id: "m1", memoryType: "fact", summary: "User likes tea", cosineSimilarity: 0.9, importanceScore: 0.8, emotionScore: 0.1 } as RetrievedMemory], rerankOutput: { selected: [{ id: "m1", source: "interactive_memory", relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false } });
    assert.equal(r.items.length, 1, "memory selected");
    assert.equal(r.items[0]?.source, "interactive_memory", "source correct");
    assert.match(r.items[0]?.text, /User likes tea/, "text correct");

    // rejected
    r = buildRecallThoughtContext({ ...baseInput, memories: [{ id: "m1", memoryType: "fact", summary: "User likes tea", cosineSimilarity: 0.9, importanceScore: 0.8, emotionScore: 0.1 } as RetrievedMemory], rerankOutput: { selected: [], rejected: [{ id: "m1", source: "interactive_memory", reasonCode: "irrelevant" }], finalContextMode: "recent_only", needsEvidenceFallback: false } });
    assert.equal(r.items.length, 0, "rejected excluded");

    // session chunk
    r = buildRecallThoughtContext({ ...baseInput, sessionRecall: [{ id: "sc1", chunkText: "User mentioned they were going to the store.", finalScore: 0.8, turnStart: 5, turnEnd: 5, chunkType: "scene_moment" } as unknown as RetrievedSessionMemoryChunk], rerankOutput: { selected: [{ id: "sc1", source: "session_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "tone_guidance" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false } });
    assert.equal(r.items.length, 1, "session chunk");
    assert.match(r.items[0]?.text, /going to the store/, "chunk text");

    // structmem entry
    r = buildRecallThoughtContext({ ...baseInput, structMemEntries: [{ id: "e1", entryType: "decision", turnIndex: 10, text: "User decided to visit next week", finalScore: 0.9 } as RetrievedStructMemEntry], rerankOutput: { selected: [{ id: "e1", source: "structmem_entry", relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false } });
    assert.equal(r.items.length, 1, "structmem");
    assert.match(r.items[0]?.text, /decision/, "structmem entryType");
    assert.match(r.items[0]?.text, /visit next week/, "structmem text");

    // open threads via fallback
    r = buildRecallThoughtContext({ ...baseInput, openThreads: [{ id: "ot1", text: "User promised to call back later", score: 1, sourceTurnIndex: 15 } as RetrievedOpenThread] });
    assert.equal(r.items.length, 1, "open thread");
    assert.equal(r.items[0]?.source, "open_thread", "source");

    // session summary
    r = buildRecallThoughtContext({ ...baseInput, sessionSummary: { summaryText: "Session summary text here" } as any });
    assert.equal(r.items.length, 1, "session summary");
    assert.equal(r.items[0]?.source, "session_summary", "source");

    // memory corrections
    r = buildRecallThoughtContext({ ...baseInput, memoryCorrections: [{ oldClaim: "User was at home", correctedClaim: "User was at work", sourceTurnIndex: 12 }] });
    assert.equal(r.items.length, 1, "memory correction");
    assert.match(r.items[0]?.text, /was at home/, "correction old claim");
    assert.match(r.items[0]?.text, /was at work/, "correction corrected claim");

    // canon scene
    r = buildRecallThoughtContext({ ...baseInput, canonScenes: [{ sceneId: "scene1", units: [{ unitIndex: 1, textContent: "Canon dialogue line", contentType: "dialogue" }] } as any] });
    const canonItems = r.items.filter((i) => i.source === "canon_scene");
    assert.ok(canonItems.length > 0, "canon scene items exist");
    assert.match(canonItems[0]?.text, /Canon dialogue line/, "canon scene text");

    // canon fact with rerank
    const sceneWithFacts = { sceneId: "scene_A", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "Ch1", episodeLabel: "Ep1", sceneTitle: "Test", sceneSummary: "A scene.", units: [], facts: [{ subject: "E", predicate: "loves", object: "F", textForm: "E loves F.", originalFactIndex: 2 } as any], rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } };
    r = buildRecallThoughtContext({ ...baseInput, canonScenes: [sceneWithFacts] as any, rerankOutput: { selected: [{ id: "fact_scene_A_2", source: "canon_fact", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" }], rejected: [], finalContextMode: "memory_and_canon", needsEvidenceFallback: false } });
    const factItems = r.items.filter((i) => i.source === "canon_fact");
    assert.ok(factItems.length > 0, "canon fact items exist");
    assert.ok(factItems.some((i) => i.text.includes("E loves F.")), "canon fact text");
  });

  it("applies private_hint for do_not_mention and tone_only items", () => {
    let r = buildRecallThoughtContext({ ...baseInput, memories: [{ id: "m1", memoryType: "fact", summary: "User has a secret fear of heights", cosineSimilarity: 0.9, importanceScore: 0.8, emotionScore: 0.1 } as RetrievedMemory], rerankOutput: { selected: [{ id: "m1", source: "interactive_memory", relevance: "useful", usageInstruction: "do_not_mention_explicitly", reasonCode: "explicit_recall" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false } });
    assert.equal(r.items[0]?.visibleMode, "private_hint", "private_hint applied");
    assert.doesNotMatch(r.items[0]?.text, /fear of heights/, "text redacted");
    assert.match(r.items[0]?.text, /private continuity reference/, "interactive hint text");

    // session summary with do_not_mention
    r = buildRecallThoughtContext({ ...baseInput, sessionSummary: { summaryText: "Sensitive session content" } as any, rerankOutput: { selected: [{ id: "session_summary", source: "session_summary", relevance: "required", usageInstruction: "do_not_mention_explicitly", reasonCode: "explicit_recall" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false } });
    assert.equal(r.items[0]?.visibleMode, "private_hint", "session_summary private_hint");
    assert.doesNotMatch(r.items[0]?.text, /Sensitive session content/, "session_summary redacted");
    assert.match(r.items[0]?.text, /private continuity reference/, "session_summary hint text");

    // memory_correction with tone_only
    r = buildRecallThoughtContext({ ...baseInput, memoryCorrections: [{ oldClaim: "Was A", correctedClaim: "Is B", sourceTurnIndex: 5 }], rerankOutput: { selected: [{ id: "correction_5", source: "memory_correction", relevance: "useful", usageInstruction: "tone_only", reasonCode: "tone_guidance" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false } });
    assert.equal(r.items[0]?.visibleMode, "private_hint", "correction tone_only");
    assert.doesNotMatch(r.items[0]?.text, /Was A/, "correction redacted");
    assert.match(r.items[0]?.text, /tone guidance/, "correction hint text");
  });

  it("follows rerank order, countsBySource, enforces cap", () => {
    const orderRerank: MemoryRerankOutput = { selected: [{ id: "m2", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "tone_guidance" }, { id: "m1", source: "interactive_memory", relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false };
    const r = buildRecallThoughtContext({ ...baseInput, memories: [{ id: "m1", memoryType: "fact", summary: "First memory", cosineSimilarity: 0.9, importanceScore: 0.8, emotionScore: 0.1 } as RetrievedMemory, { id: "m2", memoryType: "preference", summary: "Second memory", cosineSimilarity: 0.8, importanceScore: 0.7, emotionScore: 0.2 } as RetrievedMemory], rerankOutput: orderRerank });
    assert.equal(r.items.length, 2, "2 items");
    assert.match(r.items[0]?.text, /Second memory/, "rerank order: m2 first");
    assert.match(r.items[1]?.text, /First memory/, "rerank order: m1 second");
    assert.equal(r.countsBySource["interactive_memory"], 2, "countsBySource");
  });

  it("enforces total item cap at RECALL_TOTAL_ITEM_CAP=8", () => {
    const manyMemories = Array.from({ length: 15 }, (_, i) => ({ id: `m${i}`, memoryType: "fact", summary: `Memory ${i}`, cosineSimilarity: 0.9, importanceScore: 0.8, emotionScore: 0.1 })) as RetrievedMemory[];
    const r = buildRecallThoughtContext({ ...baseInput, memories: manyMemories });
    assert.equal(RECALL_TOTAL_ITEM_CAP, 8, "cap constant");
    assert.equal(r.items.length, RECALL_TOTAL_ITEM_CAP, "cap enforced");
  });
});
