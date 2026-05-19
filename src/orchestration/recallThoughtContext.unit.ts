import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRecallThoughtContext,
  __testing,
  type RecallThoughtContextItem,
} from "./recallThoughtContext";
import type { MemoryRerankOutput } from "./memoryRerank";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedOpenThread } from "../retrieval/memory/retrieveOpenThreads";

const { buildRerankLookup, visibleModeFor, privateHintText, truncate, RECALL_TOTAL_ITEM_CAP } =
  __testing;

describe("truncate", () => {
  it("returns short strings unchanged", () => {
    assert.equal(truncate("hello", 10), "hello");
  });

  it("truncates long strings with ellipsis", () => {
    const result = truncate("a".repeat(50), 10);
    assert.equal(result.length, 10);
    assert.match(result, /…$/);
  });
});

describe("visibleModeFor", () => {
  it("returns direct for undefined rerankMeta", () => {
    assert.equal(visibleModeFor(undefined), "direct");
  });

  it("returns private_hint for do_not_mention_explicitly", () => {
    assert.equal(
      visibleModeFor({
        id: "m1",
        source: "interactive_memory",
        relevance: "useful",
        usageInstruction: "do_not_mention_explicitly",
        reasonCode: "explicit_recall",
      }),
      "private_hint",
    );
  });

  it("returns private_hint for tone_only", () => {
    assert.equal(
      visibleModeFor({
        id: "m1",
        source: "interactive_memory",
        relevance: "subtle_tone_only",
        usageInstruction: "tone_only",
        reasonCode: "tone_guidance",
      }),
      "private_hint",
    );
  });

  it("returns direct for must_use", () => {
    assert.equal(
      visibleModeFor({
        id: "m1",
        source: "interactive_memory",
        relevance: "required",
        usageInstruction: "must_use",
        reasonCode: "explicit_recall",
      }),
      "direct",
    );
  });
});

describe("privateHintText", () => {
  it("returns private continuity text for do_not_mention_explicitly", () => {
    assert.match(
      privateHintText("do_not_mention_explicitly"),
      /private continuity reference/,
    );
  });

  it("returns tone guidance text for tone_only", () => {
    assert.match(privateHintText("tone_only"), /tone guidance/);
  });
});

describe("buildRerankLookup", () => {
  it("builds ID-to-selected map", () => {
    const rerank: MemoryRerankOutput = {
      selected: [
        {
          id: "m1",
          source: "interactive_memory",
          relevance: "required",
          usageInstruction: "must_use",
          reasonCode: "explicit_recall",
        },
        {
          id: "s1",
          source: "session_chunk",
          relevance: "useful",
          usageInstruction: "use_subtly",
          reasonCode: "user_preference",
        },
      ],
      rejected: [],
      finalContextMode: "selected_memory",
      needsEvidenceFallback: false,
    };
    const map = buildRerankLookup(rerank);
    assert.equal(map.size, 2);
    assert.equal(map.get("m1")?.source, "interactive_memory");
    assert.equal(map.get("s1")?.source, "session_chunk");
    assert.equal(map.get("unknown"), undefined);
  });
});

describe("buildRecallThoughtContext", () => {
  const baseInput = {
    memories: [] as RetrievedMemory[],
    sessionRecall: [] as RetrievedSessionMemoryChunk[],
    structMemEntries: [] as RetrievedStructMemEntry[],
    structMemConsolidations: [],
    openThreads: [],
    canonChunks: [],
    canonScenes: [],
    sessionSummary: null,
    latestTurnDelta: null,
    memoryCorrections: [],
    rerankOutput: null as MemoryRerankOutput | null,
  };

  it("returns empty items when rerank has empty selected", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      rerankOutput: {
        selected: [],
        rejected: [],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 0);
    assert.equal(result.selectionMode, "rerank");
  });

  it("returns empty items when no sources are selected (fallback)", () => {
    const result = buildRecallThoughtContext(baseInput);
    assert.equal(result.items.length, 0);
    assert.equal(result.selectionMode, "fallback");
  });

  it("includes selected interactive memories via rerank path", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memories: [
        {
          id: "m1",
          memoryType: "fact",
          summary: "User likes tea",
          cosineSimilarity: 0.9,
          importanceScore: 0.8,
          emotionScore: 0.1,
        } as RetrievedMemory,
      ],
      rerankOutput: {
        selected: [
          {
            id: "m1",
            source: "interactive_memory",
            relevance: "required",
            usageInstruction: "must_use",
            reasonCode: "explicit_recall",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "interactive_memory");
    assert.equal(result.items[0]?.visibleMode, "direct");
    assert.match(result.items[0]?.text, /User likes tea/);
  });

  it("does not include rejected candidates", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memories: [
        {
          id: "m1",
          memoryType: "fact",
          summary: "User likes tea",
          cosineSimilarity: 0.9,
          importanceScore: 0.8,
          emotionScore: 0.1,
        } as RetrievedMemory,
      ],
      rerankOutput: {
        selected: [],
        rejected: [
          {
            id: "m1",
            source: "interactive_memory",
            reasonCode: "irrelevant",
          },
        ],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 0);
  });

  it("includes selected session chunks via rerank path", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      sessionRecall: [
        {
          id: "sc1",
          chunkText: "User mentioned they were going to the store.",
          finalScore: 0.8,
          turnStart: 5,
          turnEnd: 5,
          chunkType: "scene_moment",
        } as unknown as RetrievedSessionMemoryChunk,
      ],
      rerankOutput: {
        selected: [
          {
            id: "sc1",
            source: "session_chunk",
            relevance: "useful",
            usageInstruction: "use_subtly",
            reasonCode: "tone_guidance",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "session_chunk");
    assert.match(result.items[0]?.text, /going to the store/);
  });

  it("uses private_hint for do_not_mention_explicitly items", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memories: [
        {
          id: "m1",
          memoryType: "fact",
          summary: "User has a secret fear of heights",
          cosineSimilarity: 0.9,
          importanceScore: 0.8,
          emotionScore: 0.1,
        } as RetrievedMemory,
      ],
      rerankOutput: {
        selected: [
          {
            id: "m1",
            source: "interactive_memory",
            relevance: "useful",
            usageInstruction: "do_not_mention_explicitly",
            reasonCode: "explicit_recall",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.visibleMode, "private_hint");
    assert.doesNotMatch(result.items[0]?.text, /fear of heights/);
    assert.match(result.items[0]?.text, /private continuity reference/);
  });

  it("includes structmem entries via rerank path", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      structMemEntries: [
        {
          id: "e1",
          entryType: "decision",
          turnIndex: 10,
          text: "User decided to visit next week",
          finalScore: 0.9,
        } as RetrievedStructMemEntry,
      ],
      rerankOutput: {
        selected: [
          {
            id: "e1",
            source: "structmem_entry",
            relevance: "required",
            usageInstruction: "must_use",
            reasonCode: "explicit_recall",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "structmem_entry");
    assert.match(result.items[0]?.text, /decision/);
    assert.match(result.items[0]?.text, /visit next week/);
  });

  it("includes open threads via fallback path", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      openThreads: [
        {
          id: "ot1",
          text: "User promised to call back later",
          score: 1,
          sourceTurnIndex: 15,
        } as RetrievedOpenThread,
      ],
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "open_thread");
  });

  it("includes session summary when present", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      sessionSummary: { summaryText: "Session summary text here" } as any,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "session_summary");
  });

  it("includes memory corrections when present", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memoryCorrections: [
        {
          oldClaim: "User was at home",
          correctedClaim: "User was at work",
          sourceTurnIndex: 12,
        },
      ],
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.source, "memory_correction");
    assert.match(result.items[0]?.text, /was at home/);
    assert.match(result.items[0]?.text, /was at work/);
  });

  it("includes canon scene excerpts", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      canonScenes: [
        {
          sceneId: "scene1",
          units: [{ unitIndex: 1, textContent: "Canon dialogue line", contentType: "dialogue" }],
        } as any,
      ],
    });
    const canonItems = result.items.filter(
      (i) => i.source === "canon_scene",
    );
    assert.ok(canonItems.length > 0);
    assert.match(canonItems[0]?.text, /Canon dialogue line/);
  });

  it("follows rerank selected order", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memories: [
        {
          id: "m1",
          memoryType: "fact",
          summary: "First memory",
          cosineSimilarity: 0.9,
          importanceScore: 0.8,
          emotionScore: 0.1,
        } as RetrievedMemory,
        {
          id: "m2",
          memoryType: "preference",
          summary: "Second memory",
          cosineSimilarity: 0.8,
          importanceScore: 0.7,
          emotionScore: 0.2,
        } as RetrievedMemory,
      ],
      rerankOutput: {
        selected: [
          {
            id: "m2",
            source: "interactive_memory",
            relevance: "useful",
            usageInstruction: "use_subtly",
            reasonCode: "tone_guidance",
          },
          {
            id: "m1",
            source: "interactive_memory",
            relevance: "required",
            usageInstruction: "must_use",
            reasonCode: "explicit_recall",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 2);
    // Rerank order: m2 first, then m1
    assert.match(result.items[0]?.text, /Second memory/);
    assert.match(result.items[1]?.text, /First memory/);
  });

  it("countsBySource reflects item sources", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memories: [
        {
          id: "m1",
          memoryType: "fact",
          summary: "Memory 1",
          cosineSimilarity: 0.9,
          importanceScore: 0.8,
          emotionScore: 0.1,
        } as RetrievedMemory,
      ],
      openThreads: [
        { id: "ot1", text: "Open thread", score: 1, sourceTurnIndex: 5 } as RetrievedOpenThread,
      ],
      rerankOutput: {
        selected: [
          {
            id: "m1",
            source: "interactive_memory",
            relevance: "required",
            usageInstruction: "must_use",
            reasonCode: "explicit_recall",
          },
          {
            id: "ot1",
            source: "open_thread",
            relevance: "useful",
            usageInstruction: "use_subtly",
            reasonCode: "tone_guidance",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.countsBySource["interactive_memory"], 1);
    assert.equal(result.countsBySource["open_thread"], 1);
  });

  it("applies private_hint for session_summary selected with do_not_mention_explicitly", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      sessionSummary: { summaryText: "Sensitive session content" } as any,
      rerankOutput: {
        selected: [
          {
            id: "session_summary",
            source: "session_summary",
            relevance: "required",
            usageInstruction: "do_not_mention_explicitly",
            reasonCode: "explicit_recall",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.visibleMode, "private_hint");
    assert.doesNotMatch(result.items[0]?.text, /Sensitive session content/);
    assert.match(result.items[0]?.text, /private continuity reference/);
  });

  it("applies private_hint for memory_correction selected with tone_only", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      memoryCorrections: [
        { oldClaim: "Was A", correctedClaim: "Is B", sourceTurnIndex: 5 },
      ],
      rerankOutput: {
        selected: [
          {
            id: "correction_5",
            source: "memory_correction",
            relevance: "useful",
            usageInstruction: "tone_only",
            reasonCode: "tone_guidance",
          },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.visibleMode, "private_hint");
    assert.doesNotMatch(result.items[0]?.text, /Was A/);
    assert.match(result.items[0]?.text, /tone guidance/);
  });

  it("selectionMode is rerank when rerankOutput is present", () => {
    const result = buildRecallThoughtContext({
      ...baseInput,
      rerankOutput: {
        selected: [],
        rejected: [],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      },
    });
    assert.equal(result.selectionMode, "rerank");
  });

  it("selectionMode is fallback when rerankOutput is null", () => {
    const result = buildRecallThoughtContext(baseInput);
    assert.equal(result.selectionMode, "fallback");
  });

  it("enforces total item cap at RECALL_TOTAL_ITEM_CAP", () => {
    const manyMemories = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      memoryType: "fact",
      summary: `Memory ${i}`,
      cosineSimilarity: 0.9,
      importanceScore: 0.8,
      emotionScore: 0.1,
    })) as RetrievedMemory[];
    const result = buildRecallThoughtContext({
      ...baseInput,
      memories: manyMemories,
    });
    assert.equal(RECALL_TOTAL_ITEM_CAP, 8);
    assert.equal(result.items.length, RECALL_TOTAL_ITEM_CAP);
  });
});
