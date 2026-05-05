import type { Assertion, Scenario } from "./evalTypes";
import type { ValidationResult } from "../llm/runResponseValidator";

export function checkAssertion(
  assertion: Assertion,
  reply: string,
  validatorResult?: ValidationResult,
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
): Array<{ assertionDescription: string; pass: boolean; reason: string }> {
  return scenario.assertions.map((assertion) => {
    const { pass, reason } = checkAssertion(assertion, reply, validatorResult);
    return { assertionDescription: assertion.description, pass, reason };
  });
}
