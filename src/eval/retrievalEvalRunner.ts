import { embedText } from "../llm/embedText";
import { env } from "../config/env";
import { formatCanonScenes } from "../orchestration/buildPromptContext";
import { rewriteQuery, type QueryRewriteResult } from "../retrieval/rewriteQuery";
import { resolveContinuityScope } from "../retrieval/resolveContinuityScope";
import { retrieveCanonCoarseToFine } from "../retrieval/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../retrieval/retrieveCanonTier3Pipeline";
import type { Scenario } from "./evalTypes";

export interface RetrievalEvalResult {
  retrieved_canon: string;
  query_rewrite: QueryRewriteResult;
  scenes: RetrievedCanonScene[];
  scene_anchor_count: number;
  had_summary_hit: boolean;
  had_fact_hit: boolean;
  had_lex_hit: boolean;
}

function lastUserMessage(scenario: Scenario): string {
  const msgs = scenario.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === "user" && typeof m.content === "string") {
      return m.content;
    }
  }
  return "";
}

/**
 * DB + embed + Tier 3 coarse-to-fine canon only (no generation).
 */
export async function runRetrievalEvalForScenario(
  scenario: Scenario,
): Promise<RetrievalEvalResult> {
  const userMessage = lastUserMessage(scenario);
  const scope = resolveContinuityScope(
    scenario.session.continuity_scope,
    scenario.session.continuity_family as "main_world" | "au",
  );

  const queryRewrite = await rewriteQuery(userMessage);
  const canonText =
    queryRewrite.combined_for_embedding.trim() || userMessage;
  const [canonQueryEmbedding] = await Promise.all([embedText(canonText)]);

  let hypotheticalQueryEmbedding: number[] | undefined;
  if (env.CANON_QUERY_HYDE && queryRewrite.hypothetical?.trim()) {
    hypotheticalQueryEmbedding = await embedText(queryRewrite.hypothetical.trim());
  }

  const scenes = await retrieveCanonCoarseToFine({
    canonQueryEmbedding,
    hypotheticalQueryEmbedding,
    userMessage,
    characterId: env.DEFAULT_CHARACTER_ID,
    arcKeys: scope.arcKeys,
    entities: queryRewrite.entities,
  });

  const had_summary_hit = scenes.some((s) => s.provenance.fromSummary != null);
  const had_fact_hit = scenes.some(
    (s) => s.provenance.fromFact != null || s.facts.length > 0,
  );
  const had_lex_hit = scenes.some((s) => s.provenance.fromLex != null);

  return {
    retrieved_canon: formatCanonScenes(scenes),
    query_rewrite: queryRewrite,
    scenes,
    scene_anchor_count: scenes.length,
    had_summary_hit,
    had_fact_hit,
    had_lex_hit,
  };
}
