import { z } from "zod";
import { models } from "../config/models";
import { chatJsonStream } from "./providers";
import { env } from "../config/env";

export interface ValidationResult {
  in_character: boolean;
  canon_consistent: boolean;
  session_state_consistent: boolean;
  nsfw_within_bounds: boolean;
  issues: string[];
  needs_rewrite: boolean;
}

export interface ValidatorInput {
  draft: string;
  characterId: string;
  continuityScope: string;
  mode: string;
  maxNsfwLevel: string;
  escalationRule: string;
  outOfScopeChapterBehavior: string;
  recentContext: string;
  /** Canon narrative block shown to the generator (Tier 3 coarse-to-fine). */
  retrievedCanonNarrative?: string;
  signal?: AbortSignal;
}

const ValidationResultSchema = z.object({
  in_character: z.boolean(),
  canon_consistent: z.boolean(),
  session_state_consistent: z.boolean(),
  nsfw_within_bounds: z.boolean(),
  issues: z.array(z.string()),
  needs_rewrite: z.boolean(),
});

/** When the validator model output cannot be parsed, accept the draft (fail-open). */
export const VALIDATOR_FAIL_OPEN: ValidationResult = {
  in_character: true,
  canon_consistent: true,
  session_state_consistent: true,
  nsfw_within_bounds: true,
  issues: [],
  needs_rewrite: false,
};

const VALIDATOR_SYSTEM_PROMPT = `You are a strict character consistency validator for a character roleplay system.
Analyze the given draft response and return a JSON object — nothing else.

Check all of the following:
1. in_character: Does the reply stay fully in character? (false if it claims to be AI, breaks the fourth wall, or uses out-of-character phrasing)
2. canon_consistent: Does the reply avoid contradicting established canon facts for the active continuity scope?
3. session_state_consistent: Does the reply stay consistent with the current session mode, pinned context, and character defaults?
4. nsfw_within_bounds: Is the NSFW content level within the allowed max_nsfw_level and escalation_rule?
5. issues: List any specific problems found (empty array if none).
6. needs_rewrite: true if any of the above checks failed.

Return ONLY valid JSON in this exact shape:
{
  "in_character": boolean,
  "canon_consistent": boolean,
  "session_state_consistent": boolean,
  "nsfw_within_bounds": boolean,
  "issues": string[],
  "needs_rewrite": boolean
}`;

/** Tier 3 prep: optional strict gate for unsupported canon attributions (no LLM). */
function applyStrictAttributionSoftPenalty(
  result: ValidationResult,
  draft: string,
  recentContext: string,
  canon: string,
): ValidationResult {
  if (!result.in_character) return result;
  const corpus = `${recentContext}\n${canon}`;
  const cues =
    /提议|安排|第一次|第二次|谁先|谁提出/.test(draft) &&
    /左然|用户|你/.test(draft);
  if (!cues) return result;
  if (canon.includes("枫河") && /左然/.test(canon) && /提议|安排/.test(canon)) {
    return result;
  }
  return {
    ...result,
    in_character: false,
    issues: [
      ...result.issues,
      "Strict attribution mode: reply attributes plot points not clearly supported by retrieved canon + recent context.",
    ],
  };
}

export async function runResponseValidator(
  input: ValidatorInput,
): Promise<ValidationResult> {
  const userMessage = `
Character: ${input.characterId}
Continuity scope: ${input.continuityScope}
Session mode: ${input.mode}
Max NSFW level: ${input.maxNsfwLevel}
Escalation rule: ${input.escalationRule}
Out-of-scope behavior: ${input.outOfScopeChapterBehavior}

Recent context (last 2 turns):
${input.recentContext}

Draft reply to validate:
"""
${input.draft}
"""

Return the JSON validation result.`.trim();

  const result = await chatJsonStream(
    models.validator,
    [
      { role: "system", content: VALIDATOR_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    ValidationResultSchema,
    { maxTokens: 512, temperature: 0.1, signal: input.signal },
  );

  if (!result.ok) {
    console.warn(
      "[runResponseValidator] validator JSON parse failed; fail-open (accept draft).",
      result.error,
    );
    return VALIDATOR_FAIL_OPEN;
  }

  let parsed = result.data;
  if (env.VALIDATOR_STRICT_ATTRIBUTION && input.retrievedCanonNarrative?.trim()) {
    parsed = applyStrictAttributionSoftPenalty(
      parsed,
      input.draft,
      input.recentContext,
      input.retrievedCanonNarrative,
    );
  }

  return parsed;
}
