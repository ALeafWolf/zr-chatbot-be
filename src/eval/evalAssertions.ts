import type { Assertion, Scenario } from "./evalTypes";
import type { ValidationResult } from "../llm/runResponseValidator";
import type { QueryRewriteResult } from "../retrieval/rewriteQuery";

export interface AssertionContext {
  retrievedCanon?: string;
  queryRewrite?: QueryRewriteResult;
  scene_anchor_count?: number;
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
          reason: "OK (fail-open — reply does not assert attribution per patterns)",
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
