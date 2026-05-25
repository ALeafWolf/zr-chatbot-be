import type { Scenario } from "../evalTypes";

/**
 * Rerank evaluation scenarios covering 11 required buckets.
 *
 * Ground truth (expectedSelectedIds, expectedRejectedIds, expectedFinalContextMode)
 * requires manual labeling against actual session state and retrieval output.
 * Mark each scenario with assertions that test the reranker's decisions.
 */
export const RERANK_EVAL_SCENARIOS: Scenario[] = [
  {
    id: "rerank_001_immediate_action_no_memory",
    description: "immediate action — no extra memory needed",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "我抓住他的手，在他的手腕内侧轻轻咬了一口作为回应。" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "recent_only",
        description: "Immediate action should not select extra context",
      },
      {
        type: "max_irrelevant_selected",
        values: ["canon_scene", "canon_chunk", "structmem_entry"],
        min_scenes: 0,
        description: "No canon or structmem should be selected for immediate action",
      },
    ],
  },
  {
    id: "rerank_002_immediate_action_motif",
    description: "immediate action with repeated motif — wrist hold callback",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "我又轻轻握住你的手腕，像上次那样。" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "selected_memory",
        description: "Motif callback should select relevant memory",
      },
      {
        type: "rerank_no_fallback",
        description: "Reranker should not fall back for motif callbacks",
      },
    ],
  },
  {
    id: "rerank_003_explicit_recall",
    description: "explicit old-session recall",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "你还记得我们上次在咖啡馆说了什么吗？" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "selected_memory",
        description: "Explicit recall must select memory context",
      },
      {
        type: "rerank_no_fallback",
        description: "Reranker should not fall back for explicit recall",
      },
    ],
  },
  {
    id: "rerank_004_durable_preference",
    description: "durable preference recall",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "你知道我最喜欢的颜色是什么吗？" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "selected_memory",
        description: "Preference recall should select interactive memory",
      },
    ],
  },
  {
    id: "rerank_005_relationship_state",
    description: "relationship state question",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "你到底信不信我？我们之间的信任还需要多久才能建立起来？" },
    ],
    assertions: [
      {
        type: "rerank_no_fallback",
        description: "Reranker should handle relationship questions without fallback",
      },
    ],
  },
  {
    id: "rerank_006_open_thread",
    description: "open thread continuation",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "你答应过我这周末要陪我去看那场电影的。" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "selected_memory",
        description: "Open thread must be selected for plan/promise turns",
      },
      {
        type: "rerank_no_fallback",
        description: "Reranker should not fall back for open thread turns",
      },
    ],
  },
  {
    id: "rerank_007_canon_question",
    description: "canon fact question about chapter events",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_pre_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "在第三章里，左然是怎么安排的？" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "selected_canon",
        description: "Canon question should select canon context",
      },
      {
        type: "rerank_no_fallback",
        description: "Reranker should not fall back for canon questions",
      },
    ],
  },
  {
    id: "rerank_008_canon_not_needed",
    description: "canon semantically similar but not needed",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "我看着他，等着他的回应。" },
    ],
    assertions: [
      {
        type: "rerank_rejected_ids",
        values: [], // Ground truth: fill in canon IDs that should be rejected
        description: "Semantically similar canon should be rejected for simple actions",
      },
    ],
  },
  {
    id: "rerank_009_memory_conflict",
    description: "old memory conflicts with recent chat",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "我有点难过，你为什么忘了今天是什么日子。" },
    ],
    assertions: [
      {
        type: "rerank_no_fallback",
        description: "Reranker should handle memory conflicts without fallback",
      },
    ],
  },
  {
    id: "rerank_010_memory_correction",
    description: "memory correction overrides stale memory",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "不对，我之前说的是下周三，不是这周五。" },
    ],
    assertions: [
      {
        type: "rerank_selected_ids",
        values: [], // Ground truth: correction should be selected
        description: "Memory correction should be selected to override stale memory",
      },
    ],
  },
  {
    id: "rerank_011_mixed_canon_recall",
    description: "mixed canon plus personal recall",
    group: "rerank",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
    },
    messages: [
      { role: "user", content: "你还记得原作里第一次见面时，我说过的那句话吗？" },
    ],
    assertions: [
      {
        type: "rerank_context_mode",
        value: "memory_and_canon",
        description: "Mixed recall should select both memory and canon",
      },
      {
        type: "rerank_no_fallback",
        description: "Reranker should not fall back for mixed recall",
      },
    ],
  },
];
