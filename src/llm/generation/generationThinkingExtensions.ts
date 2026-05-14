import type { ModelBinding } from "../../config/models";

/**
 * Maps an abstract per-session `thinking` flag to OpenAI-compatible completion
 * body extensions for the configured generation model. Only generation calls
 * should use this; validator/extractor bindings are separate.
 */
export function extensionsForGenerationThinking(
  model: ModelBinding,
  thinking: boolean,
): Record<string, unknown> | undefined {
  if (thinking) return undefined;

  if (model.provider === "deepseek") {
    // DeepSeek v3/v4: omit reasoning stream and avoid reasoning in history budget.
    return { thinking: { type: "disabled" as const } };
  }

  return undefined;
}
