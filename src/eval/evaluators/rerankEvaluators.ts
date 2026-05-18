import type { EvaluationResult } from "langsmith/evaluation";
import type { Example, Run } from "langsmith/schemas";

/**
 * Evaluates whether the reranker selected memory items match expected selections.
 * Uses metadata from the eval snapshot (requires agent_turn eval mode).
 */
export function rerankSelectionPrecision(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const results: EvaluationResult[] = [];
  const output = args.outputs as { retrieval?: { rerank?: { selected?: Array<{ source: string; id: string }>; rejectedCount?: number } } };
  const rerank = output?.retrieval?.rerank;

  if (!rerank) {
    results.push({
      key: "rerank_selection_precision",
      score: null,
      comment: "No rerank snapshot available",
    });
    return { results };
  }

  const expectedSelected = (args.example.metadata?.expected_selected_ids as string[]) ?? [];
  const actualSelected = (rerank.selected ?? []).map((s: { id: string }) => s.id);

  if (expectedSelected.length === 0) {
    results.push({
      key: "rerank_selection_precision",
      score: 1,
      comment: "No expected IDs specified; pass by default",
    });
  } else {
    const expectedSet = new Set(expectedSelected);
    const correct = actualSelected.filter((id: string) => expectedSet.has(id)).length;
    const precision = actualSelected.length > 0 ? correct / actualSelected.length : 1;
    results.push({
      key: "rerank_selection_precision",
      score: precision,
      comment: `${correct}/${actualSelected.length} selected items match expected`,
    });
  }

  return { results };
}

/**
 * Evaluates whether the reranker recalled all expected memory items.
 */
export function rerankSelectionRecall(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const results: EvaluationResult[] = [];
  const output = args.outputs as { retrieval?: { rerank?: { selected?: Array<{ source: string; id: string }>; rejectedCount?: number } } };
  const rerank = output?.retrieval?.rerank;

  if (!rerank) {
    results.push({
      key: "rerank_selection_recall",
      score: null,
      comment: "No rerank snapshot available",
    });
    return { results };
  }

  const expectedSelected = (args.example.metadata?.expected_selected_ids as string[]) ?? [];
  const actualIds = new Set((rerank.selected ?? []).map((s: { id: string }) => s.id));

  if (expectedSelected.length === 0) {
    results.push({
      key: "rerank_selection_recall",
      score: 1,
      comment: "No expected IDs specified; pass by default",
    });
  } else {
    const recalled = expectedSelected.filter((id: string) => actualIds.has(id)).length;
    const recall = recalled / expectedSelected.length;
    results.push({
      key: "rerank_selection_recall",
      score: recall,
      comment: `${recalled}/${expectedSelected.length} expected items recalled`,
    });
  }

  return { results };
}

/**
 * Evaluates whether the reranker correctly rejected expected-forbidden items.
 */
export function rerankRejectionAccuracy(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const results: EvaluationResult[] = [];
  const output = args.outputs as { retrieval?: { rerank?: { selected?: Array<{ source: string; id: string }>; rejectedCount?: number } } };
  const rerank = output?.retrieval?.rerank;

  if (!rerank) {
    results.push({
      key: "rerank_rejection_accuracy",
      score: null,
      comment: "No rerank snapshot available",
    });
    return { results };
  }

  const expectedRejected = (args.example.metadata?.expected_rejected_ids as string[]) ?? [];
  const selectedIds = new Set((rerank.selected ?? []).map((s: { id: string }) => s.id));

  if (expectedRejected.length === 0) {
    results.push({
      key: "rerank_rejection_accuracy",
      score: 1,
      comment: "No expected-rejected IDs specified",
    });
  } else {
    const correctlyRejected = expectedRejected.filter((id: string) => !selectedIds.has(id)).length;
    const accuracy = correctlyRejected / expectedRejected.length;
    results.push({
      key: "rerank_rejection_accuracy",
      score: accuracy,
      comment: `${correctlyRejected}/${expectedRejected.length} forbidden items correctly rejected`,
    });
  }

  return { results };
}

/**
 * Scores whether the reranker used the expected final context mode.
 */
export function rerankContextModeAccuracy(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const results: EvaluationResult[] = [];
  const output = args.outputs as { retrieval?: { rerank?: { finalContextMode?: string; fallbackUsed?: boolean } } };
  const rerank = output?.retrieval?.rerank;
  const expectedMode = args.example.metadata?.expected_final_context_mode as string | undefined;

  if (!rerank) {
    results.push({ key: "rerank_context_mode_accuracy", score: null, comment: "No rerank snapshot" });
    return { results };
  }

  if (!expectedMode) {
    results.push({ key: "rerank_context_mode_accuracy", score: 1, comment: "No expected mode specified" });
  } else {
    const match = rerank.finalContextMode === expectedMode;
    results.push({
      key: "rerank_context_mode_accuracy",
      score: match ? 1 : 0,
      comment: match
        ? `Mode ${expectedMode} matches`
        : `Expected ${expectedMode}, got ${rerank.finalContextMode}`,
    });
  }

  return { results };
}

/**
 * Composite rerank score: average of precision, recall, rejection, and context mode.
 */
export function rerankCompositeScore(args: {
  example: Example;
  outputs: Record<string, unknown>;
}): { results: EvaluationResult[] } {
  const precision = rerankSelectionPrecision(args).results[0]?.score ?? null;
  const recall = rerankSelectionRecall(args).results[0]?.score ?? null;
  const rejection = rerankRejectionAccuracy(args).results[0]?.score ?? null;
  const contextMode = rerankContextModeAccuracy(args).results[0]?.score ?? null;

  const scores = [precision, recall, rejection, contextMode].filter(
    (s): s is number => s !== null,
  );
  const average = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : null;

  return {
    results: [
      {
        key: "rerank_composite_score",
        score: average,
        comment:
          average !== null
            ? `Composite rerank score: ${average.toFixed(3)} (${scores.length} metrics)`
            : "No rerank metrics available",
      },
    ],
  };
}
