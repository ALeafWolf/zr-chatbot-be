/**
 * LangGraph Compatibility Smoke Test
 *
 * Phase 0.5: Proves @langchain/langgraph can be imported, compiled,
 * and invoked in this CommonJS + strict-mode TypeScript backend.
 *
 * Run: npx tsx scripts/dev-run-langgraph-smoke.ts
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import * as z from "zod";

// ---------------------------------------------------------------------------
// Minimal deterministic graph — two nodes, one conditional edge
// ---------------------------------------------------------------------------

const GraphState = z.object({
  input: z.string(),
  reversed: z.string().optional(),
  doubled: z.string().optional(),
});

async function reverseNode(state: z.infer<typeof GraphState>) {
  return { reversed: state.input.split("").reverse().join("") };
}

async function doubleNode(state: z.infer<typeof GraphState>) {
  return { doubled: (state.reversed ?? state.input) + "_twice" };
}

const graph = new StateGraph(GraphState)
  .addNode("reverse", reverseNode)
  .addNode("double", doubleNode)
  .addEdge(START, "reverse")
  .addEdge("reverse", "double")
  .addEdge("double", END)
  .compile();

// ---------------------------------------------------------------------------
// Invoke and validate
// ---------------------------------------------------------------------------

async function main() {
  const { default: assert } = await import("node:assert");

  const result = await graph.invoke({ input: "hello" });

  assert.equal(result.input, "hello");
  assert.equal(result.reversed, "olleh");
  assert.equal(result.doubled, "olleh_twice");

  console.log("=== LangGraph smoke test PASSED ===");
  console.log("Input :", result.input);
  console.log("Step 1 (reversed):", result.reversed);
  console.log("Step 2 (doubled) :", result.doubled);
}

main().catch((err) => {
  console.error("Smoke test FAILED:", err);
  process.exit(1);
});
