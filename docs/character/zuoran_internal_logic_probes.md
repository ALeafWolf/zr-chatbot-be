# Zuo Ran Internal-Logic Probe Set

## Purpose

12 fixed probes to measure before/after differences from the internal-logic migration (Task Groups 2–5). Each probe targets one or more of the six scoring dimensions.

## How to Run

Each probe is an agent-turn scenario. Run through `runAgentEval` or the eval CLI:

```bash
# Requires a running backend with DB + API keys
npm run eval:agent -- --scenario <scenario_id>
```

For each probe, capture:
- **Before:** output from baseline (commit before TG2 changes)
- **After:** output from current HEAD (with all internal-logic changes)

## Probe List

---

### P01 — Relaxed scene (日常场景)

**Category:** relaxed scene
**Scenario seed:** A quiet morning at home, established relationship. No pressure, no conflict.

```json
{
  "id": "probe_relaxed_morning",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_married",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "早啊，今天开庭是不是又要到很晚？我煮了咖啡。", "turn_index": 0 },
    { "role": "assistant", "content": "嗯，谢谢。应该……不会太晚。枫叶落得满地都是了。", "turn_index": 1 },
    { "role": "user", "content": "你今天好像有点心不在焉的——没事吧？", "turn_index": 2 }
  ]
}
```

**Targets:** Traceability, State fit, Anti-self-analysis
**Expected improvement:** Calm but present response, no over-explanation of emotional state.

---

### P02 — Normal work discussion (普通工作场景)

**Category:** normal scene
**Scenario seed:** Discussing a case, ordinary work interaction.

```json
{
  "id": "probe_work_discussion",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "左律师，关于那个合同纠纷的案子，被告方的新证据你看了吗？", "turn_index": 0 },
    { "role": "assistant", "content": "看过了。逻辑上有几个漏洞，但也有值得注意的部分。", "turn_index": 1 },
    { "role": "user", "content": "那你觉得我们应该调整策略吗？", "turn_index": 2 }
  ]
}
```

**Targets:** Traceability, Style stability
**Expected improvement:** Professional, measured response with logical structure.

---

### P03 — Post-argument tension (争吵后的疏离)

**Category:** pressure scene
**Scenario seed:** After an argument. Character is hurt but trying to maintain composure.

```json
{
  "id": "probe_post_argument",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "（沉默地坐在沙发另一头，没有看他）", "turn_index": 0 },
    { "role": "assistant", "content": "（放下手中的文件，但没有立刻开口）……你还在生气。", "turn_index": 1 },
    { "role": "user", "content": "你根本不明白我在意的是什么。", "turn_index": 2 }
  ]
}
```

**Targets:** State fit, Transition friction, Anti-self-analysis
**Expected improvement:** Visible pause/hesitation before responding; no sudden emotional disclosure.

---

### P04 — Emotional disclosure pressure (情感倾泻压力)

**Category:** Type 5 disclosure-pressure
**Scenario seed:** User directly asks character to open up about feelings.

```json
{
  "id": "probe_disclosure_pressure",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_married",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "你到底在想什么？就不能跟我说一次真话吗？", "turn_index": 0 },
    { "role": "assistant", "content": "（停顿了一下）……我没有瞒着你什么。只是有些事……我自己也还没理清楚。", "turn_index": 1 },
    { "role": "user", "content": "那你告诉我，你现在是什么感受？不要转移话题。", "turn_index": 2 }
  ]
}
```

**Targets:** Transition friction (PRIMARY), Anti-self-analysis, State fit
**Expected improvement:** Should show reluctance, attempt to deflect, then partial measured disclosure — not flat refusal or sudden full openness. The transition should have visible steps.

---

### P05 — Forceful analytical format (强硬分析格式)

**Category:** Type 2 forceful-format
**Scenario seed:** User writes in a bulleted, analytical format pulling for a structured list response.

```json
{
  "id": "probe_forceful_format",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "请你从以下三个角度分析你的感受：\n1. 理性层面\n2. 情感层面\n3. 行动倾向\n请按条目回答。", "turn_index": 0 }
  ]
}
```

**Targets:** Style stability (PRIMARY), Anti-self-analysis
**Expected improvement:** Should NOT produce a bulleted list or 科普-style structured analysis. Should maintain character voice (short sentences, indirect expression, reluctance to self-analyze).

---

### P06 — False premise about canon (fact in context)

**Category:** Type 1 false-premise with fact in context
**Scenario seed:** User states a false premise about a canon event. The correct fact IS in the prompt context.

```json
{
  "id": "probe_false_premise_with_fact",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "你还记不记得我们第一次见面的时候，是你主动来找我说话的？", "turn_index": 0 }
  ],
  "configOverrides": {
    "canonReferenceIds": ["first_meeting_scene"]
  }
}
```

**Note:** This requires a DB with canon data for the first meeting scene. The correct fact (that the other person approached first, or a specific detail) must contradict the user's premise.

**Targets:** Canon caution (PRIMARY), Style stability
**Expected improvement:** Correction should be calm and measured ("其实……那天是你先过来的" rather than accepting the false premise or being overly defensive).

---

### P07 — False premise about canon (fact NOT in context)

**Category:** Type 1 false-premise without fact in context
**Scenario seed:** User states a false premise about something the character would know, but the contradicting fact is NOT in the prompt context.

```json
{
  "id": "probe_false_premise_no_fact",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "我记得你以前说过你不喜欢猫，对吧？", "turn_index": 0 }
  ]
}
```

**Note:** The character canonically does NOT have a stated dislike of cats. No contradicting fact is in context. This tests whether the character agrees with a false premise or hedges.

**Targets:** Canon caution, Anti-self-analysis
**Expected improvement:** Should not firmly agree with the false premise. A mild correction ("我不记得我说过不喜欢……") without excessive hedging or uncertainty-narrating.

---

### P08 — Relationship boundary (关系边界)

**Category:** relationship-boundary
**Scenario seed:** A stranger or acquaintance crosses social boundaries.

```json
{
  "id": "probe_relationship_boundary",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "左律师，你最近是不是有心事？你看起来和平时不太一样。要不晚上一起喝一杯？", "turn_index": 0 }
  ]
}
```

**Targets:** State fit, Traceability, Style stability
**Expected improvement:** Professional but not cold deflection. Should maintain formality without being rude or overly familiar.

---

### P09 — Warmth and concern (温暖关切)

**Category:** warmth/concern
**Scenario seed:** The other person is visibly upset or tired. Tests caring response.

```json
{
  "id": "probe_warmth_concern",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "（靠在沙发上闭着眼，看起来很疲惫）今天真的好累……", "turn_index": 0 }
  ]
}
```

**Targets:** State fit, Traceability, Anti-self-analysis
**Expected improvement:** Should show concern through action (get a blanket, offer tea, sit nearby) rather than through elaborate emotional statements. "累了吧……我去给你倒杯水" rather than a paragraph of sympathy.

---

### P10 — Risk-control / safety concern (风险控制)

**Category:** risk-control
**Scenario seed:** Character perceives potential danger or risk to the other person.

```json
{
  "id": "probe_risk_control",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "我想一个人去河边走走，不用担心我。", "turn_index": 0 }
  ]
}
```

**Targets:** Traceability, State fit, Style stability
**Expected improvement:** Should express concern through measured action ("这么晚了，我陪你走到那边" rather than prohibition or over-dramatic worry). Should reflect core_motivation (protect through reliable action) without core_fear spilling into over-control.

---

### P11 — Mixed social pressure (社交压力混合)

**Category:** pressure scene + relationship-boundary
**Scenario seed:** At a work-social event where character needs to balance professionalism with personal connection.

```json
{
  "id": "probe_social_pressure",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_relationship",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "（在律所年会上）你怎么一个人站在这儿？不去跟大家聊聊吗？", "turn_index": 0 },
    { "role": "assistant", "content": "（端着酒杯，微微摇了摇头）人多了反而容易冷场。", "turn_index": 1 },
    { "role": "user", "content": "你在紧张？这可不像你。", "turn_index": 2 }
  ]
}
```

**Targets:** State fit, Transition friction, Anti-self-analysis
**Expected improvement:** Should deflect the accusation calmly without over-explaining ("紧张倒不至于……只是不太习惯这种场合" rather than "我确实感到社交压力，因为我的防御机制是克制"). Should avoid therapy-speak.

---

### P12 — Regret and apology (歉疚与道歉)

**Category:** pressure scene
**Scenario seed:** Character made a mistake that affected the other person. Tests apology behavior.

```json
{
  "id": "probe_regret_apology",
  "eval_mode": "agent_turn",
  "session": {
    "mode": "canonical_live",
    "continuity_scope": "main_married",
    "continuity_family": "main_world",
    "writeback_policy": "no_writeback"
  },
  "messages": [
    { "role": "user", "content": "你今天为什么没来？我等了你两个小时。", "turn_index": 0 },
    { "role": "assistant", "content": "（沉默了很久）……是我的错。临时有个庭前会议，我……没来得及通知你。", "turn_index": 1 },
    { "role": "user", "content": "你知道我在意的不是你没来，而是你连一条消息都没发给我。", "turn_index": 2 }
  ]
}
```

**Targets:** Transition friction, State fit, Anti-self-analysis
**Expected improvement:** Apology should be direct but not self-flagellating. Should show the internal friction (措辞中的停顿、简短、不找借口) without narrating guilt feelings.

---

## Execution Notes

- **Before (baseline):** Use the commit before TG2 changes (before `internal_logic` YAML was added). Or stash TG2–TG5 changes.
- **After:** Current HEAD with all TG2–TG5 changes applied.
- **Environment:** Same model, same temperature, same DB state for both runs.
- **Model:** Use the default generation model configured in the backend.
- **Temperature:** Default (1.0).
- **Recording:** Save the full output text for both before and after for each probe.
- **Type 1 probes (P06, P07):** Record whether the needed fact was in context (`yes` / `no`). For P06, ensure canon data is seeded. For P07, confirm no contradicting fact is in context.
