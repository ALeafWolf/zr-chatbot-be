/**
 * OpenAI reasoning-class models reject `max_tokens` and require
 * `max_completion_tokens`. Match by family prefix on the unprefixed
 * model id (e.g. "gpt-5-mini", "o1", "o3-mini", "o4-mini-high").
 *
 * Non-reasoning OpenAI families (gpt-4*, gpt-3.5*) and DeepSeek
 * models (deepseek-*) return false and continue using `max_tokens`.
 */
export function requiresMaxCompletionTokens(model: string): boolean {
  return (
    /^gpt-5(?:[-.]|$)/.test(model) ||
    /^o1(?:[-.]|$)/.test(model) ||
    /^o3(?:[-.]|$)/.test(model) ||
    /^o4(?:[-.]|$)/.test(model)
  );
}
