/**
 * Shared intimate-mode predicate used by validation and prompt assembly.
 *
 * Triggers on: high arousal band, a recent intimate_moment event, or a rendered
 * band line showing high arousal.
 */
export function isIntimateMode(
  bandLine?: string,
  lastTraceEvent?: string,
  axisBands?: Record<string, string>,
): boolean {
  // Arousal band = high OR recent event = intimate_moment
  if (axisBands?.arousal === "high") return true;
  if (lastTraceEvent?.includes("intimate_moment")) return true;
  // Fallback on the rendered band line when raw bands aren't available.
  // formatBandLine emits the HIGH label as "偏高" (BAND_LABELS.high), so match
  // that; keep "唤起：高" / the English variant as harmless legacy fallbacks.
  if (
    bandLine?.includes("唤起：偏高") ||
    bandLine?.includes("唤起：高") ||
    bandLine?.includes("唤起: high")
  ) {
    return true;
  }
  return false;
}
