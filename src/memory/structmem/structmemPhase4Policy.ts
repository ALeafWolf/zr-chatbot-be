import type { MemoryCandidate } from "../interactive/writeInteractiveMemory";

export type StructMemStableCategory =
  | "promise_or_commitment"
  | "stable_relationship_pattern"
  | "relationship_milestone"
  | "recurring_preference"
  | "repeated_habit"
  | "interaction_style_or_inside_joke";

export type InteractiveMemoryType = MemoryCandidate["memoryType"];

const CATEGORY_TO_MEMORY_TYPE: Record<
  StructMemStableCategory,
  InteractiveMemoryType
> = {
  promise_or_commitment: "promise",
  stable_relationship_pattern: "relationship_transition",
  relationship_milestone: "relationship_transition",
  recurring_preference: "preference",
  repeated_habit: "habit",
  interaction_style_or_inside_joke: "banter",
};

export function mapStableCategoryToMemoryType(
  category: StructMemStableCategory,
): InteractiveMemoryType {
  return CATEGORY_TO_MEMORY_TYPE[category];
}

export function normalizeStableCategory(
  raw: unknown,
): StructMemStableCategory | unknown {
  if (typeof raw !== "string") return raw;
  const category = raw.trim().toLowerCase();
  switch (category) {
    case "promise":
    case "commitment":
    case "promise_or_commitment":
      return "promise_or_commitment";
    case "relationship_pattern":
    case "stable_relationship_pattern":
      return "stable_relationship_pattern";
    case "relationship_milestone":
      return "relationship_milestone";
    case "preference":
    case "user_preference":
    case "recurring_preference":
      return "recurring_preference";
    case "habit":
    case "repeated_habit":
      return "repeated_habit";
    case "inside_joke":
    case "interaction_style":
    case "interaction_style_or_inside_joke":
      return "interaction_style_or_inside_joke";
    default:
      return raw;
  }
}

export function shouldWriteCrossSessionStructMem(input: {
  enabled: boolean;
  sessionMode: string;
  writebackPolicy: string;
}): boolean {
  return (
    input.enabled &&
    input.sessionMode !== "sandbox" &&
    input.writebackPolicy !== "no_writeback"
  );
}

export function shouldPromoteStructMemToIme(input: {
  enabled: boolean;
  sessionMode: string;
  writebackPolicy: string;
}): boolean {
  return shouldWriteCrossSessionStructMem(input);
}
