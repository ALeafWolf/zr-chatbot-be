export function evaluateToolCallPrecision(result: {
  expectedToolCallsAllowed: string[];
  actualToolCalls: string[];
}): { score: number; details: string } {
  const allowed = new Set(result.expectedToolCallsAllowed);
  const unnecessary = result.actualToolCalls.filter((t) => !allowed.has(t));
  const score =
    result.actualToolCalls.length > 0
      ? 1 - unnecessary.length / result.actualToolCalls.length
      : 1;
  return {
    score,
    details:
      unnecessary.length > 0
        ? `Unnecessary: ${unnecessary.join(", ")}`
        : "All tool calls were allowed",
  };
}

export function evaluateToolCallRecall(result: {
  expectedMustCall: string[];
  actualToolCalls: string[];
}): { score: number; details: string } {
  const called = new Set(result.actualToolCalls);
  const missed = result.expectedMustCall.filter((t) => !called.has(t));
  const score =
    result.expectedMustCall.length > 0
      ? 1 - missed.length / result.expectedMustCall.length
      : 1;
  return {
    score,
    details:
      missed.length > 0
        ? `Missed: ${missed.join(", ")}`
        : "All required tools called",
  };
}

export function evaluateCanonInjectionConsistency(result: {
  needsCanon: boolean;
  canonWasInjected: boolean;
  canonLookupWasCalled: boolean;
}): { score: number; details: string } {
  if (result.needsCanon && !result.canonWasInjected && !result.canonLookupWasCalled) {
    return {
      score: 0,
      details: "Canon needed but neither injected nor looked up",
    };
  }
  if (!result.needsCanon && result.canonWasInjected) {
    return { score: 0.5, details: "Canon injected unnecessarily" };
  }
  return { score: 1, details: "Canon injection consistent with need" };
}

export function evaluateContextNeedAccuracy(result: {
  expectedNeedsOlderRecall: boolean;
  olderRecallWasRetrieved: boolean;
  expectedNeedsStructMem: boolean;
  structMemWasRetrieved: boolean;
}): { score: number; details: string } {
  let matches = 0;
  const total = 2;
  const issues: string[] = [];

  if (result.expectedNeedsOlderRecall === result.olderRecallWasRetrieved) {
    matches++;
  } else {
    issues.push(
      `Older recall expected=${result.expectedNeedsOlderRecall} actual=${result.olderRecallWasRetrieved}`,
    );
  }

  if (result.expectedNeedsStructMem === result.structMemWasRetrieved) {
    matches++;
  } else {
    issues.push(
      `StructMem expected=${result.expectedNeedsStructMem} actual=${result.structMemWasRetrieved}`,
    );
  }

  return { score: matches / total, details: issues.join("; ") };
}
