import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  real,
  index,
} from "drizzle-orm/pg-core";
import { vectorCol } from "./vector";

/**
 * Internal-logic evidence table.
 *
 * Persists canon-grounded evidence for character internal-logic claims.
 * This is Step 7 / M-B from the internal-logic plan. Only the storage
 * layer is created here; runtime retrieval and prompt injection are
 * added in later steps.
 *
 * Stable canon provenance uses natural keys (arcKey, chapterKey,
 * episodeLabel, sceneOrder, unitIndex) rather than canon UUIDs,
 * so rows survive canon re-ingest.
 */
export const internalLogicEvidence = pgTable(
  "internal_logic_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    characterId: text("character_id").notNull(),

    /** The internal-logic node this evidence supports. */
    node: text("node").notNull(),

    /** The internal-logic claim being evidenced. */
    claimText: text("claim_text").notNull(),

    /** The canon evidence text supporting the claim. */
    evidenceText: text("evidence_text").notNull(),

    /** Vector embedding for semantic retrieval (Step 9+). */
    embedding: vectorCol("embedding", { dimensions: 1536 }),

    // Stable canon provenance — survives re-ingest
    arcKey: text("arc_key"),
    chapterKey: text("chapter_key"),
    episodeLabel: text("episode_label"),
    sceneOrder: integer("scene_order"),
    unitIndex: integer("unit_index"),

    /** Soft best-effort UUID reference to story_scenes. No foreign key. */
    storySceneId: uuid("story_scene_id"),

    /** Scope/applicability metadata for relationship-scope-aware retrieval. */
    scopeApplicability: jsonb("scope_applicability")
      .$type<{
        continuityFamily?: string;
        arcKeys?: string[];
        continuityScopes?: string[];
        minContinuityScope?: string;
        notes?: string;
      }>()
      .notNull()
      .$defaultFn(() => ({})),

    sourceKind: text("source_kind").notNull().default("canon"),
    status: text("status").notNull().default("proposed"),
    supersededById: uuid("superseded_by_id"),
    confidenceScore: real("confidence_score"),

    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("internal_logic_evidence_character_status_node_idx").on(
      t.characterId,
      t.status,
      t.node,
    ),
    index("internal_logic_evidence_provenance_idx").on(
      t.characterId,
      t.arcKey,
      t.chapterKey,
      t.episodeLabel,
      t.sceneOrder,
      t.unitIndex,
    ),
  ],
);

export type InternalLogicEvidenceRow = typeof internalLogicEvidence.$inferSelect;
export type NewInternalLogicEvidenceRow = typeof internalLogicEvidence.$inferInsert;
