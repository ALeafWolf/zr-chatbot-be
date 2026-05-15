import type { SessionSummaryRecord } from "../memory/session/sessionSummaryRepo";
import { normalizeSessionSummaryJson } from "../memory/session/sessionSummaryJson";

export interface MemoryCorrectionContext {
  oldClaim: string;
  correctedClaim: string;
  sourceTurnIndex: number;
}

export function retrieveActiveCorrections(
  sessionSummary: SessionSummaryRecord,
  limit = 5,
): MemoryCorrectionContext[] {
  if (!sessionSummary?.summaryJson) return [];
  const summary = normalizeSessionSummaryJson(sessionSummary.summaryJson);
  return summary.contradictionsOrCorrections
    .filter((correction) => correction.oldClaim && correction.correctedClaim)
    .sort((a, b) => b.sourceTurnIndex - a.sourceTurnIndex)
    .slice(0, limit)
    .map((correction) => ({
      oldClaim: correction.oldClaim,
      correctedClaim: correction.correctedClaim,
      sourceTurnIndex: correction.sourceTurnIndex,
    }));
}

export function formatMemoryCorrections(
  corrections: MemoryCorrectionContext[],
): string {
  const lines = corrections.map(
    (correction, index) =>
      `${index + 1}. [turn ${correction.sourceTurnIndex}] Replace "${correction.oldClaim}" with "${correction.correctedClaim}".`,
  );
  return `These are explicit corrections from the current session summary. Use the corrected claim when older memory conflicts with it.\n\n${lines.join("\n")}`;
}
