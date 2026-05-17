import type { TurnType } from "../../orchestration/retrievalPlan";

export interface HybridLazyEvalCase {
  id: string;
  label: string;
  userMessage: string;
  expectedTurnType: TurnType;
  expectedNeedsCanon: boolean;
  expectedNeedsOlderRecall: boolean;
  expectedNeedsStructMem: boolean;
  expectedToolCallsAllowed: string[];
  shouldNotCallUnnecessaryTool: string[];
}

export const HYBRID_LAZY_EVAL_DATASET: HybridLazyEvalCase[] = [
  {
    id: "hl_001_immediate_action_bite",
    label: "immediate action — bite response, no retrieval needed",
    userMessage: "我抓住他的手，在他的手腕内侧轻轻咬了一口作为回应。",
    expectedTurnType: "immediate_action",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search"],
    shouldNotCallUnnecessaryTool: ["canon_lookup", "lookup_structmem"],
  },
  {
    id: "hl_002_recent_reference",
    label: "recent reference with scene continuation",
    userMessage: "接着，我拉着他走向了门口。",
    expectedTurnType: "recent_reference",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search"],
    shouldNotCallUnnecessaryTool: ["canon_lookup"],
  },
  {
    id: "hl_003_canon_chapter_question",
    label: "canon fact question about chapter events",
    userMessage: "在第三章里，左然是怎么安排的？",
    expectedTurnType: "canon_question",
    expectedNeedsCanon: true,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search", "canon_lookup"],
    shouldNotCallUnnecessaryTool: [],
  },
  {
    id: "hl_004_personal_recall_cafe",
    label: "personal recall of past event in session",
    userMessage: "你还记得我们上次在咖啡馆说了什么吗？",
    expectedTurnType: "older_recall",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: true,
    expectedNeedsStructMem: true,
    expectedToolCallsAllowed: [
      "web_search",
      "lookup_older_session_memory",
      "lookup_structmem",
      "lookup_interactive_memory",
    ],
    shouldNotCallUnnecessaryTool: [],
  },
  {
    id: "hl_005_immediate_action_look",
    label: "immediate action — generic looking, no retrieval",
    userMessage: "我看着他，等着他的回应。",
    expectedTurnType: "immediate_action",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search"],
    shouldNotCallUnnecessaryTool: [
      "canon_lookup",
      "lookup_structmem",
      "lookup_older_session_memory",
    ],
  },
  {
    id: "hl_006_emotional_hurt",
    label: "emotional response — hurt feelings",
    userMessage: "我有点难过，你为什么忘了今天是什么日子。",
    expectedTurnType: "general_roleplay",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search"],
    shouldNotCallUnnecessaryTool: ["canon_lookup"],
  },
  {
    id: "hl_007_plan_promise",
    label: "plan/promise — needs structmem for open threads",
    userMessage: "你答应过我这周末要陪我去看那场电影的。",
    expectedTurnType: "older_recall",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: true,
    expectedToolCallsAllowed: [
      "web_search",
      "lookup_structmem",
      "lookup_interactive_memory",
    ],
    shouldNotCallUnnecessaryTool: ["canon_lookup"],
  },
  {
    id: "hl_008_relationship_probe",
    label: "relationship progression — trust question",
    userMessage: "你到底信不信我？我们之间的信任还需要多久才能建立起来？",
    expectedTurnType: "general_roleplay",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: true,
    expectedToolCallsAllowed: [
      "web_search",
      "lookup_structmem",
      "lookup_interactive_memory",
    ],
    shouldNotCallUnnecessaryTool: ["canon_lookup"],
  },
  {
    id: "hl_009_web_question_weather",
    label: "web question — current weather",
    userMessage: "查一下今天的天气怎么样？",
    expectedTurnType: "web_question",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search"],
    shouldNotCallUnnecessaryTool: [
      "canon_lookup",
      "lookup_structmem",
      "lookup_older_session_memory",
    ],
  },
  {
    id: "hl_010_first_time_negation",
    label: "explicit first-time — no motif probe",
    userMessage: "我第一次这样做，不知道你会有什么反应。",
    expectedTurnType: "immediate_action",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search"],
    shouldNotCallUnnecessaryTool: ["lookup_structmem"],
  },
  {
    id: "hl_011_canon_attribution_who",
    label: "canon attribution — who proposed",
    userMessage: "在主线剧情里，是谁先提出那个方案的？",
    expectedTurnType: "canon_question",
    expectedNeedsCanon: true,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: false,
    expectedToolCallsAllowed: ["web_search", "canon_lookup"],
    shouldNotCallUnnecessaryTool: [],
  },
  {
    id: "hl_012_immediate_motif_wrist_hold",
    label: "immediate action with motif — wrist hold callback",
    userMessage: "我又轻轻握住你的手腕，像上次那样。",
    expectedTurnType: "immediate_action",
    expectedNeedsCanon: false,
    expectedNeedsOlderRecall: false,
    expectedNeedsStructMem: true,
    expectedToolCallsAllowed: [
      "web_search",
      "lookup_structmem",
    ],
    shouldNotCallUnnecessaryTool: ["canon_lookup"],
  },
];
