import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderDirectorNote, buildDirectorUserPrompt, DirectorOutputSchema, type DirectorOutput, type ResponseDirectorInput } from "./runResponseDirector";
import { env } from "../../config/env";

// ---------------------------------------------------------------------------
// renderDirectorNote — formatting
// ---------------------------------------------------------------------------

describe("renderDirectorNote", () => {
  it("renders all fields when present", () => {
    const output: DirectorOutput = {
      scene_frame: "两人在咖啡馆重逢",
      input_reading: "用户似乎在回避话题",
      mood_directive: "保持温和但略带距离",
      beats: ["先打招呼", "观察对方反应"],
      avoid: ["不要主动提及过去", "避免冷场"],
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
      beats: [],
      avoid: [],
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
      scene_frame: "", input_reading: "", mood_directive: "",
      beats: [], avoid: [], direction_execution: "",
    };
    assert.equal(renderDirectorNote(output), "");
  });

  it("renders beats and avoid with hyphens", () => {
    const output: DirectorOutput = {
      scene_frame: "测试", input_reading: "测试", mood_directive: "测试",
      beats: ["节拍1"],
      avoid: ["避免1"],
      direction_execution: "执行",
    };
    const rendered = renderDirectorNote(output);
    assert.ok(rendered.includes("- 节拍1"), "beat hyphen");
    assert.ok(rendered.includes("- 避免1"), "avoid hyphen");
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

  it("throws on non-array beats", () => {
    assert.throws(() => DirectorOutputSchema.parse({ beats: "not_array" }), "non-array beats should throw");
  });

  it("throws on non-string scene_frame", () => {
    assert.throws(() => DirectorOutputSchema.parse({ scene_frame: 123 }), "non-string scene_frame should throw");
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

  it("renders [用户输入分段 — 原始顺序] header when segments exist", () => {
    const input: ResponseDirectorInput = {
      ...baseInput,
      segments: [{ lane: "user_speech", text: "你好" }],
    };
    const prompt = buildDirectorUserPrompt(input);
    assert.ok(prompt.includes("[用户输入分段 — 原始顺序]"), "ordered section header present");
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
      });
      assert.equal(result, null, "disabled flag returns null");
    } finally {
      (env as any).RESPONSE_DIRECTOR_ENABLED = savedEnabled;
    }
  });
});
