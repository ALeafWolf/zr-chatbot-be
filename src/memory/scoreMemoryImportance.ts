/**
 * Composite importance score formula from §10.
 *
 * composite =
 *   emotionalWeight * 0.30 +
 *   plotRelevance   * 0.30 +
 *   crossSessionDurability * 0.25 +
 *   memoryTypeWeight * 0.15
 *
 * The LLM extractor provides the raw component scores; this module applies
 * the formula and looks up the memory-type weight table.
 */

import type { MemoryCandidate } from "./writeInteractiveMemory";

const MEMORY_TYPE_WEIGHTS: Record<MemoryCandidate["memoryType"], number> = {
  promise: 1.0,
  relationship_transition: 0.9,
  preference: 0.7,
  habit: 0.6,
  banter: 0.2,
};

export interface RawImportanceComponents {
  emotionalWeight: number;       // 0..1 from LLM classifier
  plotRelevance: number;         // 0..1 from LLM classifier
  crossSessionDurability: number; // 0..1 from LLM classifier
  memoryType: MemoryCandidate["memoryType"];
}

export function scoreMemoryImportance(
  components: RawImportanceComponents,
): number {
  const { emotionalWeight, plotRelevance, crossSessionDurability, memoryType } =
    components;
  const memoryTypeWeight = MEMORY_TYPE_WEIGHTS[memoryType];
  const composite =
    emotionalWeight * 0.3 +
    plotRelevance * 0.3 +
    crossSessionDurability * 0.25 +
    memoryTypeWeight * 0.15;
  return Math.min(1, Math.max(0, composite));
}
