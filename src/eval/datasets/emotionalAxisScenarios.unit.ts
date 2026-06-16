import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMOTIONAL_AXIS_SCENARIOS } from "./emotionalAxisScenarios";

const KNOWN_RENDER_RULE_IDS = ["R1", "R2", "R3", "R4", "R5_state", "R5_event", "R6", "R7", "R8"];

describe("emotionalAxisScenarios — TG4", () => {
  it("exports scenarios", () => {
    assert.ok(Array.isArray(EMOTIONAL_AXIS_SCENARIOS), "scenarios array");
    assert.ok(EMOTIONAL_AXIS_SCENARIOS.length > 0, "non-empty");
  });

  it("all scenarios have agent_turn eval_mode", () => {
    for (const s of EMOTIONAL_AXIS_SCENARIOS) {
      assert.equal(s.eval_mode, "agent_turn", `${s.id} eval_mode`);
    }
  });

  it("render rule probes cover all 9 known rule IDs", () => {
    const renderScenarios = EMOTIONAL_AXIS_SCENARIOS.filter((s) => s.id.startsWith("RENDER-"));
    const coveredIds = new Set<string>();
    for (const s of renderScenarios) {
      for (const a of s.assertions) {
        if (a.type === "render_rule_triggered" && a.values) {
          for (const v of a.values) {
            coveredIds.add(v);
          }
        }
      }
    }
    const missing = KNOWN_RENDER_RULE_IDS.filter((id) => !coveredIds.has(id));
    assert.equal(
      missing.length,
      0,
      `Render probes missing for: ${missing.join(", ") || "none"}`,
    );
  });

  it("all render rule probes use neutral user messages (seeded triggers)", () => {
    const renderScenarios = EMOTIONAL_AXIS_SCENARIOS.filter((s) => s.id.startsWith("RENDER-"));
    for (const s of renderScenarios) {
      const msg = s.messages?.[0]?.content ?? "";
      assert.ok(
        msg.includes("今天天气不错"),
        `${s.id}: render probes should use neutral messages, got "${msg}"`,
      );
    }
  });

  it("all render rule probes have seedAxisState", () => {
    const renderScenarios = EMOTIONAL_AXIS_SCENARIOS.filter((s) => s.id.startsWith("RENDER-"));
    for (const s of renderScenarios) {
      assert.ok(s.seedAxisState, `${s.id} has seedAxisState`);
    }
  });

  it("all seedAxisState entries have valid lastTrace", () => {
    for (const s of EMOTIONAL_AXIS_SCENARIOS) {
      if (!s.seedAxisState) continue;
      const seed = s.seedAxisState as Record<string, unknown>;
      const lastTrace = seed.lastTrace as Record<string, unknown> | undefined;
      assert.ok(lastTrace, `${s.id}: seed has lastTrace`);
      assert.ok(Array.isArray(lastTrace?.couplingsFired), `${s.id}: lastTrace.couplingsFired array`);
    }
  });
});
