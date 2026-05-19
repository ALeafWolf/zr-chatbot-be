import type { OrchestrationStreamEvent } from "../thought/thoughtTypes";

const VALIDATED_REPLY_REPLAY_SLICE = 96;

export function filterDrafterFacingIssues(issues: string[]): string[] {
  return issues.filter((i) => !isMetaValidatorIssue(i));
}

export async function* replayValidatedDraftDeltas(
  text: string,
  signal?: AbortSignal,
): AsyncGenerator<Extract<OrchestrationStreamEvent, { type: "delta" }>> {
  for (let i = 0; i < text.length; ) {
    if (signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    const j = Math.min(i + VALIDATED_REPLY_REPLAY_SLICE, text.length);
    yield { type: "delta", text: text.slice(i, j) };
    i = j;
  }
}

function isMetaValidatorIssue(issue: string): boolean {
  return /\b(json|parse|validator|schema|zod)\b/i.test(issue);
}
