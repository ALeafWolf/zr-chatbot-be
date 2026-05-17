import { z } from "zod";
import { embedText } from "../embeddings/embedText";
import { traceStageWithIO } from "../../observability/langsmithTracing";
import type { ToolDef } from "./types";
import type { ToolCtx } from "./types";
import type { MemoryNamespace } from "../../memory/shared/memoryNamespace";
import { retrieveStructMemEntriesTraced } from "../../retrieval/memory/retrieveStructMemEntries";
import { retrieveStructMemConsolidationsTraced } from "../../retrieval/memory/retrieveStructMemConsolidations";
import { retrieveSessionMemoryChunksTraced } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import { retrieveInteractiveMemories } from "../../retrieval/memory/retrieveInteractiveMemories";
import {
  recentConversationWindowStartTurn,
} from "../../retrieval/conversation/recentConversationBoundary";
import { olderRecallExclusiveFirstTurn } from "../../orchestration/olderRecall";
import { getLatestConversationRouteTurnIndex } from "../../retrieval/conversation/getRecentConversationWindow";
import { ROLEPLAY_TURN_ROUTE } from "../../orchestration/turnRoutes";
import { formatStructMemEntriesForPrompt } from "../../orchestration/promptFormatters";
import { formatStructMemConsolidationsForPrompt } from "../../orchestration/promptFormatters";
import { formatSessionRecall } from "../../orchestration/promptFormatters";
import { formatMemories } from "../../orchestration/promptFormatters";

// ---------- lookup_structmem ----------

const LookupStructMemParams = z.object({
  query: z.string().min(1).max(300),
  entryTypes: z.array(z.string()).optional(),
  motifMode: z.boolean().optional(),
  k: z.number().int().min(1).max(5).optional().default(3),
});

export type LookupStructMemArgs = z.infer<typeof LookupStructMemParams>;

export interface LookupStructMemResult extends Record<string, unknown> {
  digest: string;
  entryCount: number;
  error?: string;
}

const runLookupStructMemTraced = traceStageWithIO(
  "tool.lookup_structmem",
  async (input: {
    query: string;
    entryTypes?: string[];
    motifMode?: boolean;
    k: number;
    ctx: ToolCtx;
  }) => {
    try {
      const embedding = await embedText(input.query);
      const latestFrontier = await getLatestConversationRouteTurnIndex(
        input.ctx.sessionId,
        ROLEPLAY_TURN_ROUTE,
      );
      const recentStart = recentConversationWindowStartTurn(latestFrontier ?? -1);
      const exclusiveFirst = olderRecallExclusiveFirstTurn(recentStart);

      const entries = await retrieveStructMemEntriesTraced({
        queryEmbedding: embedding,
        sessionId: input.ctx.sessionId,
        characterId: input.ctx.characterId,
        exclusiveRecentWindowFirstTurn: exclusiveFirst,
        latestFrontierTurnIndex: latestFrontier ?? -1,
        limit: input.k * 2,
      });

      const filtered = input.entryTypes?.length
        ? entries.filter((e) => input.entryTypes!.includes(e.entryType))
        : entries;

      const top = filtered.slice(0, input.k);
      const digest = top.length > 0
        ? formatStructMemEntriesForPrompt(top, [])
        : "No matching structured memory entries found.";

      return { digest, entryCount: top.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { digest: "", entryCount: 0, error: `lookup_structmem_failed:${msg}` };
    }
  },
  {
    subsystem: "retrieval",
    turn: "foreground",
    processInputs: (inputs) => ({
      queryPreview: (typeof inputs.query === "string" ? inputs.query : "").slice(0, 120),
      k: inputs.k,
    }),
    processOutputs: (outputs) => ({
      entryCount: outputs.entryCount,
      digestChars: typeof outputs.digest === "string" ? outputs.digest.length : 0,
    }),
  },
);

export const lookupStructMemTool: ToolDef<
  LookupStructMemArgs,
  LookupStructMemResult
> = {
  name: "lookup_structmem",
  description:
    "Look up structured event memory entries (e.g., relational shifts, promises, decisions) from earlier turns. Use when you need to recall a specific past event or check for recurring relationship patterns.",
  parameters: LookupStructMemParams,
  async execute(args, ctx) {
    const parsed = LookupStructMemParams.parse(args);
    return runLookupStructMemTraced({
      query: parsed.query,
      entryTypes: parsed.entryTypes,
      motifMode: parsed.motifMode,
      k: parsed.k,
      ctx,
    });
  },
  summarize(args, result) {
    if (result.error) return `StructMem lookup failed: ${result.error}`;
    return result.entryCount > 0
      ? `Found ${result.entryCount} structmem entries.`
      : "No matching structmem entries.";
  },
};

// ---------- lookup_structmem_consolidation ----------

const LookupStructMemConsolidationParams = z.object({
  query: z.string().min(1).max(300),
  k: z.number().int().min(1).max(5).optional().default(2),
});

export type LookupStructMemConsolidationArgs = z.infer<
  typeof LookupStructMemConsolidationParams
>;

export interface LookupStructMemConsolidationResult
  extends Record<string, unknown> {
  digest: string;
  itemCount: number;
  error?: string;
}

const runLookupStructMemConsolidationTraced = traceStageWithIO(
  "tool.lookup_structmem_consolidation",
  async (input: { query: string; k: number; ctx: ToolCtx }) => {
    try {
      const embedding = await embedText(input.query);
      const latestFrontier = await getLatestConversationRouteTurnIndex(
        input.ctx.sessionId,
        ROLEPLAY_TURN_ROUTE,
      );
      const recentStart = recentConversationWindowStartTurn(latestFrontier ?? -1);
      const exclusiveFirst = olderRecallExclusiveFirstTurn(recentStart);

      const consolidations = await retrieveStructMemConsolidationsTraced({
        queryEmbedding: embedding,
        sessionId: input.ctx.sessionId,
        characterId: input.ctx.characterId,
        memoryNamespace: input.ctx.memoryNamespace,
        exclusiveRecentWindowFirstTurn: exclusiveFirst,
        latestFrontierTurnIndex: latestFrontier ?? -1,
        limit: input.k * 2,
      });

      const top = consolidations.slice(0, input.k);
      const digest = top.length > 0
        ? formatStructMemConsolidationsForPrompt(top)
        : "No matching memory synthesis found.";

      return { digest, itemCount: top.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        digest: "",
        itemCount: 0,
        error: `lookup_structmem_consolidation_failed:${msg}`,
      };
    }
  },
  { subsystem: "retrieval", turn: "foreground" },
);

export const lookupStructMemConsolidationTool: ToolDef<
  LookupStructMemConsolidationArgs,
  LookupStructMemConsolidationResult
> = {
  name: "lookup_structmem_consolidation",
  description:
    "Look up synthesized memory summaries from this session or cross-session. Use for broader context about relationship evolution or recurring patterns.",
  parameters: LookupStructMemConsolidationParams,
  async execute(args, ctx) {
    const parsed = LookupStructMemConsolidationParams.parse(args);
    return runLookupStructMemConsolidationTraced({
      query: parsed.query,
      k: parsed.k,
      ctx,
    });
  },
  summarize(args, result) {
    if (result.error) return `Consolidation lookup failed: ${result.error}`;
    return `Found ${result.itemCount} memory synthesis items.`;
  },
};

// ---------- lookup_older_session_memory ----------

const LookupOlderSessionParams = z.object({
  query: z.string().min(1).max(300),
  k: z.number().int().min(1).max(5).optional().default(3),
});

export type LookupOlderSessionArgs = z.infer<typeof LookupOlderSessionParams>;

export interface LookupOlderSessionResult extends Record<string, unknown> {
  digest: string;
  chunkCount: number;
  error?: string;
}

const runLookupOlderSessionTraced = traceStageWithIO(
  "tool.lookup_older_session_memory",
  async (input: { query: string; k: number; ctx: ToolCtx }) => {
    try {
      const embedding = await embedText(input.query);
      const latestFrontier = await getLatestConversationRouteTurnIndex(
        input.ctx.sessionId,
        ROLEPLAY_TURN_ROUTE,
      );
      const recentStart = recentConversationWindowStartTurn(latestFrontier ?? -1);
      const exclusiveFirst = olderRecallExclusiveFirstTurn(recentStart);

      const chunks = await retrieveSessionMemoryChunksTraced({
        queryEmbedding: embedding,
        sessionId: input.ctx.sessionId,
        characterId: input.ctx.characterId,
        exclusiveRecentWindowFirstTurn: exclusiveFirst,
        latestFrontierTurnIndex: latestFrontier ?? -1,
        limit: input.k,
      });

      const digest = chunks.length > 0
        ? formatSessionRecall(chunks)
        : "No matching older session chunks found.";

      return { digest, chunkCount: chunks.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        digest: "",
        chunkCount: 0,
        error: `lookup_older_session_failed:${msg}`,
      };
    }
  },
  { subsystem: "retrieval", turn: "foreground" },
);

export const lookupOlderSessionTool: ToolDef<
  LookupOlderSessionArgs,
  LookupOlderSessionResult
> = {
  name: "lookup_older_session_memory",
  description:
    "Look up earlier conversation chunks from this session that fall outside the recent window. Use when you need to recall what was said or done many turns ago.",
  parameters: LookupOlderSessionParams,
  async execute(args, ctx) {
    const parsed = LookupOlderSessionParams.parse(args);
    return runLookupOlderSessionTraced({
      query: parsed.query,
      k: parsed.k,
      ctx,
    });
  },
  summarize(args, result) {
    if (result.error) return `Older session lookup failed: ${result.error}`;
    return `Found ${result.chunkCount} older session chunks.`;
  },
};

// ---------- lookup_interactive_memory ----------

const LookupInteractiveMemoryParams = z.object({
  query: z.string().min(1).max(300),
  k: z.number().int().min(1).max(5).optional().default(3),
});

export type LookupInteractiveMemoryArgs = z.infer<
  typeof LookupInteractiveMemoryParams
>;

export interface LookupInteractiveMemoryResult extends Record<string, unknown> {
  digest: string;
  memoryCount: number;
  error?: string;
}

const runLookupInteractiveMemoryTraced = traceStageWithIO(
  "tool.lookup_interactive_memory",
  async (input: { query: string; k: number; ctx: ToolCtx }) => {
    try {
      const embedding = await embedText(input.query);
      const memories = await retrieveInteractiveMemories({
        queryEmbedding: embedding,
        memoryNamespace: input.ctx.memoryNamespace as MemoryNamespace,
        characterId: input.ctx.characterId,
        limit: input.k,
      });

      const digest = memories.length > 0
        ? formatMemories(memories)
        : "No matching durable memories found.";

      return { digest, memoryCount: memories.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        digest: "",
        memoryCount: 0,
        error: `lookup_interactive_memory_failed:${msg}`,
      };
    }
  },
  { subsystem: "retrieval", turn: "foreground" },
);

export const lookupInteractiveMemoryTool: ToolDef<
  LookupInteractiveMemoryArgs,
  LookupInteractiveMemoryResult
> = {
  name: "lookup_interactive_memory",
  description:
    "Look up durable interactive memory events (facts, preferences, emotional memories) for this character. Use when you need to recall established facts about past interactions.",
  parameters: LookupInteractiveMemoryParams,
  async execute(args, ctx) {
    const parsed = LookupInteractiveMemoryParams.parse(args);
    return runLookupInteractiveMemoryTraced({
      query: parsed.query,
      k: parsed.k,
      ctx,
    });
  },
  summarize(args, result) {
    if (result.error) return `Interactive memory lookup failed: ${result.error}`;
    return `Found ${result.memoryCount} memory events.`;
  },
};
