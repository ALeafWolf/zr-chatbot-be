import { z } from "zod";
import { CANON_PROMPT_LIMITS } from "../character/canonRules";
import { models } from "../config/models";
import { chatJsonStream } from "./providers";
import { env } from "../config/env";
import {
  runAttributionJudge,
  type AttributionJudgeResult,
} from "./runAttributionJudge";

export interface ValidationResult {
  in_character: boolean;
  canon_consistent: boolean;
  session_state_consistent: boolean;
  nsfw_within_bounds: boolean;
  issues: string[];
  needs_rewrite: boolean;
  /** When strict attribution runs the LLM judge and gets a parsed verdict (not fail-open). */
  attribution_judge?: AttributionJudgeResult;
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
2. canon_consistent: Does the reply avoid contradicting canon facts that are explicitly supported by the retrieved canon excerpt and/or the provided transcript? The excerpt is RAG retrieval for this turn and is NOT exhaustive world lore—do not fail solely because a detail appears only outside the excerpt. Fail only on clear contradiction with the excerpt or transcript.
3. session_state_consistent: Does the reply stay consistent with the current user message (including physical actions and callbacks), the recent transcript, session mode, pinned context, and character defaults?
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

/** Fallback when the attribution judge fails open (legacy regex guard). */
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

function canonForValidatorPrompt(raw: string): string {
  const t = raw.trim();
  if (!t) {
    return "Retrieved canon narrative: No canon excerpt retrieved for this turn.";
  }
  const max = CANON_PROMPT_LIMITS.maxTotalChars;
  const body = t.length <= max ? t : `${t.slice(0, max)}…`;
  return `Retrieved canon narrative (excerpt for this turn; not exhaustive):
"""
${body}
"""`;
}

export async function runResponseValidator(
  input: ValidatorInput,
): Promise<ValidationResult> {
  const canonBlock = canonForValidatorPrompt(input.retrievedCanonNarrative ?? "");

  const userMessage = `
Character: ${input.characterId}
Continuity scope: ${input.continuityScope}
Session mode: ${input.mode}
Max NSFW level: ${input.maxNsfwLevel}
Escalation rule: ${input.escalationRule}
Out-of-scope behavior: ${input.outOfScopeChapterBehavior}

${canonBlock}

Turn context (recent transcript up to last 4 messages plus current user message):
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
  let attributionJudgeMeta: AttributionJudgeResult | undefined;

  if (env.VALIDATOR_STRICT_ATTRIBUTION && input.retrievedCanonNarrative?.trim()) {
    const judgeRun = await runAttributionJudge({
      draft: input.draft,
      retrievedCanonNarrative: input.retrievedCanonNarrative,
      recentContext: input.recentContext,
      signal: input.signal,
    });

    if (!judgeRun.usedFailOpen) {
      attributionJudgeMeta = judgeRun.verdict;
    }

    const v = judgeRun.verdict;
    if (
      !judgeRun.usedFailOpen &&
      v.has_attribution_claim &&
      !v.supported_by_canon &&
      !v.supported_by_transcript
    ) {
      const claimStr = v.claim
        ? `${v.claim.subject}/${v.claim.predicate}/${v.claim.object}`
        : "…";
      parsed = {
        ...parsed,
        canon_consistent: false,
        needs_rewrite: true,
        issues: [
          ...parsed.issues,
          `Attribution claim "${claimStr}" not supported by retrieved canon or transcript. Use canon_lookup to verify before re-stating, or omit.`,
        ],
      };
    } else if (judgeRun.usedFailOpen) {
      parsed = applyStrictAttributionSoftPenalty(
        parsed,
        input.draft,
        input.recentContext,
        input.retrievedCanonNarrative,
      );
    }
  }

  return {
    ...parsed,
    ...(attributionJudgeMeta ? { attribution_judge: attributionJudgeMeta } : {}),
  };
}
