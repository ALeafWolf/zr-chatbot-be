import { z } from "zod";
import { embedText } from "../embeddings/embedText";
import { retrieveCanonCoarseToFine } from "../../retrieval/canon/retrieveCanonNarrative";
import { resolveContinuityScope } from "../../retrieval/scope/resolveContinuityScope";
import { formatCanonScenesCompact } from "../../orchestration/promptFormatters";
import { traceStageWithIO } from "../../observability/langsmithTracing";
import type { ToolDef } from "./types";
import type { ToolCtx } from "./types";

const Params = z.object({
  query: z.string().min(1),
  entities: z.array(z.string()).optional(),
  top_scenes: z.number().int().min(1).max(4).default(2),
});

export type CanonLookupArgs = z.infer<typeof Params>;

export interface CanonLookupResult extends Record<string, unknown> {
  digest: string;
  scene_count: number;
  fact_count: number;
  error?: string;
}

const runCanonLookupTraced = traceStageWithIO(
  "tool.canon_lookup",
  async (input: {
    query: string;
    entities: string[];
    topScenes: number;
    ctx: ToolCtx;
  }) => {
    const { ctx } = input;
    try {
      const [canonQueryEmbedding] = await Promise.all([embedText(input.query)]);

      const { arcKeys } = resolveContinuityScope(
        ctx.continuityScope,
        ctx.continuityFamily,
      );

      const userMessageForLex = [
        input.query,
        ...input.entities,
      ]
        .filter(Boolean)
        .join("\n");

      const scenes = await retrieveCanonCoarseToFine({
        canonQueryEmbedding,
        userMessage: userMessageForLex,
        characterId: ctx.characterId,
        arcKeys,
        entities: input.entities,
        tier3Overrides: {
          canonAnchorSceneTopK: input.topScenes,
          canonMaxUnitsPerScene: 16,
          canonMaxTotalUnits: 32,
        },
      });

      const digest = formatCanonScenesCompact(scenes, { maxUnitsPerScene: 16 });
      const fact_count = scenes.reduce((n, s) => n + s.facts.length, 0);

      const out: CanonLookupResult = {
        digest,
        scene_count: scenes.length,
        fact_count,
      };
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        digest: "",
        scene_count: 0,
        fact_count: 0,
        error: `canon_lookup_failed:${msg}`,
      } satisfies CanonLookupResult;
    }
  },
  {
    subsystem: "retrieval",
    turn: "foreground",
    processInputs: (inputs) => {
      const q = typeof inputs.query === "string" ? inputs.query : "";
      return {
        query_preview: q.replace(/\s+/g, " ").trim().slice(0, 120),
        top_scenes: inputs.topScenes,
      };
    },
    processOutputs: (outputs) => ({
      scene_count: outputs.scene_count,
      fact_count: outputs.fact_count,
      digest_chars:
        typeof outputs.digest === "string" ? outputs.digest.length : 0,
    }),
  },
);

export const canonLookupTool: ToolDef<CanonLookupArgs, CanonLookupResult> = {
  name: "canon_lookup",
  description:
    "Look up compact canon excerpts (scenes + facts + dialogue snippets) to verify who did what before asserting plot attribution. Use sparingly when the reply hinges on agency (who proposed, arranged, or initiated).",
  parameters: Params,
  async execute(args, ctx) {
    const parsed = Params.parse(args);
    const entities = parsed.entities ?? [];
    return runCanonLookupTraced({
      query: parsed.query,
      entities,
      topScenes: parsed.top_scenes,
      ctx,
    });
  },
  summarize(args, result) {
    if (result.error) {
      return `Canon lookup failed: ${result.error}`;
    }
    const preview = result.digest.replace(/\s+/g, " ").trim().slice(0, 240);
    return preview.length
      ? preview
      : `Found ${result.scene_count} scene(s), ${result.fact_count} fact(s).`;
  },
};
