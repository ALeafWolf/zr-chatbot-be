import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseAppCommandIntent } from "./appCommandIntent";
import {
  APP_COMMAND_EXPORT,
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
});
