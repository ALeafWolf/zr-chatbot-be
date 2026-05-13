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
  deterministic_guard_failures?: DeterministicGuardFailure[];
  /** When strict attribution runs the LLM judge and gets a parsed verdict (not fail-open). */
  attribution_judge?: AttributionJudgeResult;
}

export type DeterministicGuardKind =
  | "meta_assistant_language"
  | "scope_leakage"
  | "nsfw_bounds";

export interface DeterministicGuardFailure {
  kind: DeterministicGuardKind;
  issue: string;
  matched: string;
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

const META_LANGUAGE_PATTERNS = [
  /\bAI\b/i,
  /\bartificial intelligence\b/i,
  /\blanguage model\b/i,
  /\bLLM\b/i,
  /\bchatbot\b/i,
  /\bassistant\b/i,
  /\u4eba\u5de5\u667a\u80fd/u,
  /\u8bed\u8a00\u6a21\u578b/u,
  /\u5927\u6a21\u578b/u,
  /\u0041\u0049\u52a9\u624b/u,
] as const;

const RELATIONSHIP_SCOPE_LEAKAGE: Array<{
  scopePattern: RegExp;
  forbidden: RegExp[];
}> = [
  {
    scopePattern: /main_situationship|main_relationship/,
    forbidden: [
      /\u8ba2\u5a5a/u,
      /\u7ed3\u5a5a/u,
      /\u5a5a\u793c/u,
      /\u672a\u5a5a\u59bb/u,
      /\u59bb\u5b50/u,
      /\u4e08\u592b/u,
    ],
  },
  {
    scopePattern: /main_engaged/,
    forbidden: [/\u7ed3\u5a5a/u, /\u5a5a\u793c/u, /\u59bb\u5b50/u, /\u4e08\u592b/u],
  },
] as const;

const EXPLICIT_NSFW_PATTERNS = [
  /\bsex\b/i,
  /\bfuck\b/i,
  /\borgasm\b/i,
  /\u6027\u7231/u,
  /\u505a\u7231/u,
  /\u9ad8\u6f6e/u,
  /\u88f8/u,
] as const;

function firstPatternMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[0]) return m[0];
  }
  return null;
}

export function runDeterministicValidatorGuards(
  input: Pick<ValidatorInput, "draft" | "continuityScope" | "maxNsfwLevel">,
): DeterministicGuardFailure[] {
  const failures: DeterministicGuardFailure[] = [];
  const draft = input.draft;

  const metaMatch = firstPatternMatch(draft, META_LANGUAGE_PATTERNS);
  if (metaMatch) {
    failures.push({
      kind: "meta_assistant_language",
      matched: metaMatch,
      issue:
        "Reply contains AI/assistant/meta language that breaks character.",
    });
  }

  for (const rule of RELATIONSHIP_SCOPE_LEAKAGE) {
    if (!rule.scopePattern.test(input.continuityScope)) continue;
    const match = firstPatternMatch(draft, rule.forbidden);
    if (match) {
      failures.push({
        kind: "scope_leakage",
        matched: match,
        issue:
          "Reply references relationship status beyond the active continuity scope.",
      });
      break;
    }
  }

  const nsfwLevel = input.maxNsfwLevel.trim().toLowerCase();
  if (nsfwLevel === "none" || nsfwLevel === "low") {
    const nsfwMatch = firstPatternMatch(draft, EXPLICIT_NSFW_PATTERNS);
    if (nsfwMatch) {
      failures.push({
        kind: "nsfw_bounds",
        matched: nsfwMatch,
        issue: "Reply contains explicit sexual content beyond the active scope.",
      });
    }
  }

  return failures;
}

function validationFromDeterministicFailures(
  failures: DeterministicGuardFailure[],
): ValidationResult {
  return {
    in_character: !failures.some((f) => f.kind === "meta_assistant_language"),
    canon_consistent: !failures.some((f) => f.kind === "scope_leakage"),
    session_state_consistent: true,
    nsfw_within_bounds: !failures.some((f) => f.kind === "nsfw_bounds"),
    issues: failures.map((f) => f.issue),
    needs_rewrite: true,
    deterministic_guard_failures: failures,
  };
}

const VALIDATOR_SYSTEM_PROMPT = `You are a balanced character-consistency validator for a character roleplay system.
Analyze the given draft response and return a JSON object — nothing else.

Principles (read before each check):
- The recent transcript + current user message are the live session truth for what is happening *right now*. Retrieved canon is RAG context: it may contain multiple unrelated scenes or chapters. Do NOT merge those scenes into one rigid timeline, and do NOT reject a draft because a different scene mentions the same calendar word (e.g. "周六") or the same broad place name unless the transcript clearly shows the user and character are continuing *that same* established beat.
- Prefer transcript continuity over tangential canon. If the user is clearly in a casual or self-contained thread (e.g. tickets, invitation) and the draft follows that thread, treat conflicts with unrelated retrieved scenes as non-blocking: note them in issues only if helpful, but keep canon_consistent true unless the draft explicitly contradicts a fact already stated in the transcript or the same named in-session event.
- In-character improvisation is allowed: minor NPCs, colleagues, or plausible scheduling details that are not contradicted by the transcript should not by themselves make session_state_consistent false. Only fail when the draft ignores the user's stated actions, contradicts an explicit prior line in the transcript, or breaks mode/NSFW rules.

Check all of the following:
1. in_character: Does the reply stay fully in character? (false if it claims to be AI, breaks the fourth wall, or uses out-of-character phrasing)
2. canon_consistent: Does the reply avoid contradicting facts that are explicit in the provided transcript or that clearly bind this session? The retrieved canon excerpt is partial and multi-scene—not exhaustive lore. Do not fail solely because the draft does not reference canon, or because canon from another scene could be read as a different commitment. Fail only on clear contradiction with (a) the transcript / current user message, or (b) the excerpt when the same entity, promise, or event is clearly continued in the transcript and the draft denies or rewrites it.
3. session_state_consistent: Does the reply respect the current user message and recent transcript (callbacks, objects, questions)? Allow reasonable invented detail that does not conflict with those. Do not fail solely for new names or off-screen logistics unless they contradict the transcript or the user's prompt.
4. nsfw_within_bounds: Is the NSFW content level within the allowed max_nsfw_level and escalation_rule?
5. issues: List specific problems (empty if none). Prefer concise, actionable notes; avoid speculative cross-chapter timeline accusations when the session transcript does not establish that linkage.
6. needs_rewrite: true only if a check above actually failed for user-visible quality or safety—not for optional canon alignment alone.

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
  return `Retrieved canon narrative (RAG excerpt; may include several unrelated scenes—not one fused timeline):
"""
${body}
"""`;
}

/** Anthropic/OpenAI-style overload / capacity — safe to retry and eventually fail-open for the validator. */
function isProviderOverloadOrRateLimit(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const st = (err as { status?: number }).status;
    if (st === 429 || st === 503 || st === 529) return true;
    const nestedType = (err as { error?: { type?: string } }).error?.type;
    if (nestedType === "overloaded_error") return true;
  }
  const text =
    err instanceof Error
      ? err.message
      : (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })();
  const lower = text.toLowerCase();
  return (
    lower.includes("overloaded") ||
    lower.includes("overloaded_error") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    /\b529\b/.test(text) ||
    /\b429\b/.test(text)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VALIDATOR_LLM_BACKOFF_MS = [800, 2000, 4500] as const;
const VALIDATOR_LLM_MAX_ATTEMPTS = VALIDATOR_LLM_BACKOFF_MS.length + 1;

export async function runResponseValidator(
  input: ValidatorInput,
): Promise<ValidationResult> {
  const deterministicFailures = runDeterministicValidatorGuards(input);
  if (deterministicFailures.length > 0) {
    return validationFromDeterministicFailures(deterministicFailures);
  }

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

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: VALIDATOR_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  type ValidatorChatOutcome = Awaited<
    ReturnType<typeof chatJsonStream<z.infer<typeof ValidationResultSchema>>>
  >;
  let result: ValidatorChatOutcome | undefined;

  for (let attempt = 0; attempt < VALIDATOR_LLM_MAX_ATTEMPTS; attempt++) {
    try {
      result = await chatJsonStream(
        models.validator,
        messages,
        ValidationResultSchema,
        { maxTokens: 512, temperature: 0.1, signal: input.signal },
      );
      break;
    } catch (err) {
      const retriable = isProviderOverloadOrRateLimit(err);
      const lastAttempt = attempt >= VALIDATOR_LLM_MAX_ATTEMPTS - 1;
      if (!retriable || lastAttempt) {
        if (retriable) {
          console.warn(
            "[runResponseValidator] validator LLM overloaded after retries; fail-open (accept draft).",
            err,
          );
          return VALIDATOR_FAIL_OPEN;
        }
        throw err;
      }
      console.warn(
        `[runResponseValidator] validator LLM transient error (attempt ${attempt + 1}/${VALIDATOR_LLM_MAX_ATTEMPTS}), retrying after backoff…`,
        err,
      );
      await sleep(VALIDATOR_LLM_BACKOFF_MS[attempt]!);
      if (input.signal?.aborted) {
        throw Object.assign(new Error("Aborted"), { name: "AbortError" });
      }
    }
  }

  if (result === undefined) {
    return VALIDATOR_FAIL_OPEN;
  }

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
