import { getProvider } from "./providers";
import { models } from "../config/models";

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
}

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

export async function runResponseValidator(
  input: ValidatorInput,
): Promise<ValidationResult> {
  const provider = getProvider(models.validator);

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

  const response = await provider.chat(
    [
      { role: "system", content: VALIDATOR_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    { maxTokens: 512, temperature: 0.1, jsonMode: true },
  );

  try {
    const parsed = JSON.parse(response.content) as ValidationResult;
    return parsed;
  } catch {
    // If the model fails to produce valid JSON, treat the draft as invalid
    return {
      in_character: false,
      canon_consistent: false,
      session_state_consistent: false,
      nsfw_within_bounds: true,
      issues: ["Validator failed to parse its own output — treating as invalid"],
      needs_rewrite: true,
    };
  }
}
