import { env } from "../../config/env";
import { postTurnRunner } from "../../jobs/postTurnRunner";
import { runCharacterTurn } from "../../orchestration/turn/runCharacterTurn";
import { withTraceContext } from "../../observability/langsmithTracing";
import {
  buildAgentEvalOutput,
  createAgentEvalCapture,
  type AgentEvalOutput,
  withAgentEvalCapture,
} from "../evalSnapshots";
import {
  buildExperimentVariantMetadata,
  buildExperimentVariantTags,
  readAndValidateExperimentVariants,
} from "../experimentVariants";
import { cleanupEvalSession } from "./cleanupEvalSession";
import type {
  AgentEvalInput,
  EvalSeedMessage,
  EvalSeededSession,
} from "./evalTypes";
import { seedEvalSession } from "./seedEvalSession";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(
  rec: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function normalizeMessages(value: unknown): EvalSeedMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const rec = asRecord(raw);
      const role = rec.role;
      const content = rec.content;
      if (
        (role !== "user" && role !== "assistant") ||
        typeof content !== "string"
      ) {
        return null;
      }
      return {
        ...(typeof rec.id === "string" ? { id: rec.id } : {}),
        role,
        content,
        ...(typeof rec.turnIndex === "number"
          ? { turnIndex: rec.turnIndex }
          : typeof rec.turn_index === "number"
            ? { turnIndex: rec.turn_index }
            : {}),
      };
    })
    .filter((message): message is EvalSeedMessage => message !== null);
}

function lastUserMessage(messages: EvalSeedMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user") return message.content;
  }
  return undefined;
}

export function normalizeAgentEvalInput(raw: Record<string, unknown>): AgentEvalInput {
  const scenarioId = readString(raw, "scenarioId", "scenario_id") ?? "unknown";
  const sessionRaw = asRecord(raw.sessionSeed ?? raw.session);
  const messages = normalizeMessages(raw.recentMessages ?? raw.messages);
  const explicitUserMessage = readString(raw, "userMessage", "user_message");
  const userMessage = explicitUserMessage ?? lastUserMessage(messages);
  if (!userMessage) {
    throw new Error("agent eval input missing userMessage");
  }
  const recentMessages = explicitUserMessage
    ? messages
    : messages.slice(0, Math.max(0, messages.length - 1));
  const continuityScope = readString(
    sessionRaw,
    "continuityScope",
    "continuity_scope",
  );
  const mode = readString(sessionRaw, "mode");
  if (!continuityScope || !mode) {
    throw new Error("agent eval input missing session mode/continuity scope");
  }

  return {
    scenarioId,
    userMessage,
    description: readString(raw, "description"),
    sessionSeed: {
      characterId:
        readString(sessionRaw, "characterId", "character_id") ??
        env.DEFAULT_CHARACTER_ID,
      mode,
      continuityScope,
      continuityFamily:
        readString(sessionRaw, "continuityFamily", "continuity_family") === "au"
          ? "au"
          : "main_world",
      auWorldKey: readString(sessionRaw, "auWorldKey", "au_world_key"),
      writebackPolicy:
        readString(sessionRaw, "writebackPolicy", "writeback_policy") ??
        (mode === "sandbox" ? "no_writeback" : "full_writeback"),
      thinking:
        typeof sessionRaw.thinking === "boolean"
          ? sessionRaw.thinking
          : undefined,
      temperature:
        typeof sessionRaw.temperature === "number"
          ? sessionRaw.temperature
          : undefined,
      personaOverlayId:
        typeof sessionRaw.personaOverlayId === "string"
          ? sessionRaw.personaOverlayId
          : typeof sessionRaw.persona_overlay_id === "string"
            ? sessionRaw.persona_overlay_id
            : undefined,
      displayTitle: readString(sessionRaw, "displayTitle", "display_title"),
      pinnedTime: readString(sessionRaw, "pinnedTime", "pinned_time"),
      pinnedLocation: readString(sessionRaw, "pinnedLocation", "pinned_location"),
    },
    recentMessages,
    sessionSummary: readString(raw, "sessionSummary", "session_summary"),
    sessionState: asRecord(raw.sessionState ?? raw.session_state),
    durableMemories: Array.isArray(raw.durableMemories)
      ? (raw.durableMemories as AgentEvalInput["durableMemories"])
      : Array.isArray(raw.primed_memories)
        ? (raw.primed_memories as AgentEvalInput["durableMemories"])
        : undefined,
    sessionChunks: Array.isArray(raw.sessionChunks)
      ? (raw.sessionChunks as AgentEvalInput["sessionChunks"])
      : undefined,
    structMemEntries: Array.isArray(raw.structMemEntries)
      ? (raw.structMemEntries as AgentEvalInput["structMemEntries"])
      : undefined,
    structMemConsolidations: Array.isArray(raw.structMemConsolidations)
      ? (raw.structMemConsolidations as AgentEvalInput["structMemConsolidations"])
      : undefined,
    canonReferenceIds: Array.isArray(raw.canonReferenceIds)
      ? (raw.canonReferenceIds as string[])
      : undefined,
    configOverrides: asRecord(raw.configOverrides ?? raw.config_overrides),
  };
}

export async function runAgentEval(
  rawInput: Record<string, unknown>,
): Promise<AgentEvalOutput> {
  // Validate experiment variants before any model calls or LangSmith traces.
  readAndValidateExperimentVariants();

  const input = normalizeAgentEvalInput(rawInput);
  let seeded: EvalSeededSession | null = null;
  let reply = "";
  let assistantMessageId: string | undefined;
  let turnIndex: number | undefined;
  let success = false;
  let error: string | undefined;

  seeded = await seedEvalSession(input);
  const capture = createAgentEvalCapture({
    scenarioId: input.scenarioId,
    evalSessionId: seeded.sessionId,
  });

  try {
    await withTraceContext(
      {
        eval: true,
        characterId: input.sessionSeed.characterId ?? env.DEFAULT_CHARACTER_ID,
        baseMetadata: {
          scenarioId: input.scenarioId,
          evalSessionId: seeded.sessionId,
          evalMode: "agent_turn",
          configOverrides: input.configOverrides ?? {},
          ...buildExperimentVariantMetadata(),
        },
        tags: buildExperimentVariantTags(),
      },
      async () =>
        await withAgentEvalCapture(capture, async () => {
          const turn = await runCharacterTurn({
            sessionId: seeded!.sessionId,
            userMessage: input.userMessage,
          });
          reply = turn.content;
          assistantMessageId = turn.assistantMessageId;
          turnIndex = turn.turnIndex;
          const jobId = capture.memoryWrite.postTurnJobId;
          if (jobId) {
            await postTurnRunner.runJobByIdForEval(jobId);
          }
          success = true;
        }),
    );
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const cleanup = await cleanupEvalSession(seeded);
  return buildAgentEvalOutput({
    capture,
    reply,
    assistantMessageId,
    turnIndex,
    success,
    error,
    cleanup,
  });
}
