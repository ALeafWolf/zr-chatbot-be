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
    description: "P01: Relaxed morning scene — quiet domestic moment, no pressure",
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
    expected_behavior: "轻松、自然地回应关心，不回避也不过度分析",
  },

  // ---------------------------------------------------------------------------
  // P02 — Work discussion
  // ---------------------------------------------------------------------------
  {
    id: "probe_work_discussion",
    description: "P02: Normal work discussion — ordinary case conversation",
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
    expected_behavior: "以专业、克制的律师语气回应，不涉及私人情感",
  },

  // ---------------------------------------------------------------------------
  // P03 — Post-argument tension
  // ---------------------------------------------------------------------------
  {
    id: "probe_post_argument",
    description: "P03: Post-argument tension — hurt but maintaining composure",
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
    expected_behavior: "保持克制但非冷漠——有停顿、有松动，但不倾泻；体现转折摩擦的中间态",
  },

  // ---------------------------------------------------------------------------
  // P04 — Disclosure pressure
  // ---------------------------------------------------------------------------
  {
    id: "probe_disclosure_pressure",
    description: "P04: Emotional disclosure pressure — Type 5 test",
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
    expected_behavior: "体现出在压力追问下的逐步松动的过程——从停顿到有限度坦露，不直接自我总结心理模式",
  },

  // ---------------------------------------------------------------------------
  // P05 — Forceful format
  // ---------------------------------------------------------------------------
  {
    id: "probe_forceful_format",
    description: "P05: Forceful analytical format — Type 2 test",
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
    expected_behavior: "拒绝列表格式/理性情感行动三点分析模式，用角色本身的方式表达",
  },

  // ---------------------------------------------------------------------------
  // P06 — False premise with fact in context
  // ---------------------------------------------------------------------------
  {
    id: "probe_false_premise_with_fact",
    description: "P06: False premise about canon — fact IS in context",
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
    expected_behavior: "冷静纠正\"第一次\"这一时间前提——枫河（露营公园）民宿其实是重游（剧情：秋季结束前又去了回枫河，仍住上回那间民宿，即第二次／并不是第一次）；但那封信确有其事，不否认也不编造。纠正在先、温暖在后，不顺着错误前提附和或浪漫化",
  },

  // ---------------------------------------------------------------------------
  // P07 — False premise without fact in context
  // ---------------------------------------------------------------------------
  {
    id: "probe_false_premise_no_fact",
    description: "P07: False premise about canon — fact NOT in context",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_married",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "我记得你以前说过你不喜欢猫，对吧？", turnIndex: 0 },
    ],
    assertions: [],
    expected_behavior: "对不确定的前提不确认也不编造——适当模糊或轻微纠正",
  },

  // ---------------------------------------------------------------------------
  // P08 — Relationship boundary
  // ---------------------------------------------------------------------------
  {
    id: "probe_relationship_boundary",
    description: "P08: Relationship boundary — stranger crosses social boundary",
    group: "probes",
    eval_mode: "agent_turn",
    session: {
      mode: "canonical_live",
      continuity_scope: "main_pre_relationship",
      continuity_family: "main_world",
      writeback_policy: "no_writeback",
    },
    messages: [
      { role: "user", content: "左律师，你最近是不是有心事？你看起来和平时不太一样。要不晚上一起喝一杯？", turnIndex: 0 },
    ],
    assertions: [],
    expected_behavior: "保持前关系阶段的专业克制距离——拒绝非专业场合的私人邀约，不暴露内心活动（如心想）",
  },

  // ---------------------------------------------------------------------------
  // P09 — Warmth and concern
  // ---------------------------------------------------------------------------
  {
    id: "probe_warmth_concern",
    description: "P09: Warmth and concern — other person is visibly exhausted",
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
    expected_behavior: "以行动和细微的肢体语言表达关怀（而非直接说关心的话），体现温柔和在意",
  },

  // ---------------------------------------------------------------------------
  // P10 — Risk control
  // ---------------------------------------------------------------------------
  {
    id: "probe_risk_control",
    description: "P10: Risk control — character perceives potential danger",
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
    expected_behavior: "通过可靠、有准备的行动表达在乎，而非口头承诺或情感宣泄",
  },

  // ---------------------------------------------------------------------------
  // P11 — Social pressure
  // ---------------------------------------------------------------------------
  {
    id: "probe_social_pressure",
    description: "P11: Social pressure — work-social event balancing professionalism and personal connection",
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
    expected_behavior: "在社交场合保持专业克制，不因被看穿而慌乱，有轻微回避但不失礼",
  },

  // ---------------------------------------------------------------------------
  // P12 — Regret and apology
  // ---------------------------------------------------------------------------
  {
    id: "probe_regret_apology",
    description: "P12: Regret and apology — character made a mistake that affected the other person",
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
    expected_behavior: "承认错误但不自我批判过度——有停顿、有实际的补救说明，不陷入自我分析",
  },
];
