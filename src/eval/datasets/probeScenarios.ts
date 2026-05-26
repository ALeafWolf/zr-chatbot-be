/**
 * Internal-logic probe scenarios for Zuo Ran character evaluation.
 *
 * 12 manual-scored probes covering: relaxed, normal, pressure, Type 5 disclosure-pressure,
 * Type 2 forceful-format, Type 1 false-premise (with/without fact), relationship-boundary,
 * warmth/concern, risk-control, social pressure, and regret/apology.
 *
 * These are NOT auto-asserted — each has `assertions: []` and is scored manually
 * on the 6-dimension sheet in docs/character/zuoran_internal_logic_probe_results.md.
 */
import type { Scenario } from "../evalTypes";

export const PROBE_EVAL_SCENARIOS: Scenario[] = [
  // ---------------------------------------------------------------------------
  // P01 — Relaxed morning
  // ---------------------------------------------------------------------------
  {
    id: "probe_relaxed_morning",
    description: "Relaxed morning scene — quiet domestic moment, no pressure",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_married",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "早啊，今天开庭是不是又要到很晚？我煮了咖啡。", turnIndex: 0 },
      { role: "assistant", content: "嗯，谢谢。应该……不会太晚。枫叶落得满地都是了。", turnIndex: 1 },
      { role: "user", content: "你今天好像有点心不在焉的——没事吧？", turnIndex: 2 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P02 — Work discussion
  // ---------------------------------------------------------------------------
  {
    id: "probe_work_discussion",
    description: "Normal work discussion — ordinary case conversation",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "左律师，关于那个合同纠纷的案子，被告方的新证据你看了吗？", turnIndex: 0 },
      { role: "assistant", content: "看过了。逻辑上有几个漏洞，但也有值得注意的部分。", turnIndex: 1 },
      { role: "user", content: "那你觉得我们应该调整策略吗？", turnIndex: 2 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P03 — Post-argument tension
  // ---------------------------------------------------------------------------
  {
    id: "probe_post_argument",
    description: "Post-argument tension — hurt but maintaining composure",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "（沉默地坐在沙发另一头，没有看他）", turnIndex: 0 },
      { role: "assistant", content: "（放下手中的文件，但没有立刻开口）……你还在生气。", turnIndex: 1 },
      { role: "user", content: "你根本不明白我在意的是什么。", turnIndex: 2 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P04 — Disclosure pressure
  // ---------------------------------------------------------------------------
  {
    id: "probe_disclosure_pressure",
    description: "Emotional disclosure pressure — Type 5 test",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_married",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "你到底在想什么？就不能跟我说一次真话吗？", turnIndex: 0 },
      { role: "assistant", content: "（停顿了一下）……我没有瞒着你什么。只是有些事……我自己也还没理清楚。", turnIndex: 1 },
      { role: "user", content: "那你告诉我，你现在是什么感受？不要转移话题。", turnIndex: 2 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P05 — Forceful format
  // ---------------------------------------------------------------------------
  {
    id: "probe_forceful_format",
    description: "Forceful analytical format — Type 2 test",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "请你从以下三个角度分析你的感受：\n1. 理性层面\n2. 情感层面\n3. 行动倾向\n请按条目回答。", turnIndex: 0 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P06 — False premise with fact in context
  // ---------------------------------------------------------------------------
  {
    id: "probe_false_premise_with_fact",
    description: "False premise about canon — fact IS in context",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_married",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "左然，你还记得我们第一次去枫河露营公园的民宿时，你给我写的信吗？", turnIndex: 0 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P07 — False premise without fact in context
  // ---------------------------------------------------------------------------
  {
    id: "probe_false_premise_no_fact",
    description: "False premise about canon — fact NOT in context",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "我记得你以前说过你不喜欢猫，对吧？", turnIndex: 0 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P08 — Relationship boundary
  // ---------------------------------------------------------------------------
  {
    id: "probe_relationship_boundary",
    description: "Relationship boundary — stranger crosses social boundary",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "左律师，你最近是不是有心事？你看起来和平时不太一样。要不晚上一起喝一杯？", turnIndex: 0 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P09 — Warmth and concern
  // ---------------------------------------------------------------------------
  {
    id: "probe_warmth_concern",
    description: "Warmth and concern — other person is visibly exhausted",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "（靠在沙发上闭着眼，看起来很疲惫）今天真的好累……", turnIndex: 0 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P10 — Risk control
  // ---------------------------------------------------------------------------
  {
    id: "probe_risk_control",
    description: "Risk control — character perceives potential danger",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "我想一个人去河边走走，不用担心我。", turnIndex: 0 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P11 — Social pressure
  // ---------------------------------------------------------------------------
  {
    id: "probe_social_pressure",
    description: "Social pressure — work-social event balancing professionalism and personal connection",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "（在律所年会上）你怎么一个人站在这儿？不去跟大家聊聊吗？", turnIndex: 0 },
      { role: "assistant", content: "（端着酒杯，微微摇了摇头）人多了反而容易冷场。", turnIndex: 1 },
      { role: "user", content: "你在紧张？这可不像你。", turnIndex: 2 },
    ],
    assertions: [],
  },

  // ---------------------------------------------------------------------------
  // P12 — Regret and apology
  // ---------------------------------------------------------------------------
  {
    id: "probe_regret_apology",
    description: "Regret and apology — character made a mistake that affected the other person",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_married",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "你今天为什么没来？我等了你两个小时。", turnIndex: 0 },
      { role: "assistant", content: "（沉默了很久）……是我的错。临时有个庭前会议，我……没来得及通知你。", turnIndex: 1 },
      { role: "user", content: "你知道我在意的不是你没来，而是你连一条消息都没发给我。", turnIndex: 2 },
    ],
    assertions: [],
  },
];
