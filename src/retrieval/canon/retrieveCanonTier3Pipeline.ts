import { CANON_TIER3, type CanonTier3Override } from "../../character/canonRules";
import { traceStage } from "../../observability/langsmithTracing";
import { expandAnchorScenes, type ExpandedSceneRow, type EpisodeOpeningRow } from "./expandScenes";
import {
  fuseAnchorScenes,
  rrfMergeTwo,
  type FusedAnchorScene,
  type RankedSceneList,
} from "./fuseAnchors";
import { searchFacts, type FactHit } from "./searchFacts";
import { searchSceneSummaries } from "./searchSceneSummaries";
import {
  buildLexicalTermsForCanon,
  sceneIdsFromLexHits,
  searchLexicalUnitScenes,
} from "./searchLexicalUnitScenes";
import { sceneIdsFromUnitHits, searchUnitVectors } from "./searchUnitVectors";

export interface CanonOpeningUnit {
  unitIndex: number;
  speaker: string | null;
  contentType: string;
  textContent: string;
}

export interface RetrievedCanonScene {
  sceneId: string;
  chapterId: string;
  episodeId: string;
  arcKey: string;
  chapterName: string;
  episodeLabel: string;
  sceneTitle: string | null;
  sceneSummary: string | null;
  episodeSummary: string | null;
  episodeOpeningUnits: CanonOpeningUnit[];
  units: Array<{
    unitIndex: number;
    speaker: string | null;
    contentType: string;
    textContent: string;
  }>;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    textForm: string;
  }>;
  rankScore: number;
  provenance: {
    fromSummary: number | null;
    fromFact: number | null;
    fromUnit: number | null;
    fromLex: number | null;
  };
}

function sceneIdsFromFacts(hits: FactHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.sceneId)) continue;
    seen.add(h.sceneId);
    out.push(h.sceneId);
  }
  return out;
}

async function dualSummaryScenes(
  primary: number[],
  secondary: number[] | undefined,
  characterId: string,
  arcKeys: string[],
  limit: number,
  rrfK: number,
): Promise<string[]> {
  const a = await searchSceneSummaries({
    queryEmbedding: primary,
    characterId,
    arcKeys,
    limit,
  });
  const aIds = a.map((x) => x.sceneId);
  if (!secondary || secondary.length === 0) return aIds;
  const b = await searchSceneSummaries({
    queryEmbedding: secondary,
    characterId,
    arcKeys,
    limit,
  });
  return rrfMergeTwo(aIds, b.map((x) => x.sceneId), rrfK);
}

async function dualFactScenes(
  primary: number[],
  secondary: number[] | undefined,
  characterId: string,
  arcKeys: string[],
  limit: number,
  rrfK: number,
): Promise<string[]> {
  const a = await searchFacts({
    queryEmbedding: primary,
    characterId,
    arcKeys,
    limit,
  });
  const aIds = sceneIdsFromFacts(a);
  if (!secondary || secondary.length === 0) return aIds;
  const b = await searchFacts({
    queryEmbedding: secondary,
    characterId,
    arcKeys,
    limit,
  });
  return rrfMergeTwo(aIds, sceneIdsFromFacts(b), rrfK);
}

async function dualUnitScenes(
  primary: number[],
  secondary: number[] | undefined,
  characterId: string,
  arcKeys: string[],
  limit: number,
  rrfK: number,
): Promise<string[]> {
  const a = await searchUnitVectors({
    queryEmbedding: primary,
    characterId,
    arcKeys,
    limit,
  });
  const aIds = sceneIdsFromUnitHits(a);
  if (!secondary || secondary.length === 0) return aIds;
  const b = await searchUnitVectors({
    queryEmbedding: secondary,
    characterId,
    arcKeys,
    limit,
  });
  return rrfMergeTwo(aIds, sceneIdsFromUnitHits(b), rrfK);
}

function groupExpandedToScenes(
  anchors: FusedAnchorScene[],
  expandedRows: ExpandedSceneRow[],
  factsByScene: Map<
    string,
    Array<{
      subject: string;
      predicate: string;
      object: string;
      textForm: string;
    }>
  >,
  episodeOpeningUnits: EpisodeOpeningRow[] = [],
): RetrievedCanonScene[] {
  const byScene = new Map<string, ExpandedSceneRow[]>();
  for (const r of expandedRows) {
    const list = byScene.get(r.sceneId) ?? [];
    list.push(r);
    byScene.set(r.sceneId, list);
  }

  // Group opening units by episodeId for attachment.
  const openingByEpisodeId = new Map<string, CanonOpeningUnit[]>();
  for (const ep of episodeOpeningUnits) {
    openingByEpisodeId.set(
      ep.episodeId,
      ep.units.map((u) => ({ ...u })),
    );
  }

  return anchors.map((a) => {
    const rows = byScene.get(a.sceneId) ?? [];
    const first = rows[0];
    const fs = factsByScene.get(a.sceneId) ?? [];
    const epId = first?.episodeId ?? a.sceneId;
    return {
      sceneId: a.sceneId,
      chapterId: first?.chapterId ?? "",
      episodeId: epId,
      arcKey: first?.arcKey ?? "",
      chapterName: first?.chapterName ?? "",
      episodeLabel: first?.episodeLabel ?? "",
      sceneTitle: first?.sceneTitle ?? null,
      sceneSummary: first?.sceneSummary ?? null,
      episodeSummary: first?.episodeSummary ?? null,
      episodeOpeningUnits: openingByEpisodeId.get(epId) ?? [],
      units: rows.map((u) => ({
        unitIndex: u.unitIndex,
        speaker: u.speaker,
        contentType: u.contentType,
        textContent: u.textContent,
      })),
      facts: fs.map((f) => ({
        subject: f.subject,
        predicate: f.predicate,
        object: f.object,
        textForm: f.textForm,
      })),
      rankScore: a.rrfScore,
      provenance: { ...a.provenance },
    };
  });
}

/** Sub-spans (nested under `retrieval.canon` when called from within that run). */
const tracedSceneSummarySearch = traceStage(
  "retrieval.canon.scene_summary_search",
  async (p: {
    primary: number[];
    secondary?: number[];
    characterId: string;
    arcKeys: string[];
    limit: number;
    rrfK: number;
  }) =>
    dualSummaryScenes(
      p.primary,
      p.secondary,
      p.characterId,
      p.arcKeys,
      p.limit,
      p.rrfK,
    ),
  { subsystem: "retrieval", turn: "foreground" },
);

const tracedFactSearch = traceStage(
  "retrieval.canon.facts_search",
  async (p: {
    primary: number[];
    secondary?: number[];
    characterId: string;
    arcKeys: string[];
    limit: number;
    rrfK: number;
  }) =>
    dualFactScenes(
      p.primary,
      p.secondary,
      p.characterId,
      p.arcKeys,
      p.limit,
      p.rrfK,
    ),
  { subsystem: "retrieval", turn: "foreground" },
);

const tracedUnitSearch = traceStage(
  "retrieval.canon.unit_search",
  async (p: {
    primary: number[];
    secondary?: number[];
    characterId: string;
    arcKeys: string[];
    limit: number;
    rrfK: number;
  }) =>
    dualUnitScenes(
      p.primary,
      p.secondary,
      p.characterId,
      p.arcKeys,
      p.limit,
      p.rrfK,
    ),
  { subsystem: "retrieval", turn: "foreground" },
);

const tracedLexicalSearch = traceStage(
  "retrieval.canon.lexical_unit_search",
  async (p: {
    userMessage: string;
    entities: string[];
    characterId: string;
    arcKeys: string[];
    limit: number;
  }) => {
    const terms = buildLexicalTermsForCanon({
      userMessage: p.userMessage,
      entities: p.entities,
      maxTerms: CANON_TIER3.canonLexCandidates,
    });
    if (terms.length === 0) return [];
    const hits = await searchLexicalUnitScenes({
      terms,
      characterId: p.characterId,
      arcKeys: p.arcKeys,
      limit: p.limit,
    });
    return sceneIdsFromLexHits(hits);
  },
  { subsystem: "retrieval", turn: "foreground" },
);

const tracedAnchorFusion = traceStage(
  "retrieval.canon.anchor_fusion",
  (input: {
    lists: RankedSceneList[];
    rrfK: number;
    topN: number;
    weights: typeof CANON_TIER3.canonProvenanceWeights;
  }) =>
    Promise.resolve(
      fuseAnchorScenes(input.lists, input.rrfK, input.topN, input.weights),
    ),
  { subsystem: "retrieval", turn: "foreground" },
);

const tracedFineExpansion = traceStage(
  "retrieval.canon.fine_expansion",
  expandAnchorScenes,
  { subsystem: "retrieval", turn: "foreground" },
);

async function runTier3Core(input: {
  canonQueryEmbedding: number[];
  hypotheticalQueryEmbedding?: number[];
  userMessage: string;
  characterId: string;
  arcKeys: string[];
  entities: string[];
  /** Narrower caps for verification paths (e.g. canon_lookup tool). */
  tier3Overrides?: CanonTier3Override;
}): Promise<RetrievedCanonScene[]> {
  const {
    canonQueryEmbedding,
    hypotheticalQueryEmbedding,
    userMessage,
    characterId,
    arcKeys,
    entities,
    tier3Overrides,
  } = input;

  if (arcKeys.length === 0) return [];

  const t3 = { ...CANON_TIER3, ...tier3Overrides };
  const k = t3.canonRRFK;
  const hypo =
    hypotheticalQueryEmbedding && hypotheticalQueryEmbedding.length > 0
      ? hypotheticalQueryEmbedding
      : undefined;

  const [summaryScenes, factScenes, unitScenes, lexicalHits] =
    await Promise.all([
      tracedSceneSummarySearch({
        primary: canonQueryEmbedding,
        secondary: hypo,
        characterId,
        arcKeys,
        limit: t3.canonSummaryCandidates,
        rrfK: k,
      }),
      tracedFactSearch({
        primary: canonQueryEmbedding,
        secondary: hypo,
        characterId,
        arcKeys,
        limit: t3.canonFactCandidates,
        rrfK: k,
      }),
      tracedUnitSearch({
        primary: canonQueryEmbedding,
        secondary: hypo,
        characterId,
        arcKeys,
        limit: t3.canonUnitCandidates,
        rrfK: k,
      }),
      tracedLexicalSearch({
        userMessage,
        entities,
        characterId,
        arcKeys,
        limit: t3.canonLexCandidates,
      }),
    ]);

  const lists = (
    [
      { source: "summary", sceneIds: summaryScenes },
      { source: "fact", sceneIds: factScenes },
      { source: "unit", sceneIds: unitScenes },
      { source: "lex", sceneIds: lexicalHits },
    ] as RankedSceneList[]
  ).filter((l) => l.sceneIds.length > 0);

  if (lists.length === 0) return [];

  const fused = await tracedAnchorFusion({
    lists,
    rrfK: k,
    topN: t3.canonAnchorSceneTopK,
    weights: t3.canonProvenanceWeights,
  });

  const { rows, episodeOpeningUnits, factsByScene } = await tracedFineExpansion({
    characterId,
    arcKeys,
    anchors: fused,
    maxUnitsPerScene: t3.canonMaxUnitsPerScene,
    maxTotalUnits: t3.canonMaxTotalUnits,
  });

  return groupExpandedToScenes(fused, rows, factsByScene, episodeOpeningUnits);
}

export const retrieveCanonCoarseToFine = traceStage(
  "retrieval.canon",
  runTier3Core,
  { subsystem: "retrieval", turn: "foreground" },
);
