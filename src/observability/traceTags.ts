export type TraceTurn = "foreground" | "background";

export type TraceSubsystem =
  | "retrieval"
  | "llm"
  | "post_turn"
  | "structmem"
  | "orchestration"
  | "memory";

const SUBSYSTEMS: readonly TraceSubsystem[] = [
  "retrieval",
  "llm",
  "post_turn",
  "structmem",
  "orchestration",
  "memory",
] as const;

const SUBSYSTEM_SET = new Set<string>(SUBSYSTEMS);

export function characterTag(characterId: string): string {
  return `character:${characterId}`;
}

export function turnTag(turn: TraceTurn): string {
  return `turn:${turn}`;
}

export function environmentTag(environment: string): string {
  return `env:${environment}`;
}

export function subsystemTag(subsystem: TraceSubsystem): string {
  return `subsystem:${subsystem}`;
}

export function evalTag(enabled: boolean): string[] {
  return enabled ? ["eval:true"] : [];
}

export function inferTraceSubsystem(name: string): TraceSubsystem {
  const lower = name.toLowerCase();
  if (lower.includes("structmem")) return "structmem";
  if (lower.startsWith("llm.")) return "llm";
  if (lower.startsWith("retrieval.")) return "retrieval";
  if (lower.startsWith("post_turn.")) return "post_turn";
  if (lower.startsWith("memory.")) return "memory";
  if (lower.startsWith("orchestration.")) return "orchestration";
  return "orchestration";
}

export function sanitizeTraceTags(tags: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!isApprovedTraceTag(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function isApprovedTraceTag(tag: string): boolean {
  if (tag === "eval:true") return true;
  if (tag === "turn:foreground" || tag === "turn:background") return true;
  if (tag.startsWith("character:")) return tag.length > "character:".length;
  if (tag.startsWith("env:")) return tag.length > "env:".length;
  if (!tag.startsWith("subsystem:")) return false;
  return SUBSYSTEM_SET.has(tag.slice("subsystem:".length));
}
