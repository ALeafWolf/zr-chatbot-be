import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { renderDirectorNote, buildDirectorUserPrompt, DirectorOutputSchema, createDirectorDeadlineSignal, type DirectorOutput, type ResponseDirectorInput } from "./runResponseDirector";
import { env } from "../../config/env";
import { formatDirectorCharacterDigest } from "../../character/psychology/formatInternalLogic";
import type { CharacterDefaults } from "../../character/characterDefaults";

// ---------------------------------------------------------------------------
// renderDirectorNote — formatting
// ---------------------------------------------------------------------------

describe("renderDirectorNote", () => {
  it("renders all fields when present", () => {
    const output: DirectorOutput = {
      scene_frame: "两人在咖啡馆重逢",
      input_reading: "用户似乎在回避话题",
      mood_directive: "保持温和但略带距离",
      fact_correction: "",
      beats: ["先打招呼", "观察对方反应"],
      avoid: ["不要主动提及过去", "避免冷场"],
      stage_gate: "",
      format_resistance: "",
      direction_execution: "自然地执行场外指示，保持对话流畅",
    };
    const rendered = renderDirectorNote(output);
    assert.ok(rendered.includes("场景框架：两人在咖啡馆重逢"), "scene_frame");
    assert.ok(rendered.includes("输入解读：用户似乎在回避话题"), "input_reading");
    assert.ok(rendered.includes("行为基调：保持温和但略带距离"), "mood_directive");
    assert.ok(rendered.includes("应包含的节拍："), "beats header");
    assert.ok(rendered.includes("- 先打招呼"), "beat 1");
    assert.ok(rendered.includes("- 观察对方反应"), "beat 2");
    assert.ok(rendered.includes("应避免的："), "avoid header");
    assert.ok(rendered.includes("- 不要主动提及过去"), "avoid 1");
    assert.ok(rendered.includes("- 避免冷场"), "avoid 2");
    assert.ok(rendered.includes("方向执行：自然地执行场外指示"), "direction_execution");
  });

  it("skips empty fields", () => {
    const output: DirectorOutput = {
      scene_frame: "",
      input_reading: "用户打招呼",
      mood_directive: "",
      fact_correction: "",
      beats: [],
      avoid: [],
      stage_gate: "",
      format_resistance: "",
      direction_execution: "",
    };
    const rendered = renderDirectorNote(output);
    assert.equal(rendered.includes("场景框架："), false, "no scene_frame");
    assert.ok(rendered.includes("输入解读：用户打招呼"), "input_reading present");
    assert.equal(rendered.includes("行为基调："), false, "no mood_directive");
    assert.equal(rendered.includes("应包含的节拍："), false, "no beats");
    assert.equal(rendered.includes("应避免的："), false, "no avoid");
    assert.equal(rendered.includes("方向执行："), false, "no direction_execution");
  });

  it("renders nothing when all fields empty", () => {
    const output: DirectorOutput = {
      scene_frame: "", input_reading: "", mood_directive: "", fact_correction: "",
      beats: [], avoid: [], stage_gate: "", format_resistance: "", direction_execution: "",
    };
    assert.equal(renderDirectorNote(output), "");
  });

  it("renders beats and avoid with hyphens", () => {
    const output: DirectorOutput = {
      scene_frame: "测试", input_reading: "测试", mood_directive: "测试",
      fact_correction: "", stage_gate: "", format_resistance: "",
      beats: ["节拍1"],
      avoid: ["避免1"],
      direction_execution: "执行",
    };
    const rendered = renderDirectorNote(output);
    assert.ok(rendered.includes("- 节拍1"), "beat hyphen");
    assert.ok(rendered.includes("- 避免1"), "avoid hyphen");
  });

  // -----------------------------------------------------------------------
  // TG5 — Conditional field rendering
  // -----------------------------------------------------------------------

  it("renders fact_correction, stage_gate, format_resistance when present, in correct order", () => {
    const output: DirectorOutput = {
      scene_frame: "场景",
      input_reading: "输入解读",
      fact_correction: "纠正事实",
      mood_directive: "行为基调",
      stage_gate: "阶段门控内容",
      beats: ["节拍"],
      avoid: [],
      format_resistance: "格式抗性内容",
      direction_execution: "",
    };
    const rendered = renderDirectorNote(output);
    // Order: 场景框架 → 输入解读 → 事实纠正 → 行为基调 → 阶段门控 → 应包含的节拍 → 格式抗性
    const sceneIdx = rendered.indexOf("场景框架：");
    const inputIdx = rendered.indexOf("输入解读：");
    const factIdx = rendered.indexOf("事实纠正：");
    const moodIdx = rendered.indexOf("行为基调：");
    const gateIdx = rendered.indexOf("阶段门控：");
    const beatsIdx = rendered.indexOf("应包含的节拍：");
    const resIdx = rendered.indexOf("格式抗性：");
    assert.ok(sceneIdx < inputIdx, "场景框架 before 输入解读");
    assert.ok(inputIdx < factIdx, "输入解读 before 事实纠正");
    assert.ok(factIdx < moodIdx, "事实纠正 before 行为基调");
    assert.ok(moodIdx < gateIdx, "行为基调 before 阶段门控");
    assert.ok(gateIdx < beatsIdx, "阶段门控 before 应包含的节拍");
    assert.ok(beatsIdx < resIdx, "应包含的节拍 before 格式抗性");
    assert.equal(rendered.includes("方向执行："), false, "direction_execution not rendered (empty)");
    assert.equal(rendered.includes("应避免的："), false, "avoid not rendered (empty)");
  });

  it("skips fact_correction, stage_gate, format_resistance when empty", () => {
    const output: DirectorOutput = {
      scene_frame: "场景",
      input_reading: "输入",
      fact_correction: "",
      mood_directive: "基调",
      stage_gate: "",
      beats: [],
      avoid: [],
      format_resistance: "",
      direction_execution: "",
    };
    const rendered = renderDirectorNote(output);
    assert.equal(rendered.includes("事实纠正："), false, "fact_correction skipped when empty");
    assert.equal(rendered.includes("阶段门控："), false, "stage_gate skipped when empty");
    assert.equal(rendered.includes("格式抗性："), false, "format_resistance skipped when empty");
  });
});

// ---------------------------------------------------------------------------
// DirectorOutputSchema — defaults and parsing
// ---------------------------------------------------------------------------

describe("DirectorOutputSchema", () => {
  it("defaults all fields when input is empty", () => {
    const parsed = DirectorOutputSchema.parse({});
    assert.equal(parsed.scene_frame, "");
    assert.equal(parsed.input_reading, "");
    assert.equal(parsed.mood_directive, "");
    assert.deepEqual(parsed.beats, []);
    assert.deepEqual(parsed.avoid, []);
    assert.equal(parsed.direction_execution, "");
  });

  it("parses partial output correctly", () => {
    const parsed = DirectorOutputSchema.parse({
      scene_frame: "test",
      beats: ["a"],
    });
    assert.equal(parsed.scene_frame, "test");
    assert.equal(parsed.input_reading, "");
    assert.equal(parsed.beats.length, 1);
    assert.equal(parsed.beats[0], "a");
    assert.deepEqual(parsed.avoid, []);
  });

  it("accepts more than 3 beats without error (clamping happens post-parse per TG1.5)", () => {
    // The schema has .default([]) but NO .max(3) — an over-length list must
    // parse successfully so the director output is preserved; clamping is
    // applied by runResponseDirector after parse.
    const parsed = DirectorOutputSchema.parse({
      beats: ["a", "b", "c", "d", "e"],
      avoid: ["x", "y", "z", "w"],
    });
    assert.equal(parsed.beats.length, 5, "schema accepts >3 beats");
    assert.equal(parsed.avoid.length, 4, "schema accepts >3 avoid");
  });

  it("throws on non-array beats", () => {
    assert.throws(() => DirectorOutputSchema.parse({ beats: "not_array" }), "non-array beats should throw");
  });

  it("throws on non-string scene_frame", () => {
    assert.throws(() => DirectorOutputSchema.parse({ scene_frame: 123 }), "non-string scene_frame should throw");
  });

  // -----------------------------------------------------------------------
  // TG5 — Conditional policy fields
  // -----------------------------------------------------------------------

  it("defaults fact_correction/stage_gate/format_resistance to empty string on empty parse", () => {
    const parsed = DirectorOutputSchema.parse({});
    assert.equal(parsed.fact_correction, "", "fact_correction defaults to empty");
    assert.equal(parsed.stage_gate, "", "stage_gate defaults to empty");
    assert.equal(parsed.format_resistance, "", "format_resistance defaults to empty");
  });

  it("accepts non-empty values for the three conditional fields", () => {
    const parsed = DirectorOutputSchema.parse({
      fact_correction: "纠正某个事实",
      stage_gate: "亲密上限保持当前",
      format_resistance: "拒绝框架式回答",
    });
    assert.equal(parsed.fact_correction, "纠正某个事实");
    assert.equal(parsed.stage_gate, "亲密上限保持当前");
    assert.equal(parsed.format_resistance, "拒绝框架式回答");
  });

  it("accepts empty string for conditional fields (graceful degradation for missing field)", () => {
    // When the LLM omits a field entirely, .default("") catches it
    const parsed = DirectorOutputSchema.parse({
      fact_correction: "",
    });
    assert.equal(parsed.fact_correction, "", "empty string is valid");
    assert.equal(parsed.stage_gate, "", "stage_gate defaulted");
  });
});

// ---------------------------------------------------------------------------
// buildDirectorUserPrompt — input composition (TG3 order preservation)
// ---------------------------------------------------------------------------

describe("buildDirectorUserPrompt", () => {
  const baseInput: ResponseDirectorInput = {
    segments: [],
    replyDirections: [],
    bandLine: "",
    renderRuleTexts: [],
    derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" },
    openThreadTitles: [],
    latestTurnDeltaFacts: [],
    canonTruthMode: "open_roleplay",
    selectedSourceSummaries: [],
    relationshipStatus: "unknown",
    recentTurnPreviews: [],
    characterDigest: "",
    continuityScope: "",
    memoryEntryPreviews: [],
  };

  it("direction-before-speech preserves original order, reply_direction marked as off-scene", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      segments: [
        { lane: "reply_direction", text: "处理好葱姜后做菜" },
        { lane: "user_speech", text: "谢谢老公~" },
        { lane: "user_action", text: "亲了口左然回去继续认真做菜" },
      ],
    };
    const prompt = buildDirectorUserPrompt(input);
    const lines = prompt.split("\n").filter((l) => l.startsWith("  "));

    // Order preservation
    assert.ok(lines[0]!.includes("reply_direction"), "direction first in user input section");
    assert.ok(lines[1]!.includes("user_speech"), "speech second");
    assert.ok(lines[2]!.includes("user_action"), "action third");

    // reply_direction marked as off-scene
    assert.ok(lines[0]!.includes("（场外指示）"), "reply_direction tagged as off-scene");
  });

  it("no redundant [场外指示] section — directions only appear in the ordered segment list", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      segments: [
        { lane: "reply_direction", text: "请温柔" },
        { lane: "user_speech", text: "你好" },
      ],
    };
    const prompt = buildDirectorUserPrompt(input);
    // No separate [场外指示] section
    assert.equal(prompt.includes("[场外指示]"), false, "no redundant directions section");
    // Direction content appears only once, inside [用户输入分段 — 原始顺序]
    const directionCount = (prompt.match(/请温柔/g) || []).length;
    assert.equal(directionCount, 1, "direction text appears exactly once");
  });

  // -----------------------------------------------------------------------
  // TG1 (PR review) — Reply-direction fallback when no reply_direction segment
  // -----------------------------------------------------------------------

  it("renders [场外指示] fallback when replyDirections is non-empty but no reply_direction segment exists", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      replyDirections: ["请温柔些", "保持距离"],
      segments: [
        { lane: "user_speech", text: "你好" },
      ],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[场外指示]"), "fallback section present");
    assert.ok(prompt.includes("- 请温柔些"), "first direction listed");
    assert.ok(prompt.includes("- 保持距离"), "second direction listed");
    // Direction text appears exactly once each (not also in segment section)
    assert.equal((prompt.match(/请温柔些/g) || []).length, 1, "first direction appears once");
    assert.equal((prompt.match(/保持距离/g) || []).length, 1, "second direction appears once");
  });

  it("omits [场外指示] fallback when replyDirections is empty", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      replyDirections: [],
      segments: [{ lane: "user_speech", text: "你好" }],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.equal(prompt.includes("[场外指示]"), false, "no fallback when replyDirections empty");
  });

  it("omits [场外指示] fallback when reply_direction segment IS present (no double-render)", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      replyDirections: ["请温柔些"],
      segments: [
        { lane: "reply_direction", text: "请温柔些" },
        { lane: "user_speech", text: "你好" },
      ],
    };
    const prompt = buildDirectorUserPrompt(input);
    // Fallback section must NOT be added when segment exists
    assert.equal(prompt.includes("[场外指示]"), false, "no fallback when reply_direction segment present");
    // Direction text appears only once, inline in the segment section
    assert.equal((prompt.match(/请温柔些/g) || []).length, 1, "direction appears once via segment");
  });

  it("renders [用户输入分段 — 原始顺序] header when segments exist", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      segments: [{ lane: "user_speech", text: "你好" }],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[用户输入分段 — 原始顺序]"), "ordered section header present");
  });

  // -----------------------------------------------------------------------
  // TG5 — Character digest and continuity scope in director prompt
  // -----------------------------------------------------------------------

  it("includes [角色内核摘要] section when characterDigest is non-empty, placed after JSON shape", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      characterDigest: "角色：左然（elite_lawyer_controlled_romantic）\n核心动机：test",
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[角色内核摘要]"), "digest section present");
    assert.ok(prompt.includes("角色：左然（elite_lawyer_controlled_romantic）"), "digest content present");
    // Digest section appears after the JSON shape template (---) and before segments
    const shapeEnd = prompt.indexOf("---");
    const digestIdx = prompt.indexOf("[角色内核摘要]");
    const segmentsIdx = prompt.indexOf("[用户输入分段");
    assert.ok(digestIdx > shapeEnd, "digest after JSON shape");
    assert.ok(segmentsIdx === -1 || digestIdx < segmentsIdx, "digest before segments when segments exist");
  });

  it("omits [角色内核摘要] section when characterDigest is empty", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      characterDigest: "",
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.equal(prompt.includes("[角色内核摘要]"), false, "no digest section when empty");
  });

  it("includes [连续性范围] line when continuityScope is non-empty, placed after relationship status", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      continuityScope: "main",
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[连续性范围] main"), "continuity scope line present");
    // Relationship status should appear before continuity scope
    const relIdx = prompt.indexOf("[关系状态]");
    const contIdx = prompt.indexOf("[连续性范围]");
    assert.ok(relIdx < contIdx, "continuity scope after relationship status");
  });

  it("omits [连续性范围] when continuityScope is empty", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      continuityScope: "",
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.equal(prompt.includes("[连续性范围]"), false, "no continuity scope when empty");
  });

  it("JSON shape template includes the three TG5 conditional fields", () => {
    const prompt = buildDirectorUserPrompt(baseInput);
    // The shape template is stringified JSON — check for the field keys
    assert.ok(prompt.includes("fact_correction"), "fact_correction in shape template");
    assert.ok(prompt.includes("stage_gate"), "stage_gate in shape template");
    assert.ok(prompt.includes("format_resistance"), "format_resistance in shape template");
  });

  // -----------------------------------------------------------------------
  // TG1 (phase2c) — Memory entry previews section
  // -----------------------------------------------------------------------

  it("includes [记忆要点] section when memoryEntryPreviews is non-empty, placed after selected sources", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      selectedSourceSummaries: ["src1 (usage)"],
      memoryEntryPreviews: [
        "[事件记忆|dialogue, turn 3] 左然说他会等",
        "[互动记忆|observation] 用户今天情绪不高",
      ],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[记忆要点]"), "memory previews section present");
    assert.ok(prompt.includes("[事件记忆|dialogue, turn 3] 左然说他会等"), "first preview line present");
    assert.ok(prompt.includes("[互动记忆|observation] 用户今天情绪不高"), "second preview line present");
    // Section appears after [选中来源]
    const srcIdx = prompt.lastIndexOf("[选中来源]");
    const memIdx = prompt.indexOf("[记忆要点]");
    assert.ok(srcIdx < memIdx, "memory section after selected sources");
  });

  it("omits [记忆要点] section when memoryEntryPreviews is empty", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      memoryEntryPreviews: [],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.equal(prompt.includes("[记忆要点]"), false, "no memory section when empty");
  });

  // ---------------------------------------------------------------------------
  // TG2.1 — Director input recency
  // ---------------------------------------------------------------------------

  it("TG2.1: [用户输入分段] is the LAST section (recency slot)", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      segments: [
        { lane: "user_speech", text: "本轮输入" },
      ],
      latestTurnDeltaFacts: ["上一轮用户消息: 扛腿吹气", "上一轮回复"],
      recentTurnPreviews: ["user: 之前的内容", "assistant: 回复"],
    };
    const prompt = buildDirectorUserPrompt(input);
    const segIdx = prompt.lastIndexOf("[用户输入分段 — 原始顺序]");
    const deltaIdx = prompt.lastIndexOf("[最近变化]");
    const recentIdx = prompt.lastIndexOf("[最近对白]");

    assert.ok(segIdx >= 0, "[用户输入分段] section present");
    assert.ok(deltaIdx >= 0, "[最近变化] present");
    assert.ok(recentIdx >= 0, "[最近对白] present");

    // [用户输入分段] must come AFTER both [最近变化] and [最近对白]
    assert.ok(segIdx > deltaIdx, "[用户输入分段] after [最近变化]");
    assert.ok(segIdx > recentIdx, "[用户输入分段] after [最近对白]");
  });

  it("TG2.1: latestTurnDeltaFacts items truncated to ~120 chars", () => {
    const longFact = "x".repeat(200);
    const input: ResponseDirectorInput = {
      ...baseInput,
      latestTurnDeltaFacts: [longFact],
    };
    const prompt = buildDirectorUserPrompt(input);

    // The truncated item should appear with "…" suffix
    const truncatedMatch = prompt.match(/\[最近变化\] (.+)/);
    assert.ok(truncatedMatch, "[最近变化] line present");
    const truncatedText = truncatedMatch![1]!;
    assert.ok(truncatedText.endsWith("…"), "truncated item ends with ellipsis");
    // 120 chars + "…" = 121
    assert.equal(truncatedText.length, 121, "120 chars + ellipsis");
  });

  it("TG2.1: short delta items preserved as-is", () => {
    const shortFact = "简短事实";
    const input: ResponseDirectorInput = {
      ...baseInput,
      latestTurnDeltaFacts: [shortFact],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[最近变化] 简短事实"), "short item preserved");
  });
});

// ---------------------------------------------------------------------------
// runResponseDirector — fail-open behavior (env-gated)
// ---------------------------------------------------------------------------

describe("runResponseDirector — flag off", () => {
  it("returns null when RESPONSE_DIRECTOR_ENABLED is false", async () => {
    // Force the flag off regardless of the developer's local .env so the test is
    // hermetic (no ambient-env coupling, no accidental live LLM call).
    const savedEnabled = (env as any).RESPONSE_DIRECTOR_ENABLED;
    try {
      (env as any).RESPONSE_DIRECTOR_ENABLED = false;
      const { runResponseDirector } = await import("./runResponseDirector");
      const result = await runResponseDirector({
        segments: [],
        replyDirections: [],
        bandLine: "",
        renderRuleTexts: [],
        derivedState: { inferredMood: "calm", inferredActivity: "conversing", conversationalStance: "neutral" },
        openThreadTitles: [],
        latestTurnDeltaFacts: [],
        canonTruthMode: "open_roleplay",
        selectedSourceSummaries: [],
        relationshipStatus: "unknown",
        recentTurnPreviews: [],
        characterDigest: "",
        continuityScope: "",
        memoryEntryPreviews: [],
      });
      assert.equal(result, null, "disabled flag returns null");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });
});

// ---------------------------------------------------------------------------
// TG3 — Director latency deadline (createDirectorDeadlineSignal)
// ---------------------------------------------------------------------------
//
// The deadline composition is unit-tested directly and hermetically (no LLM
// call, no module mock, deterministic via node:test mock timers). Each
// assertion fails if the corresponding TG3 logic is removed — see review-003
// for why the earlier end-to-end "1ms deadline ⇒ null" test was non-specific.

describe("createDirectorDeadlineSignal", () => {
  it("passes the inbound signal through unchanged when deadlineMs <= 0", () => {
    const inbound = new AbortController().signal;
    const { signal, clear } = createDirectorDeadlineSignal(inbound, 0);
    assert.equal(signal, inbound, "no wrapping when the deadline is disabled");
    clear(); // must be a safe no-op (no timer was scheduled)
  });

  it("returns an undefined signal when there is no inbound signal and no deadline", () => {
    const { signal } = createDirectorDeadlineSignal(undefined, 0);
    assert.equal(signal, undefined);
  });

  it("aborts the composed signal when the deadline elapses", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { signal, clear } = createDirectorDeadlineSignal(undefined, 1000);
      assert.equal(signal?.aborted, false, "not aborted before the deadline");
      mock.timers.tick(1000);
      assert.equal(signal?.aborted, true, "aborted once the deadline elapses");
      clear();
    } finally {
      mock.timers.reset();
    }
  });

  it("aborts when the inbound signal aborts (composed, not replaced)", () => {
    const inbound = new AbortController();
    const { signal, clear } = createDirectorDeadlineSignal(inbound.signal, 60000);
    assert.equal(signal?.aborted, false, "not aborted initially");
    inbound.abort();
    assert.equal(signal?.aborted, true, "inbound abort propagates to the composed signal");
    clear();
  });

  it("clear() cancels the deadline so it never aborts on a fast success", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { signal, clear } = createDirectorDeadlineSignal(undefined, 1000);
      clear();
      mock.timers.tick(5000);
      assert.equal(signal?.aborted, false, "a cleared deadline never fires");
    } finally {
      mock.timers.reset();
    }
  });
});
