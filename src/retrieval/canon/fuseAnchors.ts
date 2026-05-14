export type AnchorProvenanceKey =
  | "fromSummary"
  | "fromFact"
  | "fromUnit"
  | "fromLex";

export interface RankedSceneList {
  source: "summary" | "fact" | "unit" | "lex";
  sceneIds: string[];
}

export interface FusedAnchorScene {
  sceneId: string;
  rrfScore: number;
  provenance: Record<AnchorProvenanceKey, number | null>;
}

/** Standard RRF fusion over ordered id lists. */
export function reciprocalRankFusion(lists: string[][], k: number): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    if (list.length === 0) continue;
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

/** Merge two ranked scene lists via RRF (HyDE per-channel pre-merge). */
export function rrfMergeTwo(a: string[], b: string[], k: number): string[] {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return reciprocalRankFusion([a, b], k);
}

const SOURCE_TO_KEY: Record<RankedSceneList["source"], AnchorProvenanceKey> = {
  summary: "fromSummary",
  fact: "fromFact",
  unit: "fromUnit",
  lex: "fromLex",
};

export function fuseAnchorScenes(
  lists: RankedSceneList[],
  rrfK: number,
  topN: number,
  provenanceWeights: Record<AnchorProvenanceKey, number>,
): FusedAnchorScene[] {
  const scores = new Map<string, number>();
  const ranks: Record<AnchorProvenanceKey, Map<string, number>> = {
    fromSummary: new Map(),
    fromFact: new Map(),
    fromUnit: new Map(),
    fromLex: new Map(),
  };

  for (const { source, sceneIds } of lists) {
    const key = SOURCE_TO_KEY[source];
    const rankMap = ranks[key];
    sceneIds.forEach((sceneId, rank) => {
      scores.set(sceneId, (scores.get(sceneId) ?? 0) + 1 / (rrfK + rank + 1));
      if (!rankMap.has(sceneId)) rankMap.set(sceneId, rank);
    });
  }

  const ids = [...scores.keys()];
  const bonusFor = (sceneId: string): number =>
    (ranks.fromSummary.has(sceneId) ? provenanceWeights.fromSummary : 0) +
    (ranks.fromFact.has(sceneId) ? provenanceWeights.fromFact : 0) +
    (ranks.fromUnit.has(sceneId) ? provenanceWeights.fromUnit : 0) +
    (ranks.fromLex.has(sceneId) ? provenanceWeights.fromLex : 0);

  ids.sort((a, b) => {
    const sa = scores.get(a) ?? 0;
    const sb = scores.get(b) ?? 0;
    if (Math.abs(sb - sa) > 1e-12) return sb - sa;
    const ba = bonusFor(a);
    const bb = bonusFor(b);
    if (Math.abs(bb - ba) > 1e-12) return bb - ba;
    return a.localeCompare(b);
  });

  return ids.slice(0, topN).map((sceneId) => ({
    sceneId,
    rrfScore: scores.get(sceneId) ?? 0,
    provenance: {
      fromSummary: ranks.fromSummary.get(sceneId) ?? null,
      fromFact: ranks.fromFact.get(sceneId) ?? null,
      fromUnit: ranks.fromUnit.get(sceneId) ?? null,
      fromLex: ranks.fromLex.get(sceneId) ?? null,
    },
  }));
}
