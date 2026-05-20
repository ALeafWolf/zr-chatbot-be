export type ThoughtKind =
  | "recall"
  | "tool_decision"
  | "tool_result"
  | "drafting"
  | "rewrite"
  | "deflect"
  | "native";

export interface Thought {
  kind: ThoughtKind;
  text: string;
  ts: number;
  meta?: unknown;
}

export type OrchestrationStreamEvent =
  | { type: "thought"; thought: Thought }
  | { type: "delta"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      args: unknown;
    }
  | { type: "tool_result"; id: string; name: string; summary: string };
