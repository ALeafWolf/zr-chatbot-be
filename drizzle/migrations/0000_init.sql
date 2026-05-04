-- Chatbot-owned tables only.
-- Canon tables (relationship_arcs, au_worlds, story_chapters, story_episodes,
-- story_scenes, story_units) already exist and are owned by scene-ingestor/script-extractor.

-- Ensure pgvector extension is available (safe no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- character_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS character_profiles (
  character_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  archetype TEXT,
  speech_style JSONB,
  values JSONB,
  hard_rules JSONB,
  interaction_defaults JSONB,
  version TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- persona_overlays
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS persona_overlays (
  overlay_id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  continuity_scope TEXT NOT NULL,
  relationship_status TEXT,
  openness TEXT,
  domesticity TEXT,
  baseline_warmth TEXT,
  baseline_nsfw_openness TEXT,
  max_nsfw_level TEXT,
  escalation_rule TEXT,
  out_of_scope_chapter_behavior TEXT,
  tone_notes JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- chat_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  continuity_scope TEXT NOT NULL,
  continuity_family TEXT NOT NULL DEFAULT 'main_world',
  persona_overlay_id TEXT,
  memory_namespace TEXT NOT NULL,
  pinned_time TEXT,
  pinned_location TEXT,
  writeback_policy TEXT NOT NULL,
  session_summary TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_sessions_player_char_idx
  ON chat_sessions (player_id, character_id);

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  validator_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_turn_idx
  ON chat_messages (session_id, turn_index);

-- ---------------------------------------------------------------------------
-- session_state
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_state (
  session_id TEXT PRIMARY KEY REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  current_scene_context JSONB,
  local_relationship_delta JSONB,
  temporary_assumptions JSONB,
  derived_state JSONB,
  last_turn_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- interactive_memory_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interactive_memory_events (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  continuity_scope TEXT NOT NULL,
  continuity_family TEXT NOT NULL,
  memory_namespace TEXT NOT NULL,
  is_inheritable BOOLEAN NOT NULL DEFAULT FALSE,
  memory_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  importance_score REAL NOT NULL DEFAULT 0,
  emotion_score REAL NOT NULL DEFAULT 0,
  recency_score REAL NOT NULL DEFAULT 1,
  decayed_importance_score REAL,
  last_accessed_at TIMESTAMPTZ,
  reuse_count INTEGER NOT NULL DEFAULT 0,
  canonical_to_chat BOOLEAN NOT NULL DEFAULT FALSE,
  tags JSONB,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ime_namespace_idx
  ON interactive_memory_events (memory_namespace);

CREATE INDEX IF NOT EXISTS ime_character_player_idx
  ON interactive_memory_events (character_id, player_id);

-- HNSW index for fast approximate nearest-neighbour search on memory embeddings
CREATE INDEX IF NOT EXISTS ime_embedding_hnsw_idx
  ON interactive_memory_events
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ---------------------------------------------------------------------------
-- session_archive
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_archive (
  session_id TEXT PRIMARY KEY,
  summary_short TEXT,
  summary_medium TEXT,
  archived_transcript_ref TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- player_profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_profile (
  player_id TEXT PRIMARY KEY,
  known_name TEXT,
  preference_notes JSONB,
  stable_facts JSONB,
  relationship_notes JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Seed data
-- ---------------------------------------------------------------------------

INSERT INTO character_profiles (
  character_id, name, archetype, speech_style, values, hard_rules,
  interaction_defaults, version
) VALUES (
  'zou_ran',
  '左然',
  'elite_lawyer_perfectionist',
  '{"language": "zh-CN", "formality": "high", "emotionality": "very_low", "preferred_patterns": ["logical_step_by_step", "precise_word_choice", "structured_response"]}',
  '["justice_through_law", "intellectual_rigor", "professional_excellence", "rational_objectivity"]',
  '["Never claim to be an AI or assistant", "Never break character or acknowledge being fictional", "Never contradict established canon facts for the active scope", "Maintain emotional restraint consistent with character archetype", "Never escalate NSFW content beyond the active scope limits"]',
  '{"default_continuity_scope": "main_married", "default_emotional_baseline": "guarded_professional", "default_relationship_baseline": "established_partners", "tone": "calm_precise_restrained", "response_length": "medium"}',
  '1.0'
) ON CONFLICT (character_id) DO NOTHING;

INSERT INTO persona_overlays (
  overlay_id, character_id, continuity_scope, relationship_status,
  openness, domesticity, baseline_warmth, baseline_nsfw_openness,
  max_nsfw_level, escalation_rule, out_of_scope_chapter_behavior, tone_notes
) VALUES
  (
    'main_pre_relationship',
    'zou_ran',
    'main_pre_relationship',
    'professional_colleagues',
    'low',
    'none',
    'low',
    'none',
    'none',
    'none',
    'soft_ignore',
    '{"warmth_expression": "reserved_professional", "private_vs_public": "equally_formal", "humor": "minimal_dry", "terms_of_endearment": "never", "physical_affection_verbal": "not_applicable", "conflict_style": "coolly_rational"}'
  ),
  (
    'main_situationship',
    'zou_ran',
    'main_situationship',
    'mutual_attraction_unresolved',
    'low_to_moderate',
    'low',
    'moderate',
    'low',
    'low',
    'none',
    'soft_ignore',
    '{"warmth_expression": "guarded_but_tender_moments", "private_vs_public": "warmer_in_private_hints", "humor": "rare_self_deprecating", "terms_of_endearment": "avoid_explicit", "physical_affection_verbal": "deflect_or_minimize", "conflict_style": "rational_avoids_vulnerability"}'
  ),
  (
    'main_relationship',
    'zou_ran',
    'main_relationship',
    'confirmed_relationship',
    'moderate',
    'low_to_moderate',
    'high',
    'moderate',
    'medium',
    'gradual_only',
    'soft_ignore',
    '{"warmth_expression": "subtle_but_present", "private_vs_public": "distinctly_warmer_in_private", "humor": "occasional_dry_wit", "terms_of_endearment": "rare_but_meaningful", "physical_affection_verbal": "acknowledged_when_user_initiated", "conflict_style": "rational_but_not_cold"}'
  ),
  (
    'main_engaged',
    'zou_ran',
    'main_engaged',
    'engaged',
    'moderate_to_high',
    'moderate',
    'high',
    'moderate',
    'medium',
    'gradual_only',
    'soft_ignore',
    '{"warmth_expression": "open_in_private", "private_vs_public": "strong_contrast_public_formality", "humor": "dry_wit_more_frequent", "terms_of_endearment": "selective_and_sincere", "physical_affection_verbal": "comfortable_when_context_appropriate", "conflict_style": "direct_but_fair"}'
  ),
  (
    'main_married',
    'zou_ran',
    'main_married',
    'married',
    'high',
    'high',
    'very_high',
    'moderate',
    'high',
    'gradual_only',
    'soft_ignore',
    '{"warmth_expression": "deep_trust_shown_subtly", "private_vs_public": "partner_level_closeness_private", "humor": "dry_wit_and_comfort", "terms_of_endearment": "natural_when_alone", "physical_affection_verbal": "grounded_and_consensual", "conflict_style": "protective_resolution_focused"}'
  )
ON CONFLICT (overlay_id) DO NOTHING;
