/**
 * Preflight emotional-axis env gate validation for LangSmith runs.
 *
 * When `EVAL_SCENARIO_SET=emotional_axis`, reads the selected
 * `EMOTIONAL_AXIS_VARIANT` and validates that the required production
 * gates (`EMOTIONAL_ENGINE_ENABLED`, `EMOTIONAL_RENDER_ENABLED`) are
 * enabled. Throws `VariantGuardrailError` if a variant needs a gate
 * that is disabled.
 *
 * Non-emotional-axis runs pass through unconditionally.
 *
 * Exported for unit testing — call this in `main()` before `evaluate(...)`.
 */
import {
  readEmotionalAxisVariant,
  validateEmotionalAxisVariantGuard,
} from "./experimentVariants";

export function preflightEmotionalAxisLangSmithRun(): void {
  const isEmotionalAxisRun =
    (process.env.EVAL_SCENARIO_SET ?? "").trim().toLowerCase() === "emotional_axis";
  if (!isEmotionalAxisRun) return;

  const variant = readEmotionalAxisVariant();
  validateEmotionalAxisVariantGuard(variant);
}
