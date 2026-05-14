import { z } from "zod";
import { traceable } from "langsmith/traceable";
import { env } from "../../config/env";
import { models } from "../../config/models";
import { chatJsonStream } from "../providers";

export interface AttributionJudgeResult {
  has_attribution_claim: boolean;
  claim?: { subject: string; predicate: string; object: string };
  supported_by_canon: boolean;
  supported_by_transcript: boolean;
  fail_reason?: string;
}

const FAIL_OPEN_VERDICT: AttributionJudgeResult = {
  has_attribution_claim: false,
  supported_by_canon: true,
  supported_by_transcript: true,
};

const JudgeSchema = z.object({
  has_attribution_claim: z.boolean(),
  claim: z
    .object({
      subject: z.string(),
      predicate: z.string(),
      object: z.string(),
    })
    .optional(),
  supported_by_canon: z.boolean(),
  supported_by_transcript: z.boolean(),
  fail_reason: z.string().optional(),
});

const ATTRIBUTION_JUDGE_SYSTEM = `You are an attribution checker for Chinese character roleplay.
From the draft, extract at most ONE subject-predicate-object claim about who did what (agency: who proposed a trip, who arranged an outing, who initiated, etc.). If there is no such claim, set has_attribution_claim to false.
Decide if that claim is directly supported by the retrieved canon excerpt and/or the recent transcript. If unsupported or only guessed, set both supported_by_canon and supported_by_transcript to false as appropriate.
Return ONLY valid JSON with keys: has_attribution_claim, optional claim {subject, predicate, object}, supported_by_canon, supported_by_transcript, optional fail_reason.`;

export interface AttributionJudgeRun {
  verdict: AttributionJudgeResult;
  usedFailOpen: boolean;
}

async function attributionJudgeCore(input: {
  draft: string;
  retrievedCanonNarrative: string;
  recentContext: string;
  signal?: AbortSignal;
}): Promise<AttributionJudgeRun> {
  const user = `
Retrieved canon excerpt (may be partial):
"""
${input.retrievedCanonNarrative.trim().slice(0, 6000)}
"""

Recent transcript and context:
"""
${input.recentContext.trim().slice(0, 4000)}
"""

Draft reply:
"""
${input.draft.trim().slice(0, 4000)}
"""

Return the JSON object.`.trim();

  const res = await chatJsonStream(
    models.attributionJudge,
    [
      { role: "system", content: ATTRIBUTION_JUDGE_SYSTEM },
      { role: "user", content: user },
    ],
    JudgeSchema,
    { maxTokens: 512, temperature: 0.1, signal: input.signal },
  );

  if (!res.ok) {
    return { verdict: FAIL_OPEN_VERDICT, usedFailOpen: true };
  }

  return { verdict: res.data, usedFailOpen: false };
}

export const runAttributionJudge = traceable(attributionJudgeCore, {
  name: "llm.run_attribution_judge",
  run_type: "llm",
  project_name: env.LANGSMITH_PROJECT,
  tags: ["phase1", "llm", "phase:tier4", "subsystem:llm"],
  processInputs: (inputs: Readonly<Record<string, unknown>>) => ({
    draft_chars: typeof inputs.draft === "string" ? inputs.draft.length : 0,
    canon_chars:
      typeof inputs.retrievedCanonNarrative === "string"
        ? inputs.retrievedCanonNarrative.length
        : 0,
  }),
  processOutputs: (outputs: Readonly<Record<string, unknown>>) => {
    const run = outputs as unknown as AttributionJudgeRun;
    const v = run.verdict;
    return {
      claim_extracted: v.has_attribution_claim,
      supported_by_canon: v.supported_by_canon,
      supported_by_transcript: v.supported_by_transcript,
      used_fail_open: run.usedFailOpen,
    };
  },
}) as (
  input: {
    draft: string;
    retrievedCanonNarrative: string;
    recentContext: string;
    signal?: AbortSignal;
  },
) => Promise<AttributionJudgeRun>;
