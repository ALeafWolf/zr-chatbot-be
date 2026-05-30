import { z } from "zod";
import { CANON_PROMPT_LIMITS } from "../../character/canonRules";
import { models } from "../../config/models";
import {
  chatJsonStreamWithFallback,
  isFallbackableLlmError,
} from "../providers";
import { env } from "../../config/env";
import type { CanonTruthMode } from "../../orchestration/prompt/buildPromptContext";
import {
  runAttributionJudge,
  type AttributionJudgeResult,
} from "./runAttributionJudge";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";

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
  | "nsfw_bounds"
  | "canon_unsupported_claim"
  | "temporal_premise_contradiction"
  | "unsupported_autobiographical_claim"
  | "self_analysis_leakage";

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
  /** Whether canon was injected in the prompt for this turn (true in eager mode). */
  wasCanonInjected?: boolean;
  /** Reranker-selected memory sources with usage instructions. */
  selectedMemorySources?: Array<{ source: string; relevance: string; usageInstruction: string }>;
  /** Canon truth mode for this turn (derived in buildPromptContext). */
  canonTruthMode?: CanonTruthMode;
  signal?: AbortSignal;
}

const CANON_ATTRIBUTION_CUES =
  /(?:提议|安排|第一次|第二次|谁先|谁提出|在.*章|根据原作|剧情中|原作中|原著|小说里)/u;

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

/** Whether strict attribution should run — requires real canon evidence, not a placeholder. */
export function isStrictAttributionEligible(wasCanonInjected: boolean | undefined): boolean {
  return !!wasCanonInjected;
}

export const __testing = { isStrictAttributionEligible, applyAttributionVerdictMerge };

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

export function runCanonEvidenceCheck(input: {
  draft: string;
  wasCanonInjected?: boolean;
}): DeterministicGuardFailure[] {
  if (input.wasCanonInjected) return [];
  if (!CANON_ATTRIBUTION_CUES.test(input.draft)) return [];
  return [
    {
      kind: "canon_unsupported_claim",
      matched: input.draft.slice(0, 100),
      issue:
        "Response asserts canon-attribution facts but no canon was injected in this turn. Rely on injected canon narrative or remove the unsupported claim.",
    },
  ];
}

/**
 * Extract content-bearing 2-grams (bigrams) from a Chinese text.
 *
 * Chinese text has no word separators, so splitting on punctuation is
 * insufficient. Character bigrams capture place names ("枫河", "民宿"),
 * named entities, and other meaningful terms without needing a segmenter.
 * Single characters and common stopword bigrams are filtered out.
 */
function extractContentTerms(text: string): Set<string> {
  const STOPWORDS = new Set([
    "的", "了", "在", "是", "我", "你", "他", "她", "它", "们",
    "这", "那", "哪", "什", "么", "怎", "为", "吗", "吧", "呢",
    "啊", "哦", "嗯", "哈", "呀", "嘛", "还", "也", "就", "都",
    "和", "与", "或", "但", "不", "没", "有", "要", "会",
    "能", "可", "以", "对", "到", "从", "上", "下", "去", "来",
    "给", "为", "把", "被", "让", "向", "跟", "比",
    "因为", "所以", "如果", "虽然", "但是", "而且", "然后", "之后",
    "自己", "知道", "觉得", "可以", "没有",
    "什么", "时候", "怎么", "因为", "所以", "已经", "看见",
    "我们", "你们", "他们", "她们", "它们",
    "这么", "那么", "这样", "那样",
    // Temporal/conversational glue bigrams — avoid matching on
    // ordinal/timephrases instead of actual named entities
    "第一", "一次", "二次", "次去", "次来", "次给", "次写",
    "记得", "还给", "给你", "给我", "我们", "你们",
  ]);

  const terms = new Set<string>();
  // Remove punctuation & whitespace first
  const cleaned = text.replace(
    /[\s,，。！？、；：""''（）()【】《》/\\|…—·～~`!@#$%^&*+=\-\[\]{}<>?？'";:]/gu,
    "",
  );
  // Extract bigrams (2-character sequences)
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bigram = cleaned.slice(i, i + 2);
    if (STOPWORDS.has(bigram)) continue;
    terms.add(bigram.toLowerCase());
  }
  return terms;
}

/**
 * Extract text from prior assistant lines in the recent context.
 *
 * The recent context is formatted with role labels:
 *   assistant: ...
 *   user: ...
 *
 * Only lines prefixed with `assistant:` (case-insensitive) are returned.
 * This is used to check if the assistant's own prior statements support
 * a user's autobiographical claim.
 */
function extractAssistantLinesFromContext(context: string): string[] {
  const lines = context.split("\n");
  const assistantLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^assistant:/i.test(trimmed)) {
      const content = trimmed.replace(/^assistant:\s*/i, "").trim();
      if (content) assistantLines.push(content);
    }
  }
  return assistantLines;
}

/**
 * Temporal false-premise guard.
 *
 * When the user's current message contains a first-visit claim ("第一次"/"首次")
 * but injected canon shows return-visit markers ("再次"/"又"/"上回"/"前次"/"第二次"),
 * the draft must contain an explicit correction. If it instead implicitly accepts
 * the false premise (no correction), flag it for rewrite.
 *
 * A content-term overlap gate prevents false positives: at least one non-stopword
 * term from the user's context must also appear in the canon (e.g. "枫河" or "民宿").
 */
export function runTemporalPremiseGuard(input: {
  draft: string;
  recentContext?: string;
  wasCanonInjected?: boolean;
  retrievedCanonNarrative?: string;
}): DeterministicGuardFailure[] {
  if (!input.wasCanonInjected) return [];
  if (!input.recentContext) return [];

  const canon = (input.retrievedCanonNarrative ?? "").toLowerCase();
  const context = input.recentContext.toLowerCase();
  const draft = input.draft.toLowerCase();

  // Return-visit markers in canon (章节背景/开场背景 showing a return visit)
  const canonReturnMarkers = ["再次", "又", "上回", "前次", "第二次"];

  // First-visit claims in the user message/recent context
  const userFirstVisitMarkers = ["第一次", "首次"];

  // Correction markers the draft would use if it properly addressed the contradiction.
  // Expanded to include calm correction phrasings beyond exact "第二次" wording.
  const draftCorrectionMarkers = [
    "第二次", "是第二次", "不是第一次", "再次", "上回说",
    "我记得不太一样", "记得不太一样", "并不是第一次", "不算第一次",
    "你记错了一点", "你记错了",
  ];

  // Check if user context contains a first-visit claim
  const hasUserFirstClaim = userFirstVisitMarkers.some((m) => context.includes(m));
  if (!hasUserFirstClaim) return [];

  // Check if canon confirms a return/not-first visit
  const hasReturnInCanon = canonReturnMarkers.some((m) => canon.includes(m));
  if (!hasReturnInCanon) return [];

  // Content-term overlap gate: at least one meaningful term from the user
  // context must appear in the canon. This prevents flagging unrelated
  // turns where retrieved canon happens to contain return markers about a
  // different event/place.
  const userTerms = extractContentTerms(context);
  const canonTerms = extractContentTerms(canon);
  let hasSharedTerm = false;
  for (const term of userTerms) {
    if (canonTerms.has(term) || canon.includes(term)) {
      hasSharedTerm = true;
      break;
    }
  }
  if (!hasSharedTerm) return [];

  // If the draft already contains a correction, no issue
  const hasDraftCorrection = draftCorrectionMarkers.some((m) => draft.includes(m));
  if (hasDraftCorrection) return [];

  return [
    {
      kind: "temporal_premise_contradiction",
      matched: `User says "第一次" but canon shows a return visit; draft does not correct the temporal premise.`,
      issue:
        "Draft implicitly accepts the user's temporal false premise. The user claims 'first time' but injected canon shows a return visit (再次/又/上回/前次). Revise: the first sentence should calmly correct the premise (e.g. '我记得不太一样，那应该是我们第二次去枫河了……') before continuing with the memory.",
    },
  ];
}

/**
 * Unsupported autobiographical agreement guard.
 *
 * Trigger when user context contains autobiographical claim cues
 * (e.g. "你以前说过", "你不是说过", "你小时候") and the draft
 * directly confirms or invents backstory to support the claim,
 * without clear support from recent context or injected canon.
 *
 * Does NOT flag when:
 * - The draft is cautious or uncertain ("不记得", "不能确定").
 * - Recent context already contains the assistant's own prior statement.
 * - Injected canon contains the same claim/terms.
 */
export function runUnsupportedAutobiographicalClaimGuard(input: {
  draft: string;
  recentContext?: string;
  wasCanonInjected?: boolean;
  retrievedCanonNarrative?: string;
}): DeterministicGuardFailure[] {
  if (!input.recentContext) return [];
  const context = input.recentContext.toLowerCase();
  const draft = input.draft.toLowerCase();
  const canon = (input.retrievedCanonNarrative ?? "").toLowerCase();

  // User autobiographical claim cues — must include a past/autobiographical
  // framing (e.g. "你以前说过"), not bare conversational tags like "是吧".
  const userClaimCues = [
    "你以前说过", "你不是说过", "你以前经历过",
    "你小时候", "你一直不喜欢", "你以前喜欢",
    "你以前做过", "你不是一直",
  ];
  const hasUserClaim = userClaimCues.some((c) => context.includes(c));
  if (!hasUserClaim) return [];

  // Draft cautious/uncertain cues — if present, do not flag
  const draftCautiousCues = [
    "不记得", "不能确定", "不确定", "我这样说过吗",
    "如果我那样说过", "可能说得不够准确",
  ];
  const hasCautiousDraft = draftCautiousCues.some((c) => draft.includes(c));
  if (hasCautiousDraft) return [];

  // Draft agreement or backstory invention cues
  const draftAgreementCues = [
    "确实说过", "是这样", "没错",
    "小时候", "那时候", "所以我才",
    "我一直", "其实我",
  ];
  const hasAgreement = draftAgreementCues.some((c) => draft.includes(c));
  if (!hasAgreement) return [];

  // Check if the user's autobiographical claim is already supported by a
  // prior assistant statement in the recent context. The context is formatted
  // with role labels: "assistant: ..." and "user: ...". Extract only the
  // assistant lines and check for content-term overlap with the user context.
  const assistantLines = extractAssistantLinesFromContext(context);
  let contextSupportsClaim = false;
  if (assistantLines.length > 0) {
    const userTerms = extractContentTerms(context);
    for (const line of assistantLines) {
      const lineTerms = extractContentTerms(line);
      for (const term of userTerms) {
        if (lineTerms.has(term)) {
          contextSupportsClaim = true;
          break;
        }
      }
      if (contextSupportsClaim) break;
    }
  }

  // If canon was injected and shares content terms with the user context,
  // assume the claim is supported by evidence.
  if (!contextSupportsClaim && input.wasCanonInjected && canon.length > 0) {
    const contextTerms = extractContentTerms(context);
    const canonTerms = extractContentTerms(canon);
    for (const term of contextTerms) {
      if (canonTerms.has(term) || canon.includes(term)) {
        contextSupportsClaim = true;
        break;
      }
    }
  }

  if (contextSupportsClaim) return [];

  return [
    {
      kind: "unsupported_autobiographical_claim",
      matched: `User claims "${userClaimCues.find((c) => context.includes(c)) ?? "autobiographical claim"}" but no supporting context or canon found.`,
      issue:
        "Draft confirms or invents backstory for an autobiographical claim that is not supported by recent context or injected canon. Revise: do not confirm unsupported claims or invent explanatory backstory. Use cautious responses such as '我不记得自己这样说过' or '我不能确定那是不是我的原话.', then continue naturally.",
    },
  ];
}

/**
 * Self-analysis leakage guard (P04 disclosure-pressure).
 *
 * Trigger only when disclosure-pressure cues are present in recent context
 * and the draft contains high-signal self-analysis phrases explaining the
 * character's own psychological patterns or expression habits.
 *
 * Does NOT flag when:
 * - No disclosure-pressure cues are present (normal conversation).
 * - The draft describes embodied action or concrete current concern.
 */
export function runSelfAnalysisLeakageGuard(input: {
  draft: string;
  recentContext?: string;
}): DeterministicGuardFailure[] {
  if (!input.recentContext) return [];

  const context = input.recentContext.toLowerCase();
  const draft = input.draft.toLowerCase();

  // Disclosure-pressure cues in user context
  const pressureCues = [
    "真话", "什么感受", "不要转移话题",
    "告诉我", "你到底在想什么",
  ];
  const hasPressure = pressureCues.some((c) => context.includes(c));
  if (!hasPressure) return [];

  // Self-analysis phrases that the character should avoid
  const selfAnalysisPhrases = [
    "我习惯", "我不擅长", "我怕说出来",
    "我需要先想清楚", "我不知道该怎么表达",
    "整理自己的感受", "我害怕说",
  ];
  const hasSelfAnalysis = selfAnalysisPhrases.some((p) => draft.includes(p));
  if (!hasSelfAnalysis) return [];

  return [
    {
      kind: "self_analysis_leakage",
      matched: `Draft contains self-analysis phrasing under disclosure pressure.`,
      issue:
        "Draft explains the character's psychological pattern ('我习惯…', '我不擅长…') instead of showing enacted restraint. Revise: use pause, silence, embodied restraint, or limited concrete disclosure instead of self-analysis. If pressed, the character may disclose a specific current concern, not explain why they express themselves the way they do.",
    },
  ];
}

export function runDeterministicValidatorGuards(
  input: Pick<
    ValidatorInput,
    | "draft"
    | "continuityScope"
    | "maxNsfwLevel"
    | "wasCanonInjected"
    | "retrievedCanonNarrative"
    | "recentContext"
  >,
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

  // Temporal false-premise guard
  const temporalFailures = runTemporalPremiseGuard({
    draft,
    recentContext: input.recentContext,
    wasCanonInjected: input.wasCanonInjected,
    retrievedCanonNarrative: input.retrievedCanonNarrative,
  });
  failures.push(...temporalFailures);

  // Unsupported autobiographical agreement guard
  const autoFailures = runUnsupportedAutobiographicalClaimGuard({
    draft,
    recentContext: input.recentContext,
    wasCanonInjected: input.wasCanonInjected,
    retrievedCanonNarrative: input.retrievedCanonNarrative,
  });
  failures.push(...autoFailures);

  // Self-analysis leakage guard (P04 disclosure-pressure)
  const analysisFailures = runSelfAnalysisLeakageGuard({
    draft,
    recentContext: input.recentContext,
  });
  failures.push(...analysisFailures);

  return failures;
}

function validationFromDeterministicFailures(
  failures: DeterministicGuardFailure[],
): ValidationResult {
  return {
    in_character: !failures.some(
      (f) =>
        f.kind === "meta_assistant_language" ||
        f.kind === "unsupported_autobiographical_claim" ||
        f.kind === "self_analysis_leakage",
    ),
    // Note: unsupported_autobiographical_claim is intentionally excluded from
    // canon_consistent because it is an in-character/truthfulness failure, not
    // a canon-timeline contradiction (see design.md).
    canon_consistent: !failures.some(
      (f) => f.kind === "scope_leakage" || f.kind === "temporal_premise_contradiction",
    ),
    session_state_consistent: true,
    nsfw_within_bounds: !failures.some((f) => f.kind === "nsfw_bounds"),
    issues: failures.map((f) => f.issue),
    needs_rewrite: failures.length > 0,
    deterministic_guard_failures: failures,
  };
}

const VALIDATOR_SYSTEM_PROMPT = `You are a balanced character-consistency validator for a character roleplay system.
Analyze the given draft response and return a JSON object — nothing else.

Evidence hierarchy (read before each check):
- Recent transcript + current user message = highest-priority live truth for what is happening *right now*.
- Selected context (memory/session sources listed in the prompt) = secondary evidence to follow when present.
- Retrieved canon = tertiary, optional evidence. Injected canon may be absent on many turns. When no canon is provided, treat canon_consistent as "does not contradict transcript/context" rather than "all canon-flavored wording must have proof."
- Retrieved canon is RAG context: it may contain multiple unrelated scenes or chapters. Do NOT merge those scenes into one rigid timeline, and do NOT reject a draft because a different scene mentions the same calendar word (e.g. "周六") or the same broad place name unless the transcript clearly shows the user and character are continuing *that same* established beat.
- **Temporal false-premise check**: If the user says "第一次..." (first time) or "上回..." (last time) but the injected canon narrative shows "再次" / "又" / "第二次" (return visit) for the same location/event, the draft must NOT accept the user's false premise. Flag canon_consistent as false and request a rewrite that reflects the true temporal order from canon. Exception: recent chat (current session transcript) still takes priority — canon only overrides user premises when it directly contradicts the same event/place.
- Prefer transcript continuity over tangential canon. If the user is clearly in a casual or self-contained thread (e.g. tickets, invitation) and the draft follows that thread, treat conflicts with unrelated retrieved scenes as non-blocking: note them in issues only if helpful, but keep canon_consistent true unless the draft explicitly contradicts a fact already stated in the transcript or the same named in-session event.
- In-character improvisation is allowed: minor NPCs, colleagues, or plausible scheduling details that are not contradicted by the transcript should not by themselves make session_state_consistent false. Only fail when the draft ignores the user's stated actions, contradicts an explicit prior line in the transcript, or breaks mode/NSFW rules.

Check all of the following:
1. in_character: Does the reply stay fully in character? (false if it claims to be AI, breaks the fourth wall, or uses out-of-character phrasing)
2. canon_consistent: Does the reply avoid contradicting facts that are explicit in the provided transcript or that clearly bind this session? The retrieved canon excerpt is partial and multi-scene—not exhaustive lore. Do not fail solely because the draft does not reference canon, or because canon from another scene could be read as a different commitment. When no canon is provided, this check defaults to "does the draft contradict transcript/selected-context evidence?" — not "does every claim have external proof." Fail only on clear contradiction with (a) the transcript / current user message, or (b) provided canon when it is actually injected and the same entity/event is continued in the transcript.
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

/**
 * Merge an attribution judge verdict into the validation result.
 *
 * When the judge finds an unsupported concrete canon-history claim, the
 * validation result is marked canon-inconsistent and needs rewrite.
 * Returns the (possibly updated) validation result unchanged when the
 * judge found no unsupported claim or the claim is supported.
 */
export function applyAttributionVerdictMerge(
  current: ValidationResult,
  judgeRun: { usedFailOpen: boolean; verdict: AttributionJudgeResult },
): ValidationResult {
  if (judgeRun.usedFailOpen) return current;
  const v = judgeRun.verdict;
  if (!v.has_attribution_claim) return current;
  if (v.supported_by_canon || v.supported_by_transcript) return current;

  const claimStr = v.claim
    ? `${v.claim.subject}/${v.claim.predicate}/${v.claim.object}`
    : "…";
  return {
    ...current,
    canon_consistent: false,
    needs_rewrite: true,
    issues: [
      ...current.issues,
      `Attribution claim "${claimStr}" not supported by retrieved canon or transcript. Verify with the provided evidence or omit.`,
    ],
  };
}

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
    return "(No retrieved canon for this turn.)";
  }
  const max = CANON_PROMPT_LIMITS.maxTotalChars;
  const body = t.length <= max ? t : `${t.slice(0, max)}…`;
  return `Retrieved canon narrative (RAG excerpt; may include several unrelated scenes—not one fused timeline):
"""
${body}
"""`;
}

function selectedContextForValidatorPrompt(
  sources?: Array<{ source: string; relevance: string; usageInstruction: string }>,
): string {
  if (!sources || sources.length === 0) return "";
  const lines = sources.map(
    (s, i) =>
      `${i + 1}. source: ${s.source}, relevance: ${s.relevance}, usage: ${s.usageInstruction}`,
  );
  return `Selected context (sources provided to generation):
${lines.join("\n")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VALIDATOR_LLM_BACKOFF_MS = [800, 2000, 4500] as const;
const VALIDATOR_LLM_MAX_ATTEMPTS = VALIDATOR_LLM_BACKOFF_MS.length + 1;

export async function runResponseValidator(
  input: ValidatorInput,
): Promise<ValidationResult> {
  const deterministicFailures = runDeterministicValidatorGuards({
    draft: input.draft,
    continuityScope: input.continuityScope,
    maxNsfwLevel: input.maxNsfwLevel,
    wasCanonInjected: input.wasCanonInjected,
    retrievedCanonNarrative: input.retrievedCanonNarrative,
    recentContext: input.recentContext,
  });
  if (deterministicFailures.length > 0) {
    return validationFromDeterministicFailures(deterministicFailures);
  }

  const canonBlock = canonForValidatorPrompt(input.retrievedCanonNarrative ?? "");
  const selectedContextBlock = selectedContextForValidatorPrompt(input.selectedMemorySources);

  const userMessage = `
Character: ${input.characterId}
Continuity scope: ${input.continuityScope}
Session mode: ${input.mode}
Max NSFW level: ${input.maxNsfwLevel}
Escalation rule: ${input.escalationRule}
Out-of-scope behavior: ${input.outOfScopeChapterBehavior}

${canonBlock}
${selectedContextBlock ? `\n${selectedContextBlock}` : ""}

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
    ReturnType<typeof chatJsonStreamWithFallback<z.infer<typeof ValidationResultSchema>>>
  >;
  let result: ValidatorChatOutcome | undefined;

  for (let attempt = 0; attempt < VALIDATOR_LLM_MAX_ATTEMPTS; attempt++) {
    try {
      result = await chatJsonStreamWithFallback(
        models.validator,
        models.fallbacks.responseValidator,
        messages,
        ValidationResultSchema,
        { maxTokens: 512, temperature: 0.1, signal: input.signal },
      );
      break;
    } catch (err) {
      const retriable = isFallbackableLlmError(err, input.signal);
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
    return attachTraceLlmMetadata(
      { ...VALIDATOR_FAIL_OPEN },
      {
        binding: result.binding,
        modelRole: "validator",
        usage: result,
        fallback: { used: result.fallbackUsed, attempts: result.fallbackAttempts },
      },
    );
  }

  let parsed = result.data;
  let attributionJudgeMeta: AttributionJudgeResult | undefined;

  const strictAttributionEligible = isStrictAttributionEligible(input.wasCanonInjected);
  const strictModeForceAttribution = input.canonTruthMode === "strict_canon_recall" && input.wasCanonInjected;
  if (strictModeForceAttribution || (env.VALIDATOR_STRICT_ATTRIBUTION && strictAttributionEligible)) {
    const canonEvidence = input.retrievedCanonNarrative ?? "";
    const judgeRun = await runAttributionJudge({
      draft: input.draft,
      retrievedCanonNarrative: canonEvidence,
      recentContext: input.recentContext,
      signal: input.signal,
    });

    if (!judgeRun.usedFailOpen) {
      attributionJudgeMeta = judgeRun.verdict;
    }

    parsed = applyAttributionVerdictMerge(parsed, judgeRun);

    if (judgeRun.usedFailOpen) {
      parsed = applyStrictAttributionSoftPenalty(
        parsed,
        input.draft,
        input.recentContext,
        canonEvidence,
      );
    }
  }

  return attachTraceLlmMetadata(
    {
      ...parsed,
      ...(attributionJudgeMeta ? { attribution_judge: attributionJudgeMeta } : {}),
    },
    {
      binding: result.binding,
      modelRole: "validator",
      usage: result,
      fallback: { used: result.fallbackUsed, attempts: result.fallbackAttempts },
    },
  );
}
