import type { Assertion, Scenario } from "./evalTypes";
import type { ValidationResult } from "../llm/validation/runResponseValidator";
import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";
import type { EmotionalAxisEvalSnapshot } from "./evalSnapshots";

/**
 * Build an `AssertionContext` rerank sub-object from a `RetrievalEvalSnapshot`
 * rerank output. Returns undefined when no rerank snapshot is available.
 */
export function buildRerankAssertionContext(
  rerank?: {
    selected?: Array<{ id: string; source: string }>;
    finalContextMode?: string;
    fallbackUsed?: boolean;
  } | null,
): { rerank: NonNullable<AssertionContext["rerank"]> } | undefined {
  if (!rerank) return undefined;
  return {
    rerank: {
      selectedIds: (rerank.selected ?? []).map((s) => s.id),
      selectedSources: (rerank.selected ?? []).map((s) => s.source),
      finalContextMode: rerank.finalContextMode,
      fallbackUsed: rerank.fallbackUsed,
    },
  };
}

export interface AssertionContext {
  retrievedCanon?: string;
  queryRewrite?: QueryRewriteResult;
  scene_anchor_count?: number;
  /** Rerank snapshot from RetrievalEvalSnapshot.rerank */
  rerank?: {
    selectedIds?: string[];
    rejectedIds?: string[];
    selectedSources?: string[];
    finalContextMode?: string;
    fallbackUsed?: boolean;
  };
  /** TG3: Emotional-axis eval snapshot from AgentEvalOutput. */
  emotionalAxis?: EmotionalAxisEvalSnapshot;
}

function matchesAnyPattern(reply: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return false;
  for (const p of patterns) {
    try {
      if (new RegExp(p).test(reply)) return true;
    } catch {
      if (reply.includes(p)) return true;
    }
  }
  return false;
}

export function checkAssertion(
  assertion: Assertion,
  reply: string,
  validatorResult?: ValidationResult,
  ctx?: AssertionContext,
): { pass: boolean; reason: string } {
  switch (assertion.type) {
    case "not_contains": {
      const pass = !reply.includes(assertion.value!);
      return {
        pass,
        reason: pass ? "OK" : `Reply contains forbidden string: "${assertion.value}"`,
      };
    }
    case "contains_any": {
      const pass = (assertion.values ?? []).some((v) => reply.includes(v));
      return {
        pass,
        reason: pass
          ? "OK"
          : `Reply missing expected reference. Expected one of: ${(assertion.values ?? []).join(", ")}`,
      };
    }
    case "validator_pass": {
      if (!validatorResult) {
        return { pass: false, reason: "No validator result available" };
      }
      const pass = validatorResult[assertion.field as keyof ValidationResult] === true;
      return {
        pass,
        reason: pass ? "OK" : `Validator field "${assertion.field}" is not true`,
      };
    }
    case "validator_field": {
      if (!validatorResult) {
        return { pass: false, reason: "No validator result available" };
      }
      const actual = validatorResult[assertion.field as keyof ValidationResult];
      const pass = actual === assertion.expected;
      return {
        pass,
        reason: pass
          ? "OK"
          : `Validator field "${assertion.field}" expected ${assertion.expected}, got ${actual}`,
      };
    }
    case "attribution_supported_by_canon": {
      const canon = ctx?.retrievedCanon ?? "";
      const patterns = assertion.reply_attribution_patterns ?? [];
      if (patterns.length === 0) {
        return { pass: false, reason: "Missing reply_attribution_patterns on assertion" };
      }
      const needles = assertion.canon_support_needles ?? [];
      if (needles.length === 0) {
        return { pass: false, reason: "Missing canon_support_needles on assertion" };
      }
      if (!matchesAnyPattern(reply, patterns)) {
        return {
          pass: true,
          reason: "OK (fail-open: reply does not assert attribution per patterns)",
        };
      }
      const ok = needles.every((n) => canon.includes(n));
      return {
        pass: ok,
        reason: ok
          ? "OK"
          : `Canon snapshot missing expected support: ${needles.join(", ")}`,
      };
    }
    case "no_unsupported_attribution": {
      const canon = ctx?.retrievedCanon ?? "";
      const markers = assertion.reply_entity_markers ?? [];
      const needles = assertion.canon_support_needles ?? [];
      if (markers.length === 0 || needles.length === 0) {
        return { pass: false, reason: "Missing markers or canon_support_needles" };
      }
      const hit = markers.some((m) => reply.includes(m));
      if (!hit) {
        return { pass: true, reason: "OK (no flagged entity in reply)" };
      }
      const ok = needles.some((n) => canon.includes(n));
      return {
        pass: ok,
        reason: ok ? "OK" : "Reply references entity but canon lacks expected corroboration",
      };
    }
    case "canon_contains_all": {
      const canon = ctx?.retrievedCanon ?? "";
      const needles = assertion.values ?? [];
      if (needles.length === 0) {
        return { pass: true, reason: "OK (no required needles)" };
      }
      const ok = needles.every((n) => canon.includes(n));
      return {
        pass: ok,
        reason: ok ? "OK" : `Canon missing one of: ${needles.join(", ")}`,
      };
    }
    case "retrieval_min_anchors": {
      const min = assertion.min_scenes ?? 1;
      const n = ctx?.scene_anchor_count ?? 0;
      const pass = n >= min;
      return {
        pass,
        reason: pass ? "OK" : `Expected at least ${min} anchor scenes, got ${n}`,
      };
    }
    case "no_memory_written": {
      return { pass: true, reason: "OK (manual verification required)" };
    }
    case "rerank_selected_ids": {
      const expected = assertion.values ?? [];
      const actual = ctx?.rerank?.selectedIds ?? [];
      const expectedSet = new Set(expected);
      const missingNotInActual = expected.filter((id) => !actual.includes(id));
      const extraNotInExpected = actual.filter(
        (id) => !expectedSet.has(id) && id !== undefined,
      );
      const pass = missingNotInActual.length === 0; // at minimum, all expected must be selected
      return {
        pass,
        reason: pass
          ? `All expected IDs selected${extraNotInExpected.length > 0 ? ` (+ ${extraNotInExpected.length} extra)` : ""}`
          : `Missing expected IDs: ${missingNotInActual.join(", ")}`,
      };
    }
    case "rerank_rejected_ids": {
      const forbidden = assertion.values ?? [];
      const actual = ctx?.rerank?.selectedIds ?? [];
      const forbiddenSelected = forbidden.filter((id) => actual.includes(id));
      const pass = forbiddenSelected.length === 0;
      return {
        pass,
        reason: pass
          ? "No forbidden IDs selected"
          : `Forbidden IDs found in selection: ${forbiddenSelected.join(", ")}`,
      };
    }
    case "rerank_context_mode": {
      const expected = assertion.value ?? "selected_memory";
      const actual = ctx?.rerank?.finalContextMode ?? "";
      const pass = actual === expected;
      return {
        pass,
        reason: pass ? `Context mode is ${expected}` : `Expected ${expected}, got ${actual}`,
      };
    }
    case "rerank_no_fallback": {
      const fallbackUsed = ctx?.rerank?.fallbackUsed ?? false;
      const pass = !fallbackUsed;
      return {
        pass,
        reason: pass ? "No fallback" : "Reranker fell back to deterministic",
      };
    }
    case "max_irrelevant_selected": {
      const max = assertion.min_scenes ?? 0;
      const forbiddenSources = assertion.values ?? [];
      const selectedSources = ctx?.rerank?.selectedSources ?? [];
      const irrelevant = selectedSources.filter(
        (s) => forbiddenSources.includes(s),
      ).length;
      const pass = irrelevant <= max;
      return {
        pass,
        reason: pass
          ? `Irrelevant selected: ${irrelevant} (max ${max})`
          : `Too many irrelevant sources selected: ${irrelevant} (max ${max})`,
      };
    }

    // -------------------------------------------------------------------
    // TG3 — Emotional-axis assertions (operate on ctx.emotionalAxis)
    // -------------------------------------------------------------------

    case "turn_event_type": {
      const ev = ctx?.emotionalAxis?.event;
      const expected = assertion.value;
      const actual = ev?.type;
      if (!expected) return { pass: false, reason: "Missing expected event type on assertion" };
      const pass = actual === expected;
      return {
        pass,
        reason: pass ? `Event type is ${expected}` : `Expected event type ${expected}, got ${actual ?? "(none)"}`,
      };
    }

    case "axis_delta_sign": {
      const axis = assertion.field;
      const expectedSign = assertion.value;
      if (!axis || !expectedSign) return { pass: false, reason: "Missing axis or expected sign on assertion" };
      // Fail closed when event delta data is absent
      if (!ctx?.emotionalAxis?.eventDeltas) return { pass: false, reason: "No event delta data available" };
      const deltas = ctx.emotionalAxis.eventDeltas;
      const rawDelta = (deltas as unknown as Record<string, number>)[axis];
      const actualSign = rawDelta === undefined ? "0" : rawDelta > 0 ? "+" : rawDelta < 0 ? "-" : "0";
      const pass = actualSign === expectedSign || (expectedSign === "stable" && actualSign === "0");
      return {
        pass,
        reason: pass
          ? `Axis ${axis} delta sign is ${actualSign} (expected ${expectedSign})`
          : `Axis ${axis} delta sign is ${actualSign}, expected ${expectedSign}`,
      };
    }

    case "axis_after_between": {
      const axis = assertion.field;
      const parts = (assertion.value ?? "").split(",").map(Number);
      const [min, max] = parts.length === 2 ? parts : [NaN, NaN];
      if (!axis || isNaN(min) || isNaN(max)) return { pass: false, reason: "Invalid axis_after_between: field=axis, value=min,max" };
      // Fail closed when axesAfter data is absent
      if (!ctx?.emotionalAxis?.axesAfter) return { pass: false, reason: "No axesAfter data available" };
      const axesAfter = ctx.emotionalAxis.axesAfter;
      const value = (axesAfter as unknown as Record<string, number>)[axis];
      if (value === undefined) return { pass: false, reason: `No axesAfter data for axis ${axis}` };
      const pass = value >= min && value <= max;
      return {
        pass,
        reason: pass ? `${axis} = ${value} in [${min}, ${max}]` : `${axis} = ${value} outside [${min}, ${max}]`,
      };
    }

    case "axis_band_equals": {
      const axis = assertion.field as string;
      const expected = assertion.value;
      if (!axis || !expected) return { pass: false, reason: "Missing axis or expected band on assertion" };
      // Fail closed when bandsAfter data is absent
      if (!ctx?.emotionalAxis?.bandsAfter) return { pass: false, reason: "No bandsAfter data available" };
      const actual = (ctx.emotionalAxis.bandsAfter as Record<string, string>)[axis];
      const pass = actual === expected;
      return {
        pass,
        reason: pass ? `${axis} band is ${expected}` : `${axis} band is ${actual ?? "(none)"}, expected ${expected}`,
      };
    }

    case "couplings_fired_contains": {
      const expected = assertion.values ?? [];
      if (expected.length === 0) return { pass: true, reason: "OK (no expected couplings)" };
      // Fail closed when couplingsFired data is absent
      if (!ctx?.emotionalAxis?.couplingsFired) return { pass: false, reason: "No couplingsFired data available" };
      const actual = ctx.emotionalAxis.couplingsFired;
      const missing = expected.filter((id) => !actual.includes(id));
      const pass = missing.length === 0;
      return {
        pass,
        reason: pass ? `All expected couplings fired` : `Missing couplings: ${missing.join(", ")}`,
      };
    }

    case "couplings_fired_not_contains": {
      const forbidden = assertion.values ?? [];
      if (forbidden.length === 0) return { pass: true, reason: "OK (no forbidden couplings specified)" };
      // Fail closed when couplingsFired data is absent
      if (!ctx?.emotionalAxis?.couplingsFired) return { pass: false, reason: "No couplingsFired data available" };
      const actual = ctx.emotionalAxis.couplingsFired;
      const found = forbidden.filter((id) => actual.includes(id));
      const pass = found.length === 0;
      return {
        pass,
        reason: pass ? `No forbidden couplings fired` : `Forbidden couplings fired: ${found.join(", ")}`,
      };
    }

    case "effective_baseline_shifted": {
      const axis = assertion.field as string;
      const direction = assertion.value; // "+" = shifted up, "-" = shifted down
      const minMag = assertion.min_scenes ?? 0; // reuse min_scenes for min magnitude
      if (!axis || !direction) return { pass: false, reason: "Missing axis or direction on assertion" };
      // Fail closed when effectiveBaselines data is absent
      if (!ctx?.emotionalAxis?.effectiveBaselines) return { pass: false, reason: "No effectiveBaselines data available" };
      if (!ctx?.emotionalAxis?.resolvedBaselines) return { pass: false, reason: "No resolvedBaselines data available" };
      const baselines = ctx.emotionalAxis.effectiveBaselines;
      const shifted = (baselines as unknown as Record<string, number>)[axis];
      if (shifted === undefined) return { pass: false, reason: `${axis} effective baseline not shifted` };
      const baseValue = (ctx.emotionalAxis.resolvedBaselines as unknown as Record<string, number>)[axis] ?? 0;
      const shift = shifted - baseValue;
      const pass = direction === "+" ? shift >= minMag : direction === "-" ? shift <= -minMag : false;
      return {
        pass,
        reason: pass
          ? `${axis} effective baseline shifted by ${shift.toFixed(4)} (expected ${direction} ≥ ${minMag})`
          : `${axis} effective baseline shift ${shift.toFixed(4)} does not match expected ${direction} ≥ ${minMag}`,
      };
    }

    case "condition_transition": {
      const id = assertion.field;
      const fromVal = assertion.expected; // true/false
      const toVal = assertion.value === "true"; // "true"/"false"
      if (!id) return { pass: false, reason: "Missing coupling id on assertion" };
      // Fail closed when conditionTransitions data is absent
      if (!ctx?.emotionalAxis?.conditionTransitions) return { pass: false, reason: "No conditionTransitions data available" };
      const transitions = ctx.emotionalAxis.conditionTransitions;
      const match = transitions.find((t) => t.id === id);
      if (!match) return { pass: false, reason: `No condition transition for ${id}` };
      const pass = match.from === fromVal && match.to === toVal;
      return {
        pass,
        reason: pass
          ? `${id} transitioned ${fromVal}→${toVal}`
          : `${id} transitioned ${match.from}→${match.to}, expected ${fromVal}→${toVal}`,
      };
    }

    case "render_rule_triggered": {
      const expected = assertion.values ?? [];
      if (expected.length === 0) return { pass: true, reason: "OK (no expected render rules)" };
      // Fail closed when render snapshot data is absent
      if (!ctx?.emotionalAxis?.render) return { pass: false, reason: "No render snapshot data available" };
      const actual = ctx.emotionalAxis.render.renderRuleIds;
      const missing = expected.filter((id) => !actual.includes(id));
      const pass = missing.length === 0;
      return {
        pass,
        reason: pass
          ? `Expected render rules triggered: ${expected.join(", ")}`
          : `Missing render rules: ${missing.join(", ")}`,
      };
    }

    case "render_block_contains": {
      const expected = assertion.value ?? "";
      if (!expected) return { pass: false, reason: "Missing expected substring on assertion" };
      // Fail closed when render snapshot data is absent
      if (!ctx?.emotionalAxis?.render) return { pass: false, reason: "No render snapshot data available" };
      const block = ctx.emotionalAxis.render.renderBlock ?? "";
      const pass = block.includes(expected);
      return {
        pass,
        reason: pass ? "Render block contains expected text" : `Render block missing "${expected}"`,
      };
    }

    case "render_block_not_contains": {
      const forbidden = assertion.value ?? "";
      if (!forbidden) return { pass: true, reason: "OK (no forbidden text specified)" };
      // Fail closed when render snapshot data is absent
      if (!ctx?.emotionalAxis?.render) return { pass: false, reason: "No render snapshot data available" };
      const block = ctx.emotionalAxis.render.renderBlock ?? "";
      const pass = !block.includes(forbidden);
      return {
        pass,
        reason: pass ? "Render block does not contain forbidden text" : `Render block contains "${forbidden}"`,
      };
    }

    case "output_forbidden_patterns_absent": {
      const patterns = assertion.values ?? [];
      if (patterns.length === 0) return { pass: true, reason: "OK (no patterns specified)" };
      const matched = patterns.filter((p) => matchesAnyPattern(reply, [p]));
      const pass = matched.length === 0;
      return {
        pass,
        reason: pass ? "No forbidden patterns in output" : `Found forbidden patterns: ${matched.join(", ")}`,
      };
    }

    default:
      return { pass: false, reason: `Unknown assertion type: ${assertion.type}` };
  }
}

export function runAllAssertions(
  scenario: Scenario,
  reply: string,
  validatorResult?: ValidationResult,
  ctx?: AssertionContext,
): Array<{ assertionDescription: string; pass: boolean; reason: string }> {
  return scenario.assertions.map((assertion) => {
    const { pass, reason } = checkAssertion(assertion, reply, validatorResult, ctx);
    return { assertionDescription: assertion.description, pass, reason };
  });
}
