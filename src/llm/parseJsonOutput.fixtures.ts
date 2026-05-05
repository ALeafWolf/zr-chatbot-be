/**
 * Lightweight fixtures for parseJsonOutput; run via:
 * npx tsx src/llm/parseJsonOutput.fixtures.ts
 */
import { parseJsonOutput } from "./parseJsonOutput";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(msg);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

try {
  // Plain JSON object
  {
    const r = parseJsonOutput('{"hello":1}');
    assert(r.ok && (r.data as { hello: number }).hello === 1, "plain object");
  }

  // Fenced ```json … ```
  {
    const r = parseJsonOutput('```json\n{"x":true}\n```');
    assert(r.ok && (r.data as { x: boolean }).x === true, "fenced json");
  }

  // Preamble + trailing commentary
  {
    const r = parseJsonOutput(
      'Here is the result:\n\n{"done":false}\n\nHope this helps.',
    );
    assert(r.ok && (r.data as { done: boolean }).done === false, "preamble + suffix");
  }

  // Array root (extractor-compatible shape)
  {
    const r = parseJsonOutput('prefix [1,2] suffix');
    assert(
      r.ok && Array.isArray(r.data) && (r.data as number[]).length === 2,
      "array root",
    );
  }

  // Truncated — must fail cleanly
  {
    const r = parseJsonOutput('{"unfinished":');
    assert(!r.ok, "truncated should fail");
  }

  // Mismatched brackets — must fail
  {
    const r = parseJsonOutput("{ invalid }");
    assert(!r.ok, "invalid should fail");
  }

  console.log("parseJsonOutput fixtures: OK");
} catch (e) {
  console.error(e);
  process.exit(1);
}
