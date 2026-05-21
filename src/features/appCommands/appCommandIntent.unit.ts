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
  it('detects "export" keyword', () => {
    const result = parseAppCommandIntent("export this session");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects "download" keyword', () => {
    const result = parseAppCommandIntent("download the conversation");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects Chinese "导出"', () => {
    const result = parseAppCommandIntent("导出会话");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects Chinese "下载"', () => {
    const result = parseAppCommandIntent("下载记录");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects Chinese "导出" when preceded by other words', () => {
    const result = parseAppCommandIntent("请帮我导出会话");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects Chinese "下载" when preceded by other words', () => {
    const result = parseAppCommandIntent("可以下载这个记录吗");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects "raw turns" phrase', () => {
    const result = parseAppCommandIntent("show raw turns");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects "transcript" keyword', () => {
    const result = parseAppCommandIntent("get transcript");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('detects "conversation" keyword', () => {
    const result = parseAppCommandIntent("save conversation");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  // ---- format detection ----
  it('defaults format to "md" when no format is mentioned', () => {
    const result = parseAppCommandIntent("export session");
    assert.equal(result.args.format, "md");
  });

  it("detects json format", () => {
    const result = parseAppCommandIntent("export as json");
    assert.equal(result.args.format, "json");
  });

  it("detects md format via markdown keyword", () => {
    const result = parseAppCommandIntent("download as markdown");
    assert.equal(result.args.format, "md");
  });

  it("detects txt format", () => {
    const result = parseAppCommandIntent("export as text");
    assert.equal(result.args.format, "txt");
  });

  it('prefers explicit format over implicit "export"', () => {
    const result = parseAppCommandIntent("export as json please");
    assert.equal(result.args.format, "json");
  });

  // ---- default turn_types ----
  it('defaults turn_types to ["roleplay", "unsupported"]', () => {
    const result = parseAppCommandIntent("export this session");
    assert.deepEqual(result.args.turn_types, ["roleplay", "unsupported"]);
  });

  it('defaults include_thoughts to false', () => {
    const result = parseAppCommandIntent("export this session");
    assert.equal(result.args.include_thoughts, false);
  });

  // ---- turn type filter parsing ----
  it('parses "roleplay only" filter', () => {
    const result = parseAppCommandIntent("export roleplay only as json");
    assert.deepEqual(result.args.turn_types, ["roleplay"]);
  });

  it('parses "all" types filter', () => {
    const result = parseAppCommandIntent("export all turns as text");
    assert.deepEqual(result.args.turn_types, ["roleplay", "app_command", "unsupported"]);
  });

  it('parses "unsupport" as unsupported', () => {
    const result = parseAppCommandIntent("export unsupport only");
    assert.deepEqual(result.args.turn_types, ["unsupported"]);
  });

  it('parses "app commands" filter', () => {
    const result = parseAppCommandIntent("export app commands as json");
    assert.deepEqual(result.args.turn_types, ["app_command"]);
  });

  it('parses combined types: "roleplay and app commands"', () => {
    const result = parseAppCommandIntent("export roleplay and app commands");
    assert.deepEqual(result.args.turn_types, ["roleplay", "app_command"]);
  });

  // ---- include_thoughts parsing ----
  it('parses "with thoughts"', () => {
    const result = parseAppCommandIntent("export as json with thoughts");
    assert.equal(result.args.include_thoughts, true);
  });

  it('parses "include thoughts"', () => {
    const result = parseAppCommandIntent("export include thoughts");
    assert.equal(result.args.include_thoughts, true);
  });

  it('parses "with reasoning" as include_thoughts', () => {
    const result = parseAppCommandIntent("export as json with reasoning");
    assert.equal(result.args.include_thoughts, true);
  });

  it('parses "with thinking" as include_thoughts', () => {
    const result = parseAppCommandIntent("export with thinking");
    assert.equal(result.args.include_thoughts, true);
  });

  it('parses "without thoughts" as exclude (precedence)', () => {
    const result = parseAppCommandIntent("export as json with thoughts but without thoughts");
    assert.equal(result.args.include_thoughts, false);
  });

  it('parses "no thoughts" as exclude', () => {
    const result = parseAppCommandIntent("export as json no thoughts");
    assert.equal(result.args.include_thoughts, false);
  });

  it('parses "exclude thoughts" as exclude', () => {
    const result = parseAppCommandIntent("export exclude thoughts");
    assert.equal(result.args.include_thoughts, false);
  });

  // ---- include_native_thoughts parsing ----
  it('defaults include_native_thoughts to false', () => {
    const result = parseAppCommandIntent("export as json with thoughts");
    assert.equal(result.args.include_native_thoughts, false);
  });

  it('does not enable native from "with thoughts"', () => {
    const result = parseAppCommandIntent("export with thoughts");
    assert.equal(result.args.include_native_thoughts, false);
  });

  it('does not enable native from "with reasoning"', () => {
    const result = parseAppCommandIntent("export with reasoning");
    assert.equal(result.args.include_native_thoughts, false);
  });

  it('does not enable native from "with thinking"', () => {
    const result = parseAppCommandIntent("export with thinking");
    assert.equal(result.args.include_native_thoughts, false);
  });

  it('enables native from "include native thoughts"', () => {
    const result = parseAppCommandIntent("export include native thoughts");
    assert.equal(result.args.include_native_thoughts, true);
  });

  it('enables native from "with native thoughts"', () => {
    const result = parseAppCommandIntent("export with native thoughts");
    assert.equal(result.args.include_native_thoughts, true);
  });

  it('enables native from "debug thoughts"', () => {
    const result = parseAppCommandIntent("export debug thoughts");
    assert.equal(result.args.include_native_thoughts, true);
  });

  it('enables native from Chinese "包含原生思考"', () => {
    const result = parseAppCommandIntent("导出包含原生思考");
    assert.equal(result.args.include_native_thoughts, true);
  });

  // ---- native/debug prompts enable both flags ----
  it('sets both flags for "include native thoughts"', () => {
    const result = parseAppCommandIntent("export include native thoughts");
    assert.equal(result.args.include_thoughts, true);
    assert.equal(result.args.include_native_thoughts, true);
  });

  it('sets both flags for "with native thoughts"', () => {
    const result = parseAppCommandIntent("export with native thoughts");
    assert.equal(result.args.include_thoughts, true);
    assert.equal(result.args.include_native_thoughts, true);
  });

  it('sets both flags for "debug thoughts"', () => {
    const result = parseAppCommandIntent("export debug thoughts");
    assert.equal(result.args.include_thoughts, true);
    assert.equal(result.args.include_native_thoughts, true);
  });

  // ---- exclusion wins over native/debug prompts ----
  it('excludes both flags when debug thoughts combined with "without thoughts"', () => {
    const result = parseAppCommandIntent("export debug thoughts without thoughts");
    assert.equal(result.args.include_thoughts, false);
    assert.equal(result.args.include_native_thoughts, false);
  });

  // ---- generic phrases still do not enable native ----
  it('does not enable native from "with thoughts" (both flags check)', () => {
    const result = parseAppCommandIntent("export with thoughts");
    assert.equal(result.args.include_thoughts, true);
    assert.equal(result.args.include_native_thoughts, false);
  });

  it('does not enable native from "with reasoning" (both flags check)', () => {
    const result = parseAppCommandIntent("export with reasoning");
    assert.equal(result.args.include_thoughts, true);
    assert.equal(result.args.include_native_thoughts, false);
  });

  it('does not enable native from "with thinking" (both flags check)', () => {
    const result = parseAppCommandIntent("export with thinking");
    assert.equal(result.args.include_thoughts, true);
    assert.equal(result.args.include_native_thoughts, false);
  });

  // ---- missing aliases (Review 010) ----
  it('parses "full" as all types', () => {
    const result = parseAppCommandIntent("export full history");
    assert.deepEqual(result.args.turn_types, ["roleplay", "app_command", "unsupported"]);
  });

  it('parses "commands" as app_command', () => {
    const result = parseAppCommandIntent("export commands only");
    assert.deepEqual(result.args.turn_types, ["app_command"]);
  });

  it('parses "tool output" as app_command', () => {
    const result = parseAppCommandIntent("export tool output");
    assert.deepEqual(result.args.turn_types, ["app_command"]);
  });

  it('parses "story" as roleplay', () => {
    const result = parseAppCommandIntent("export story");
    assert.deepEqual(result.args.turn_types, ["roleplay"]);
  });

  it('parses "chat" as roleplay', () => {
    const result = parseAppCommandIntent("export chat turns");
    assert.deepEqual(result.args.turn_types, ["roleplay"]);
  });

  // ---- help detection ----
  it('detects English help: "how do I export"', () => {
    const result = parseAppCommandIntent("how do I export the session");
    assert.equal(result.command, APP_COMMAND_HELP);
    assert.equal(result.args.language, "en");
  });

  it('detects English help: "help with export"', () => {
    const result = parseAppCommandIntent("help me with export options");
    assert.equal(result.command, APP_COMMAND_HELP);
  });

  it('detects English help: "what export options"', () => {
    const result = parseAppCommandIntent("what export options do I have");
    assert.equal(result.command, APP_COMMAND_HELP);
  });

  it('detects Chinese help: "怎么导出"', () => {
    const result = parseAppCommandIntent("怎么导出会话记录");
    assert.equal(result.command, APP_COMMAND_HELP);
    assert.equal(result.args.language, "zh");
  });

  it('detects Chinese help: "导出帮助"', () => {
    const result = parseAppCommandIntent("导出帮助");
    assert.equal(result.command, APP_COMMAND_HELP);
    assert.equal(result.args.language, "zh");
  });

  // ---- status detection ----
  it('detects "status" keyword', () => {
    const result = parseAppCommandIntent("show session status");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it('detects "stats" keyword', () => {
    const result = parseAppCommandIntent("show stats");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it('detects "statistics" keyword', () => {
    const result = parseAppCommandIntent("view statistics");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it('detects "info" at start', () => {
    const result = parseAppCommandIntent("info about this session");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it('detects Chinese "会话状态"', () => {
    const result = parseAppCommandIntent("查看会话状态");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it('detects Chinese "统计"', () => {
    const result = parseAppCommandIntent("显示统计");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it('detects Chinese "信息" at start', () => {
    const result = parseAppCommandIntent("信息");
    assert.equal(result.command, APP_COMMAND_STATUS);
  });

  it("routes export before status when both match", () => {
    const result = parseAppCommandIntent("export status");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  // ---- unsupported ----
  it("returns unknown for unrelated input", () => {
    const result = parseAppCommandIntent("hello there");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
    assert.deepEqual(result.args, {});
  });

  it("returns unknown for empty string", () => {
    const result = parseAppCommandIntent("");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
  });

  // ---- negative export tests (broad words need a verb) ----
  it('does not trigger export for standalone "conversation"', () => {
    const result = parseAppCommandIntent("the conversation was fun");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
  });

  it('does not trigger export for standalone "transcript"', () => {
    const result = parseAppCommandIntent("transcript of the day");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
  });

  it('does not trigger export for "conversation" with non-export verb', () => {
    const result = parseAppCommandIntent("I like this conversation");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
  });

  it('does not trigger export for "forget transcript" (get substring)', () => {
    const result = parseAppCommandIntent("forget transcript");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
  });

  it('does not trigger export for "target conversation" (get substring)', () => {
    const result = parseAppCommandIntent("target conversation");
    assert.equal(result.command, APP_COMMAND_UNKNOWN);
  });

  // ---- preserved positive export prompts ----
  it('preserves "export as json" detection', () => {
    const result = parseAppCommandIntent("export as json");
    assert.equal(result.command, APP_COMMAND_EXPORT);
    assert.equal(result.args.format, "json");
  });

  it('preserves "download the conversation" detection', () => {
    const result = parseAppCommandIntent("download the conversation");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('preserves "get transcript" detection', () => {
    const result = parseAppCommandIntent("get transcript");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });

  it('preserves "save conversation" detection', () => {
    const result = parseAppCommandIntent("save conversation");
    assert.equal(result.command, APP_COMMAND_EXPORT);
  });
});
