/**
 * Self-checks for structural span parsing (no LLM). Run:
 *   npx tsx src/retrieval/structuralParse.fixtures.ts
 */
import assert from "node:assert/strict";
import { parseStructuralSpans } from "./userMessageStructuralParse";

function run() {
  const a = parseStructuralSpans("（心想）你好啊");
  assert.equal(a.ok, true);
  assert.equal(a.spans.length, 2);
  assert.equal(a.spans[0]!.structuralKind, "paren");
  assert.equal(a.spans[1]!.structuralKind, "plain");

  const b = parseStructuralSpans("前段【请温柔回复】后段");
  assert.equal(b.ok, true);
  assert.equal(b.spans[1]!.structuralKind, "square_meta");

  const c = parseStructuralSpans("A（B）C（D");
  assert.equal(c.ok, false);

  const d = parseStructuralSpans("plain only");
  assert.equal(d.ok, true);
  assert.equal(d.spans.length, 1);
  assert.equal(d.spans[0]!.structuralKind, "plain");

  console.log("structuralParse.fixtures: OK");
}

run();
