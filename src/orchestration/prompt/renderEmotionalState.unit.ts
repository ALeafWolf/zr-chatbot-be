import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectRenderRules, formatBandLine, buildTierABlock, buildEmotionalRenderBlock } from "./renderEmotionalState";
import type { AxisName, Band, StateTrace, HistoryEntry } from "../../state/emotionalEngine/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTrace(overrides?: Partial<StateTrace>): StateTrace {
  return {
    tick: 1,
    axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    couplingsFired: [],
    effectiveBaselines: {},
    conditionTransitions: undefined,
    ...overrides,
  };
}

function makeBands(b: Partial<Record<AxisName, Band>> = {}): Record<AxisName, Band> {
  return { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid", ...b };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatBandLine", () => {
  it("formats the fixed-format band line correctly", () => {
    const bands: Record<AxisName, Band> = { connection: "high", valence: "mid", arousal: "low", restraint: "high" };
    const line = formatBandLine(bands);
    assert.equal(line, "当前状态：克制：偏高｜亲近：偏高｜情绪：中｜唤起：偏低");
  });

  it("handles all mid bands", () => {
    const bands: Record<AxisName, Band> = { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" };
    assert.equal(formatBandLine(bands), "当前状态：克制：中｜亲近：中｜情绪：中｜唤起：中");
  });
});

describe("selectRenderRules — TG4 Tier A", () => {

  it("returns R1 when C high && R low (Tier A)", () => {
    const bands = makeBands({ connection: "high", restraint: "low" });
    const result = selectRenderRules(bands, makeTrace(), [], "A");
    assert.equal(result.length, 1, "R1 fires");
    assert.ok(result[0].includes("放松改变的是温度"), "R1 text present");
  });

  it("returns empty when C high && R not low (Tier A)", () => {
    const bands = makeBands({ connection: "high", restraint: "high" });
    const result = selectRenderRules(bands, makeTrace(), [], "A");
    assert.equal(result.length, 0, "no rules fire");
  });

  it("returns empty when R low && C not high (Tier A)", () => {
    const bands = makeBands({ connection: "mid", restraint: "low" });
    const result = selectRenderRules(bands, makeTrace(), [], "A");
    assert.equal(result.length, 0, "no rules fire");
  });

  it("enforces budget ≤ 2 even with multiple matches (simulating Tier B)", () => {
    const bands = makeBands({ connection: "high", restraint: "low", arousal: "high" });
    // In Tier B, R1 (pri 0), R3 (pri 1), R7 (pri 2) all match — only 2 should return
    const result = selectRenderRules(bands, makeTrace(), [], "B");
    assert.ok(result.length <= 2, "at most 2 rules returned");
  });

  it("tie-break: trace-triggered beats pure-state at equal priority", () => {
    // R2 (trace, pri 1) and R3 (pure, pri 1) both match at Tier B
    const bands = makeBands({ arousal: "high", restraint: "high" });
    const trace = makeTrace({ couplingsFired: ["zr_c3"] });
    const result = selectRenderRules(bands, trace, [], "B");
    // R1 at pri 0 fires first, then R2 (trace-triggered, pri 1) should beat R3 (pure, pri 1)
    assert.ok(result.length >= 1, "at least R1 fires");
    // R2 text should appear before R3 text (or R2 replaces R3)
    const r2Idx = result.findIndex((t) => t.includes("他刚刚收回去了"));
    const r3Idx = result.findIndex((t) => t.includes("克制不是停止"));
    if (r2Idx !== -1 && r3Idx !== -1) {
      assert.ok(r2Idx < r3Idx, "R2 (trace) before R3 (pure) at same priority");
    }
  });
});

describe("buildTierABlock", () => {
  it("returns band line only when R1 does not fire", () => {
    const bands = makeBands({ connection: "high", restraint: "high" });
    const block = buildTierABlock(bands);
    assert.ok(block.includes("当前状态"), "band line present");
    assert.ok(!block.includes("放松改变的是温度"), "R1 not present");
  });

  it("returns band line + R1 text when C high && R low", () => {
    const bands = makeBands({ connection: "high", restraint: "low" });
    const block = buildTierABlock(bands);
    assert.ok(block.includes("当前状态"), "band line present");
    assert.ok(block.includes("放松改变的是温度"), "R1 text present");
  });
});

describe("selectRenderRules — TG7 Tier B", () => {
  const traceWithZR_C3 = makeTrace({ couplingsFired: ["zr_c3"] });
  const traceWithZR_C2Snapback = makeTrace({
    conditionTransitions: [{ id: "zr_c2", from: true, to: false }],
  });
  const traceWithActiveBaselineShift = makeTrace({
    effectiveBaselines: { restraint: 0.44 },
    conditionTransitions: undefined,
  });

  it("R2 arm 1: couplingsFired includes zr_c3 → R2 fires", () => {
    const result = selectRenderRules(makeBands(), traceWithZR_C3, [], "B");
    assert.ok(result.some(t => t.includes("他刚刚收回去了")), "R2 fires when zr_c3 in couplingsFired");
  });

  it("R2 arm 2: zr_c2 condition satisfied→unsatisfied → R2 fires", () => {
    const result = selectRenderRules(makeBands(), traceWithZR_C2Snapback, [], "B");
    assert.ok(result.some(t => t.includes("他刚刚收回去了")), "R2 fires on zr_c2 condition flip");
  });

  it("R2 does NOT fire from active effectiveBaselines alone (must be condition flip)", () => {
    // trace has effectiveBaselines.restraint shift but no conditionTransitions
    const result = selectRenderRules(makeBands(), traceWithActiveBaselineShift, [], "B");
    assert.ok(!result.some(t => t.includes("他刚刚收回去了")), "R2 not fires from active shift alone");
  });

  it("R2 does NOT fire when neither arm triggers", () => {
    const result = selectRenderRules(makeBands(), makeTrace(), [], "B");
    assert.ok(!result.some(t => t.includes("他刚刚收回去了")), "R2 not fires without trigger");
  });

  it("R3: fires when A high && R high", () => {
    const bands = makeBands({ arousal: "high", restraint: "high" });
    const result = selectRenderRules(bands, makeTrace(), [], "B");
    assert.ok(result.some(t => t.includes("克制不是停止")), "R3 fires when A high && R high");
  });

  it("R4: fires when C high && V high && A low", () => {
    const bands = makeBands({ connection: "high", valence: "high", arousal: "low" });
    const result = selectRenderRules(bands, makeTrace(), [], "B");
    assert.ok(result.some(t => t.includes("柔软从安排里漏出来")), "R4 fires");
  });

  it("R7: fires when C high && R low && A low", () => {
    const bands = makeBands({ connection: "high", restraint: "low", arousal: "low" });
    const result = selectRenderRules(bands, makeTrace(), [], "B");
    assert.ok(result.some(t => t.includes("这是他极少数会说出直接的话")), "R7 fires");
  });

  it("R5_state: fires when connection falling ≥2 ticks", () => {
    const history = [
      { tick: 1, axes: { connection: 0.7, valence: 0, arousal: 0, restraint: 0.7 } },
      { tick: 2, axes: { connection: 0.5, valence: 0, arousal: 0, restraint: 0.7 } },
    ];
    const result = selectRenderRules(makeBands(), makeTrace(), history, "B");
    assert.ok(result.some(t => t.includes("他不用语言追")), "R5 fires on 2-tick falling streak");
  });

  it("R5_state: does not fire when connection rising", () => {
    const history = [
      { tick: 1, axes: { connection: 0.3, valence: 0, arousal: 0, restraint: 0.7 } },
      { tick: 2, axes: { connection: 0.5, valence: 0, arousal: 0, restraint: 0.7 } },
    ];
    const result = selectRenderRules(makeBands(), makeTrace(), history, "B");
    assert.ok(!result.some(t => t.includes("他不用语言追")), "R5 not fires on rising connection");
  });

  it("R7 + R1 co-fire uses exactly budget (2 rules)", () => {
    // R1: C high && R low; R7: C high && R low && A low
    const bands = makeBands({ connection: "high", restraint: "low", arousal: "low" });
    const result = selectRenderRules(bands, makeTrace(), [], "B");
    // R1 (pri 0) and R7 (pri 2) both fire, R1 higher priority
    assert.equal(result.length, 2, "exactly 2 rules (R1 + R7) within budget");
  });
});

describe("selectRenderRules — TG8 Tier C", () => {
  it("R5_event: fires on user_withdraws event", () => {
    const trace = makeTrace({
      event: { type: 'user_withdraws', intensity: 0.7, reason: 'User pulled back' },
    });
    const result = selectRenderRules(makeBands(), trace, [], "C");
    assert.ok(result.some(t => t.includes("距离感不需要解释")), "R5_event fires on user_withdraws");
  });

  it("R5_event: fires on tension_escalation event", () => {
    const trace = makeTrace({
      event: { type: 'tension_escalation', intensity: 0.6, reason: 'Tension rose' },
    });
    const result = selectRenderRules(makeBands(), trace, [], "C");
    assert.ok(result.some(t => t.includes("距离感不需要解释")), "R5_event fires on tension_escalation");
  });

  it("R5_event: does not fire without event in trace", () => {
    const result = selectRenderRules(makeBands(), makeTrace(), [], "C");
    assert.ok(!result.some(t => t.includes("距离感不需要解释")), "R5_event not fires when no event");
  });

  it("R5_event: does not fire on unrelated event type", () => {
    const trace = makeTrace({
      event: { type: 'intimate_moment', intensity: 0.8, reason: 'Close moment' },
    });
    const result = selectRenderRules(makeBands(), trace, [], "C");
    assert.ok(!result.some(t => t.includes("距离感不需要解释")), "R5_event not fires on intimate_moment");
  });

  it("R6: fires on user_discloses_vulnerability event", () => {
    const trace = makeTrace({
      event: { type: 'user_discloses_vulnerability', intensity: 0.7, reason: 'User shared' },
    });
    const result = selectRenderRules(makeBands(), trace, [], "C");
    assert.ok(result.some(t => t.includes("他接收到了")), "R6 fires on disclosure");
  });

  it("R6: fires on user_shows_warmth event", () => {
    const trace = makeTrace({
      event: { type: 'user_shows_warmth', intensity: 0.6, reason: 'User was warm' },
    });
    const result = selectRenderRules(makeBands(), trace, [], "C");
    assert.ok(result.some(t => t.includes("他接收到了")), "R6 fires on warmth");
  });

  it("R8: fires on intimate_moment event with highest priority", () => {
    const trace = makeTrace({
      event: { type: 'intimate_moment', intensity: 1.0, reason: 'Shared intimacy' },
    });
    const result = selectRenderRules(makeBands(), trace, [], "C");
    assert.ok(result.some(t => t.includes("他不舍得用语言")), "R8 fires on intimate_moment");
  });

  it("R8: is highest priority and appears first in result", () => {
    // R8 (pri 0) + R1 (pri 0) — R8 is trace-triggered so wins tie-break
    const bands = makeBands({ connection: "high", restraint: "low" });
    const trace = makeTrace({
      event: { type: 'intimate_moment', intensity: 0.9, reason: 'Intimate' },
    });
    const result = selectRenderRules(bands, trace, [], "C");
    // R8 should be first due to trace-triggered tie-break at same priority
    const r8Idx = result.findIndex((t) => t.includes("他不舍得用语言"));
    const r1Idx = result.findIndex((t) => t.includes("放松改变的是温度"));
    if (r8Idx !== -1 && r1Idx !== -1) {
      assert.ok(r8Idx < r1Idx, "R8 (trace) before R1 (pure) at same priority");
    }
  });

  it("budget still enforced at Tier C with event rules", () => {
    // R8 (trace pri 0) + R1 (pure pri 0) + R5_event (trace pri 1) all possible
    // But budget is 2, so must be ≤ 2
    const bands = makeBands({ connection: "high", restraint: "low" });
    const trace = makeTrace({
      event: { type: 'user_withdraws', intensity: 0.7, reason: 'Withdrew' },
    });
    const result = selectRenderRules(bands, trace, [], "C");
    assert.ok(result.length <= 2, "budget ≤ 2 at Tier C");
  });
});

describe("buildEmotionalRenderBlock — Tier A (F10)", () => {
  it("returns block with band line even when no rules fire (Tier A always emits band line)", () => {
    const bands = makeBands({ connection: "mid", restraint: "mid" });
    const result = buildEmotionalRenderBlock(bands, makeTrace(), [], "A");
    assert.ok(result !== null, "Tier A always returns a block");
    assert.ok(result.includes("当前状态"), "band line present");
    assert.ok(!result.includes("放松改变的是温度"), "R1 not present when C not high || R not low");
  });

  it("returns block with band line AND R1 when C high && R low", () => {
    const bands = makeBands({ connection: "high", restraint: "low" });
    const result = buildEmotionalRenderBlock(bands, makeTrace(), [], "A");
    assert.ok(result !== null, "block returned");
    assert.ok(result.includes("当前状态下的行为基调"), "header present");
    assert.ok(result.includes("当前状态"), "band line present");
    assert.ok(result.includes("放松改变的是温度"), "R1 text present");
  });

  it("returns band line for non-A tiers when no rules fire", () => {
    const bands = makeBands({ connection: "mid", restraint: "mid" });
    // Tier 'B' has no rule that fires with all-mid bands, but band line is always emitted
    const result = buildEmotionalRenderBlock(bands, makeTrace(), [], "B");
    assert.ok(result !== null, "Tier B always returns a block (band line)");
    assert.ok(result!.includes("当前状态"), "band line present even when no rules fire");
  });

  it("Tier C: band line + R8 rule text for intimate_moment", () => {
    const bands = makeBands({ connection: "mid", restraint: "mid" });
    const trace = makeTrace({
      event: { type: 'intimate_moment', intensity: 0.9, reason: 'Intimate' },
    });
    const result = buildEmotionalRenderBlock(bands, trace, [], "C");
    assert.ok(result !== null, "Tier C returns block");
    assert.ok(result!.includes("当前状态下的行为基调"), "header present");
    assert.ok(result!.includes("当前状态"), "band line present");
    assert.ok(result!.includes("他不舍得用语言"), "R8 text present at Tier C");
  });
});
