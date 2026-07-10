/**
 * Shared intimate-mode predicate used by validation and prompt assembly.
 *
 * Keep the trigger order and matching behavior aligned with the original
 * validator-local implementation.
 */
export function isIntimateMode(
  bandLine?: string,
  lastTraceEvent?: string,
  axisBands?: Record<string, string>,
): boolean {
  // Arousal band = high OR recent event = intimate_moment
  if (axisBands?.arousal === "high") return true;
  if (lastTraceEvent?.includes("intimate_moment")) return true;
  if (bandLine?.includes("唤起：高") || bandLine?.includes("唤起: high")) return true;
  return false;
}
