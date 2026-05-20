/** Deterministic scan result for repeated relationship gesture detection. */
export interface MotifSignal {
  hasNegation: boolean;
  bodyOrObjectTerms: string[];
  actionTerms: string[];
  privateTerms: string[];
  motifMarkers: string[];
  confidence: number;
  userAction?: string;
  rawUserMessage: string;
}

export interface StructMemMotifProbeSummary {
  hasStrongMatch: boolean;
  matchingEntries: Array<{
    entryId: string;
    entryType: string;
    text: string;
    turnIndex: number;
    score: number;
    matchedTerms: string[];
  }>;
  matchingConsolidations: Array<{
    id: string;
    summaryText: string;
    turnStart: number | null;
    turnEnd: number | null;
    score: number;
  }>;
  triggeredTerms: string[];
}
