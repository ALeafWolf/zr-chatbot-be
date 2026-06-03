import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRetrievalQueryTexts } from "./retrievalQueryTexts";
import type { QueryRewriteResult } from "./rewriteQuery";

function query(overrides: Partial<QueryRewriteResult>): QueryRewriteResult {
  return {
    segments: [],
    combined_for_embedding: "",
    entities: [],
    intent: "general",
    confidence: 0.9,
    structuralParseOk: true,
    labelOk: true,
    parseOk: true,
    ...overrides,
  };
}

const OPTIONS = { annotationFallback: false, confidenceThreshold: 0.6 };

describe("buildRetrievalQueryTexts", () => {
  it("routes lanes into memory/canon text and toggles raw memory fusion by confidence/parse", () => {
    type Result = ReturnType<typeof buildRetrievalQueryTexts>;
    const cases: {
      name: string;
      userMessage: string;
      queryRewrite: QueryRewriteResult;
      check: (r: Result) => void;
    }[] = [
      {
        name: "routes speech/action/thought into memory query",
        userMessage: "raw",
        queryRewrite: query({
          segments: [
            { lane: "user_speech", text: "hello" },
            { lane: "user_action", text: "waves" },
            { lane: "user_thought", text: "nervous" },
          ],
        }),
        check: (r) => assert.equal(r.memoryText, "hello\nwaves\nnervous", "speech/action/thought — memoryText"),
      },
      {
        name: "omits reply direction when other memory text exists",
        userMessage: "raw fallback",
        queryRewrite: query({
          segments: [
            { lane: "reply_direction", text: "be romantic" },
            { lane: "user_speech", text: "remember this" },
          ],
        }),
        check: (r) => {
          assert.equal(r.memoryText, "remember this", "with speech — memoryText");
          assert.equal(r.canonText, "remember this", "with speech — canonText");
        },
      },
      {
        name: "keeps reply direction when it is the only memory text",
        userMessage: "[be romantic]",
        queryRewrite: query({ segments: [{ lane: "reply_direction", text: "be romantic" }] }),
        check: (r) => assert.equal(r.memoryText, "[be romantic]", "only direction — memoryText"),
      },
      {
        name: "low confidence → fuse raw memory",
        userMessage: "raw",
        queryRewrite: query({ confidence: 0.2, segments: [{ lane: "user_speech", text: "rewritten" }] }),
        check: (r) => assert.equal(r.shouldFuseRawMemory, true, "low confidence — fuse"),
      },
      {
        name: "failed parse → fuse raw memory",
        userMessage: "raw",
        queryRewrite: query({ parseOk: false }),
        check: (r) => assert.equal(r.shouldFuseRawMemory, true, "failed parse — fuse"),
      },
      {
        name: "high confidence → single-query (no fusion)",
        userMessage: "raw",
        queryRewrite: query({ confidence: 0.95, segments: [{ lane: "user_speech", text: "rewritten" }] }),
        check: (r) => assert.equal(r.shouldFuseRawMemory, false, "high confidence — no fuse"),
      },
    ];

    for (const c of cases) {
      c.check(buildRetrievalQueryTexts({ userMessage: c.userMessage, queryRewrite: c.queryRewrite, options: OPTIONS }));
    }
  });
});
