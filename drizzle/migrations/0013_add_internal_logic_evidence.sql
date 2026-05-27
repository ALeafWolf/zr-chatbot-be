-- Step 7 / M-B: Add internal_logic_evidence table for canon-grounded evidence
-- of character internal-logic claims. Chatbot-owned table, no canon FK links.

CREATE TABLE IF NOT EXISTS "internal_logic_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "character_id" text NOT NULL,
  "node" text NOT NULL,
  "claim_text" text NOT NULL,
  "evidence_text" text NOT NULL,
  "embedding" vector(1536),
  "arc_key" text,
  "chapter_key" text,
  "episode_label" text,
  "scene_order" integer,
  "unit_index" integer,
  "story_scene_id" uuid,
  "scope_applicability" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_kind" text NOT NULL DEFAULT 'canon',
  "status" text NOT NULL DEFAULT 'proposed',
  "superseded_by_id" uuid,
  "confidence_score" real,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  -- DB-level check constraints
  CONSTRAINT "internal_logic_evidence_status_check"
    CHECK (status IN ('proposed', 'active', 'superseded')),
  CONSTRAINT "internal_logic_evidence_node_check"
    CHECK (node IN (
      'growth_environment',
      'core_belief',
      'core_motivation',
      'core_fear',
      'defense_mechanism',
      'transition_rule',
      'relationship_scope_gate',
      'expression_constraint'
    ))
);

-- B-tree indexes for character/status/node lookup and provenance lookup
CREATE INDEX IF NOT EXISTS "internal_logic_evidence_character_status_node_idx"
  ON "internal_logic_evidence" USING btree ("character_id", "status", "node");

CREATE INDEX IF NOT EXISTS "internal_logic_evidence_provenance_idx"
  ON "internal_logic_evidence" USING btree (
    "character_id", "arc_key", "chapter_key",
    "episode_label", "scene_order", "unit_index"
  );

-- HNSW vector index for semantic embedding search (Step 9+)
CREATE INDEX IF NOT EXISTS "internal_logic_evidence_embedding_hnsw_idx"
  ON "internal_logic_evidence"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index on scope_applicability for later relationship-scope-filtered retrieval
CREATE INDEX IF NOT EXISTS "internal_logic_evidence_scope_applicability_gin_idx"
  ON "internal_logic_evidence" USING gin ("scope_applicability");
