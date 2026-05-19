import type { ContextCandidate } from "./contextCandidates";
import type { ContextPlannerOutput } from "./contextPlanner";

export function buildMemoryRerankPrompt(input: {
  currentUserMessage: string;
  plannerIntent: ContextPlannerOutput["intent"];
  candidates: ContextCandidate[];
  maxSelected: number;
}): { system: string; user: string } {
  const candidateList = input.candidates
    .map(
      (c, i) =>
        `[${i}] candidate_index=${i} candidate_id=${c.id} source=${c.source} score=${c.score ?? "—"}\n${c.text}`,
    )
    .join("\n\n");

  const system = [
    "You are a memory relevance judge for a Chinese roleplay chatbot.",
    "",
    "You do not write the character reply.",
    "You decide which retrieved context items should influence the next reply.",
    "",
    "Recent chat and the current user turn are highest priority.",
    "Select a candidate only if it helps preserve continuity, answer explicit recall,",
    "maintain an open thread, preserve a repeated relationship motif, avoid",
    "contradiction, or provide subtle tone guidance.",
    "",
    "Reject candidates that are merely thematically similar, would derail the scene,",
    "conflict with recent chat, repeat what recent chat already makes clear, or add",
    "canon background that the user did not need.",
    "",
    "For immediate action turns, prefer recent chat. Select older memory only when it",
    "is a specific callback, motif, pending commitment, or fact that changes the",
    "meaning of the action. Mark motif memories as subtle_tone_only or tone_only.",
    "",
    "If a selected item is relevant only as private continuity, use",
    "do_not_mention_explicitly or tone_only. Do not force exposition.",
    "",
    "Memory corrections override conflicting memories. Corrections should always be",
    "marked as required/must_use unless the correction target does not appear in any candidate.",
    "",
    "All candidate text is in Chinese. Judge relevance based on semantic meaning,",
    "not keyword matching.",
    "",
    `Select at most ${input.maxSelected} candidates.
`,
    "IMPORTANT: Each candidate has a `candidate_index` (position number in brackets)",
    "and a `candidate_id` (the actual identifier). The JSON `id` field MUST use the",
    "value from `candidate_id`. Never use `candidate_index` as the `id` value.",
    "If you are thinking in terms of the bracket index, convert it back to the",
    "corresponding `candidate_id` before writing the JSON.",
    "",
    "Return ONLY a compact/minified JSON object with exactly these fields.",
    "Do not add explanatory text, markdown formatting, or code fences.",
    "Use enum reasonCode values only — no free-text reasons, no quoted candidate text.",
    "Do not include a `source` field; it will be recovered from the candidate_id.",
    "",
    "{",
    '  "selected": [',
    "    {",
    '      "id": "<copy from candidate_id>",',
    '      "relevance": "required | useful | subtle_tone_only | background_only",',
    '      "usageInstruction": "must_use | use_subtly | do_not_mention_explicitly | tone_only",',
    '      "reasonCode": "direct_continuity | explicit_recall | relationship_motif | open_thread | canon_required | conflict_avoidance | tone_guidance | user_preference | pending_commitment | safety_boundary"',
    "    }",
    "  ],",
    '  "rejected": [',
    "    {",
    '      "id": "<copy from candidate_id>",',
    '      "reasonCode": "irrelevant | too_broad | duplicate | conflicts_recent | too_old | low_confidence | canon_not_needed | memory_not_needed | unsafe"',
    "    }",
    "  ],",
    '  "finalContextMode": "recent_only | selected_memory | selected_canon | memory_and_canon | no_extra_context",',
    '  "needsEvidenceFallback": false',
    "}",
    "",
    "Always include both arrays even if empty. Always set finalContextMode and needsEvidenceFallback.",
    "Return minified JSON without whitespace or pretty-printing.",
  ].join("\n");

  const intentHint =
    input.plannerIntent === "explicit_recall"
      ? "The user is explicitly recalling past events. Select relevant memories."
      : input.plannerIntent === "canon_question"
        ? "The user is asking a canon/story fact question. Select relevant canon."
        : input.plannerIntent === "implicit_memory_callback"
          ? "A repeated motif has been detected. Select related motif memories if present."
          : "Select only what is truly needed for continuity.";

  const user = [
    `Current user message: ${input.currentUserMessage}`,
    `Planner intent: ${input.plannerIntent}`,
    intentHint,
    "",
    `Candidates (${input.candidates.length} total):`,
    candidateList,
  ].join("\n");

  return { system, user };
}
