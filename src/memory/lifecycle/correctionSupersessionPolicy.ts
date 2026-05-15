import type { MemoryCorrectionContext } from "../../orchestration/memoryCorrections";

export interface SupersessionCandidate {
  id: string;
  text: string;
  source: "interactive_memory" | "structmem_entry";
}

export interface CorrectionSupersessionDecision {
  candidateId: string;
  source: SupersessionCandidate["source"];
  oldClaim: string;
  correctedClaim: string;
  sourceTurnIndex: number;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function buildCorrectionSupersessionPlan(input: {
  corrections: MemoryCorrectionContext[];
  candidates: SupersessionCandidate[];
}): CorrectionSupersessionDecision[] {
  const decisions: CorrectionSupersessionDecision[] = [];
  const seen = new Set<string>();

  for (const correction of input.corrections) {
    const oldClaim = normalized(correction.oldClaim);
    if (oldClaim.length < 8) continue;
    for (const candidate of input.candidates) {
      const key = `${candidate.source}:${candidate.id}`;
      if (seen.has(key)) continue;
      if (!normalized(candidate.text).includes(oldClaim)) continue;
      seen.add(key);
      decisions.push({
        candidateId: candidate.id,
        source: candidate.source,
        oldClaim: correction.oldClaim,
        correctedClaim: correction.correctedClaim,
        sourceTurnIndex: correction.sourceTurnIndex,
      });
    }
  }

  return decisions;
}
