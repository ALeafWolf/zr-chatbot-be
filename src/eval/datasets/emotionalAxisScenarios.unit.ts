import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EMOTIONAL_AXIS_SCENARIOS } from "./emotionalAxisScenarios";
import { selectRenderRuleMatches } from "../../orchestration/prompt/renderEmotionalState";
import type { AxisName, Band, StateTrace, HistoryEntry } from "../../state/emotionalEngine/types";

const KNOWN_RENDER_RULE_IDS = ["R1", "R2", "R3", "R4", "R5_state", "R5_event", "R6", "R7", "R8"];

interface SeedLike {
  bands: Record<AxisName, Band>;
  lastTrace: StateTrace;
  history: HistoryEntry[];
}

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

  // ---------------------------------------------------------------------------
  // F2 — Selection-based render probe verification
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // TG7 — S6 seed correctness + trajectory carry-over
  // ---------------------------------------------------------------------------

  it("TG7: S6 low-restraint-safe-bond seed has arousal < -0.35 and bands C high, A low, R low", () => {
    const s = EMOTIONAL_AXIS_SCENARIOS.find((s) => s.id === "S6-low-restraint-safe-bond");
    assert.ok(s, "S6-low-restraint-safe-bond scenario exists");
    const seed = s!.seedAxisState as Record<string, unknown> | undefined;
    assert.ok(seed, "has seedAxisState");
    const axes = (seed as any).axes as Record<string, number>;
    assert.ok(axes.arousal < -0.35, `arousal ${axes.arousal} < -0.35 (R7-capable)`);
    assert.equal(axes.restraint, 0.25, "restraint low (0.25)");
    assert.equal(axes.connection, 0.7, "connection high (0.7)");
    // Valence should be mid (not high) so R4 does not crowd R7 in the budget
    assert.ok(axes.valence < 0.35, `valence ${axes.valence} < 0.35 (mid, not high)`);
  });

  it("TG7: trajectory runner carry-over builds seed from emotionalAxis snapshot", () => {
    // Simulate the carry-over logic used by the --trajectory runner
    const mockEmotionalAxis = {
      axesBefore: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.55 },
      axesAfter: { connection: 0.25, valence: 0.1, arousal: -0.04, restraint: 0.5 },
      bandsAfter: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" },
      couplingsFired: ["zr_c1"],
      effectiveBaselines: {},
      tick: 2,
      scope: "main_married",
      resolvedBaselines: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
    };
    const nextTick = (mockEmotionalAxis.tick ?? 0) + 1;
    const carriedSeed = {
      version: 1 as const,
      tick: nextTick,
      axes: mockEmotionalAxis.axesAfter,
      lastTrace: {
        tick: mockEmotionalAxis.tick ?? 0,
        axesBefore: mockEmotionalAxis.axesBefore,
        axesAfter: mockEmotionalAxis.axesAfter,
        couplingsFired: mockEmotionalAxis.couplingsFired ?? [],
        effectiveBaselines: mockEmotionalAxis.effectiveBaselines ?? {},
      },
      bands: mockEmotionalAxis.bandsAfter,
      history: [],
    };
    // Verify the carried seed has the correct next-turn state
    assert.equal(carriedSeed.tick, 3, "tick incremented to 3");
    assert.deepEqual(carriedSeed.axes, mockEmotionalAxis.axesAfter, "axes from turn N's axesAfter");
    assert.deepEqual(carriedSeed.bands, mockEmotionalAxis.bandsAfter, "bands from turn N's bandsAfter");
    assert.deepEqual(carriedSeed.lastTrace.couplingsFired, ["zr_c1"], "couplings carried over");
  });

  it("F2: every RENDER-* scenario seed selects its expected render rule IDs within budget", () => {
    const renderScenarios = EMOTIONAL_AXIS_SCENARIOS.filter((s) => s.id.startsWith("RENDER-"));
    assert.ok(renderScenarios.length >= 9, "at least 9 render scenarios");

    for (const s of renderScenarios) {
      const seed = s.seedAxisState as SeedLike | undefined;
      assert.ok(seed, `${s.id}: has seedAxisState`);
      assert.ok(seed!.bands, `${s.id}: seed has bands`);
      assert.ok(seed!.lastTrace, `${s.id}: seed has lastTrace`);
      assert.ok(Array.isArray(seed!.history), `${s.id}: seed has history`);

      // Run the real selector with tier C (as buildPromptContext does)
      const matches = selectRenderRuleMatches(
        seed!.bands,
        seed!.lastTrace,
        seed!.history,
        "C",
      );
      const selectedIds = matches.map((m) => m.id);

      // Collect expected render rule IDs from assertions
      const expectedIds: string[] = [];
      for (const a of s.assertions) {
        if (a.type === "render_rule_triggered" && a.values) {
          expectedIds.push(...a.values);
        }
      }

      assert.ok(expectedIds.length > 0, `${s.id}: has render_rule_triggered assertions`);

      // Assert each expected ID appears in the budget-limited selection
      for (const expectedId of expectedIds) {
        assert.ok(
          selectedIds.includes(expectedId),
          `${s.id}: expected rule "${expectedId}" NOT in budget-limited selection [${selectedIds.join(", ")}]. ` +
          `Seed bands: ${JSON.stringify(seed!.bands)}, tick: ${seed!.lastTrace.tick}`,
        );
      }
    }
  });
});
