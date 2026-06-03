import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAppCommandIntent } from "./appCommandIntent";
import {
  APP_COMMAND_EXPORT,
  APP_COMMAND_HELP,
  APP_COMMAND_STATUS,
  APP_COMMAND_UNKNOWN,
} from "./appCommandTypes";

describe("parseAppCommandIntent", () => {
  // ---- export detection ----
  it('maps export keywords to APP_COMMAND_EXPORT', () => {
    const cases: Array<{ input: string; note: string }> = [
      { input: "export this session", note: "export" },
      { input: "download the conversation", note: "download" },
      { input: "导出会话", note: "Chinese 导出" },
      { input: "下载记录", note: "Chinese 下载" },
      { input: "请帮我导出会话", note: "导出 mid-sentence" },
      { input: "可以下载这个记录吗", note: "下载 mid-sentence" },
      { input: "show raw turns", note: "raw turns phrase" },
      { input: "get transcript", note: "transcript" },
      { input: "save conversation", note: "conversation" },
      { input: "export as json", note: "export as json (folds 378)" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.command, APP_COMMAND_EXPORT, c.note);
    }
  });

  // ---- format detection ----
  it("detects export format", () => {
    const cases: Array<{ input: string; expected: string; note: string }> = [
      { input: "export session", expected: "md", note: "default md" },
      { input: "export as json", expected: "json", note: "json" },
      { input: "download as markdown", expected: "md", note: "markdown keyword" },
      { input: "export as text", expected: "txt", note: "txt" },
      { input: "export as json please", expected: "json", note: "explicit wins" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.args.format, c.expected, c.note);
    }
  });

  // ---- defaults ----
  it("provides sensible defaults", () => {
    const result = parseAppCommandIntent("export this session");
    assert.deepEqual(result.args.turn_types, ["roleplay", "unsupported"]);
    assert.equal(result.args.include_thoughts, false);
    assert.equal(result.args.include_native_thoughts, false);
  });

  // ---- turn type filter parsing ----
  it('parses turn_type filters', () => {
    const cases: Array<{ input: string; expected: string[]; note: string }> = [
      { input: "export roleplay only as json", expected: ["roleplay"], note: "roleplay only" },
      { input: "export all turns as text", expected: ["roleplay", "app_command", "unsupported"], note: "all" },
      { input: "export unsupport only", expected: ["unsupported"], note: "unsupport alias" },
      { input: "export app commands as json", expected: ["app_command"], note: "app commands" },
      { input: "export roleplay and app commands", expected: ["roleplay", "app_command"], note: "combined" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.deepEqual(result.args.turn_types, c.expected, c.note);
    }
  });

  // ---- turn_type aliases (Review 010) ----
  it('parses turn_type aliases', () => {
    const cases: Array<{ input: string; expected: string[]; note: string }> = [
      { input: "export full history", expected: ["roleplay", "app_command", "unsupported"], note: "full → all" },
      { input: "export commands only", expected: ["app_command"], note: "commands" },
      { input: "export tool output", expected: ["app_command"], note: "tool output" },
      { input: "export story", expected: ["roleplay"], note: "story" },
      { input: "export chat turns", expected: ["roleplay"], note: "chat" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.deepEqual(result.args.turn_types, c.expected, c.note);
    }
  });

  // ---- include_thoughts parsing ----
  it('parses include_thoughts flag', () => {
    const cases: Array<{ input: string; expected: boolean; note: string }> = [
      { input: "export as json with thoughts", expected: true, note: "with thoughts" },
      { input: "export include thoughts", expected: true, note: "include thoughts" },
      { input: "export as json with reasoning", expected: true, note: "with reasoning" },
      { input: "export with thinking", expected: true, note: "with thinking" },
      { input: "export as json with thoughts but without thoughts", expected: false, note: "without (precedence)" },
      { input: "export as json no thoughts", expected: false, note: "no thoughts" },
      { input: "export exclude thoughts", expected: false, note: "exclude thoughts" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.args.include_thoughts, c.expected, c.note);
    }
  });

  // ---- include_native_thoughts parsing ----
  it('parses include_native_thoughts flag', () => {
    const cases: Array<{ input: string; expectedNative: boolean; note: string }> = [
      { input: "export as json with thoughts", expectedNative: false, note: "default false" },
      { input: "export with thoughts", expectedNative: false, note: "with thoughts" },
      { input: "export with reasoning", expectedNative: false, note: "with reasoning" },
      { input: "export with thinking", expectedNative: false, note: "with thinking" },
      { input: "export include native thoughts", expectedNative: true, note: "include native" },
      { input: "export with native thoughts", expectedNative: true, note: "with native" },
      { input: "export debug thoughts", expectedNative: true, note: "debug" },
      { input: "导出包含原生思考", expectedNative: true, note: "Chinese 包含原生思考" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.args.include_native_thoughts, c.expectedNative, c.note);
    }
  });

  // ---- native/debug prompts set both flags ----
  it('sets both include_thoughts and include_native_thoughts for native/debug', () => {
    // Native/debug prompts: BOTH flags should be true
    const bothTrue: Array<{ input: string; note: string }> = [
      { input: "export include native thoughts", note: "include native thoughts" },
      { input: "export with native thoughts", note: "with native thoughts" },
      { input: "export debug thoughts", note: "debug thoughts" },
    ];
    for (const c of bothTrue) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.args.include_thoughts, true, `${c.note} — include_thoughts`);
      assert.equal(result.args.include_native_thoughts, true, `${c.note} — include_native_thoughts`);
    }
    // Generic phrases: include_thoughts = true, include_native_thoughts = false
    const thoughtsOnly: Array<{ input: string; note: string }> = [
      { input: "export with thoughts", note: "with thoughts (generic only)" },
      { input: "export with reasoning", note: "with reasoning (generic only)" },
      { input: "export with thinking", note: "with thinking (generic only)" },
    ];
    for (const c of thoughtsOnly) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.args.include_thoughts, true, `${c.note} — include_thoughts`);
      assert.equal(result.args.include_native_thoughts, false, `${c.note} — include_native_thoughts`);
    }
  });

  // ---- exclusion wins over native/debug prompts ----
  it('excludes both flags when debug thoughts combined with "without thoughts"', () => {
    const result = parseAppCommandIntent("export debug thoughts without thoughts");
    assert.equal(result.args.include_thoughts, false);
    assert.equal(result.args.include_native_thoughts, false);
  });

  // ---- help detection ----
  it('detects help intents with language', () => {
    const cases: Array<{ input: string; expectedLang?: string; note: string }> = [
      { input: "how do I export the session", expectedLang: "en", note: "English 'how do I'" },
      { input: "help me with export options", note: "English 'help with'" },
      { input: "what export options do I have", note: "English 'what export'" },
      { input: "怎么导出会话记录", expectedLang: "zh", note: "Chinese 怎么" },
      { input: "导出帮助", expectedLang: "zh", note: "Chinese 帮助" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.command, APP_COMMAND_HELP, `${c.note} — command`);
      if (c.expectedLang) {
        assert.equal(result.args.language, c.expectedLang, `${c.note} — language`);
      }
    }
  });

  // ---- status detection ----
  it('detects status intents', () => {
    const statusCases: Array<{ input: string; note: string }> = [
      { input: "show session status", note: "status keyword" },
      { input: "show stats", note: "stats" },
      { input: "view statistics", note: "statistics" },
      { input: "info about this session", note: "info" },
      { input: "查看会话状态", note: "Chinese 会话状态" },
      { input: "显示统计", note: "Chinese 统计" },
      { input: "信息", note: "Chinese 信息" },
    ];
    for (const c of statusCases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.command, APP_COMMAND_STATUS, c.note);
    }
    // export takes precedence over status
    const result = parseAppCommandIntent("export status");
    assert.equal(result.command, APP_COMMAND_EXPORT, "export before status");
  });

  // ---- unknown + negative export guards ----
  it('returns UNKNOWN for unsupported or non-export intents', () => {
    const cases: Array<{ input: string; note: string }> = [
      { input: "hello there", note: "unrelated input" },
      { input: "", note: "empty string" },
      { input: "the conversation was fun", note: "standalone conversation" },
      { input: "transcript of the day", note: "standalone transcript" },
      { input: "I like this conversation", note: "conversation with non-export verb" },
      { input: "forget transcript", note: "forget transcript (substring)" },
      { input: "target conversation", note: "target conversation (substring)" },
    ];
    for (const c of cases) {
      const result = parseAppCommandIntent(c.input);
      assert.equal(result.command, APP_COMMAND_UNKNOWN, c.note);
    }
    // "hello there" also returns empty args
    assert.deepEqual(parseAppCommandIntent("hello there").args, {});
  });
});
