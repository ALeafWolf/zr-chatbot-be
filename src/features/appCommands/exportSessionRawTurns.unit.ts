import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExportArtifact } from "./exportSessionRawTurns";
import type { ChatMessage } from "../../db/schema/chat";
import type { ExportOptions, FileExportResult } from "./appCommandTypes";
import type { EmotionalAxisTurnExportSnapshot } from "../../state/emotionalEngine/types";

function opts(
  format: ExportOptions["format"],
  overrides?: Partial<ExportOptions>,
): ExportOptions {
  return {
    format,
    turn_types: ["roleplay", "unsupported"],
    include_thoughts: false,
    include_native_thoughts: false,
    ...overrides,
  };
}

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? "msg-1",
    sessionId: overrides.sessionId ?? "session-test-1234",
    turnIndex: overrides.turnIndex ?? 0,
    role: overrides.role ?? "user",
    route: overrides.route ?? "roleplay_turn",
    content: overrides.content ?? "Hello",
    thoughts: overrides.thoughts ?? null,
    emotionalAxis: overrides.emotionalAxis ?? null,
    validatorResult: overrides.validatorResult ?? null,
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00Z"),
  };
}

const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const twoTurnMessages: ChatMessage[] = [
  makeMsg({ id: "m1", sessionId: SESSION_ID, turnIndex: 0, role: "user", content: "Hello there", createdAt: new Date("2025-06-01T10:00:00Z") }),
  makeMsg({ id: "m2", sessionId: SESSION_ID, turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "Hi! How can I help?", createdAt: new Date("2025-06-01T10:00:05Z") }),
  makeMsg({ id: "m3", sessionId: SESSION_ID, turnIndex: 2, role: "user", content: "Tell me a joke", createdAt: new Date("2025-06-01T10:01:00Z") }),
  makeMsg({ id: "m4", sessionId: SESSION_ID, turnIndex: 3, role: "assistant", route: "roleplay_turn", content: "Why did the chicken cross the road?", createdAt: new Date("2025-06-01T10:01:05Z") }),
];

const mixedMessages: ChatMessage[] = [
  makeMsg({ id: "r1", turnIndex: 0, role: "user", route: "roleplay_turn", content: "hi" }),
  makeMsg({ id: "r2", turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "hello" }),
  makeMsg({ id: "a1", turnIndex: 2, role: "user", route: "app_command", content: "export" }),
  makeMsg({ id: "a2", turnIndex: 3, role: "assistant", route: "app_command", content: "done" }),
  makeMsg({ id: "u1", turnIndex: 4, role: "user", route: "unsupported", content: "bad" }),
  makeMsg({ id: "u2", turnIndex: 5, role: "assistant", route: "unsupported", content: "sorry" }),
];

const messagesWithAppCommands: ChatMessage[] = [
  ...twoTurnMessages,
  makeMsg({ id: "m5", sessionId: SESSION_ID, turnIndex: 4, role: "user", route: "app_command", content: "export this", createdAt: new Date("2025-06-01T10:02:00Z") }),
  makeMsg({ id: "m6", sessionId: SESSION_ID, turnIndex: 5, role: "assistant", route: "app_command", content: "Your transcript has been exported.", validatorResult: { route: "app_command" }, createdAt: new Date("2025-06-01T10:02:05Z") }),
];

const messagesWithThoughts: ChatMessage[] = [
  makeMsg({ id: "t1", turnIndex: 0, role: "user", content: "hi",
    thoughts: [
      { kind: "recall", text: "remembered context", ts: 100 },
      { kind: "native", text: "The", ts: 101 },
      { kind: "native", text: " user", ts: 102 },
      { kind: "native", text: " says", ts: 103 },
    ],
  }),
];

describe("buildExportArtifact", () => {
  it("returns correct shape: kind, command, options, sorted messages, count, title", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, null);
    assert.equal(r.kind, "file_export");
    assert.equal(r.command, "export_session_raw_turns");

    const withOpts = buildExportArtifact(twoTurnMessages, opts("json", { turn_types: ["roleplay", "app_command"], include_thoughts: true }), SESSION_ID, null);
    assert.equal(withOpts.options.format, "json");
    assert.deepEqual(withOpts.options.turn_types, ["roleplay", "app_command"]);
    assert.equal(withOpts.options.include_thoughts, true);

    const sorted = buildExportArtifact([twoTurnMessages[3], twoTurnMessages[1], twoTurnMessages[0], twoTurnMessages[2]], opts("json"), SESSION_ID, null);
    const parsedSorted = JSON.parse(sorted.artifact.content);
    assert.equal(parsedSorted.messages[0].turn_index, 0);
    assert.equal(parsedSorted.messages[3].turn_index, 3);

    assert.equal(r.artifact.message_count, 4);

    const withTitle = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, "My Chat");
    assert.equal(withTitle.artifact.title, "My Chat");

    const withoutTitle = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, null);
    assert.match(withoutTitle.artifact.title, /^Session aaaaaaaa/);
  });

  it("filters messages by turn_type", () => {
    const cases: Array<{ turnTypes: Array<"roleplay" | "app_command" | "unsupported">; expectedLen: number; expectedRoutes?: string[]; note: string }> = [
      { turnTypes: ["roleplay", "unsupported"], expectedLen: 4, expectedRoutes: ["roleplay_turn", "roleplay_turn", "unsupported", "unsupported"], note: "default (roleplay+unsupported)" },
      { turnTypes: ["roleplay"], expectedLen: 2, note: "roleplay only" },
      { turnTypes: ["app_command"], expectedLen: 2, note: "app_command only" },
      { turnTypes: ["roleplay", "app_command", "unsupported"], expectedLen: 6, note: "all types" },
    ];
    for (const c of cases) {
      const r = buildExportArtifact(mixedMessages, opts("json", { turn_types: c.turnTypes }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages.length, c.expectedLen, `${c.note} — count`);
      if (c.expectedRoutes) {
        assert.deepEqual(
          parsed.messages.map((m: { route: string }) => m.route),
          c.expectedRoutes,
          `${c.note} — routes`,
        );
      }
      if (c.turnTypes.length === 1) {
        parsed.messages.forEach((m: { route: string }) => {
          const expectedRoute = c.turnTypes[0] === "roleplay" ? "roleplay_turn" : c.turnTypes[0];
          assert.equal(m.route, expectedRoute, `${c.note} — every route`);
        });
      }
    }
  });

  it("produces json format with session metadata, options, turn_type, MIME, and no thoughts by default", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("json", { turn_types: ["roleplay"] }), SESSION_ID, "Test");
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.session_id, SESSION_ID);
    assert.equal(parsed.title, "Test");
    assert.equal(parsed.message_count, 4);
    assert.deepEqual(parsed.options, { format: "json", turn_types: ["roleplay"], include_thoughts: false, include_native_thoughts: false });
    assert.ok(typeof parsed.exported_at === "string");

    parsed.messages.forEach((m: { route: string; turn_type?: string }) => {
      if (m.route === "roleplay_turn") assert.equal(m.turn_type, "roleplay");
    });

    const noThoughts = buildExportArtifact(twoTurnMessages, opts("json"), SESSION_ID, null);
    const parsedNo = JSON.parse(noThoughts.artifact.content);
    parsedNo.messages.forEach((m: { thoughts?: unknown }) => assert.equal(m.thoughts, undefined));

    assert.equal(r.artifact.mime_type, "application/json");
    assert.equal(r.artifact.format, "json");
    assert.match(r.artifact.filename, /\.json$/);
  });

  it("renders markdown format with header, turn markers, MIME, and filename", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, "Chat");
    assert.match(r.artifact.content, /^# Session Transcript: Chat/);
    assert.match(r.artifact.content, /Turn 0 — User/);
    assert.match(r.artifact.content, /Turn 3 — Assistant/);

    const r2 = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, null);
    assert.equal(r2.artifact.mime_type, "text/markdown");
    assert.equal(r2.artifact.format, "md");
    assert.match(r2.artifact.filename, /\.md$/);
  });

  it("renders txt format with header, turn markers, MIME, and filename", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, "Chat");
    assert.match(r.artifact.content, /^Session Transcript/);
    assert.match(r.artifact.content, /--- Turn 0 \| User ---/);
    assert.match(r.artifact.content, /--- Turn 3 \| Assistant ---/);

    const r2 = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, null);
    assert.equal(r2.artifact.mime_type, "text/plain");
    assert.equal(r2.artifact.format, "txt");
    assert.match(r2.artifact.filename, /\.txt$/);
  });

  it("reports byte_length matching UTF-8 content length", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, null);
    assert.equal(r.artifact.byte_length, Buffer.byteLength(r.artifact.content, "utf8"));
  });

  it("includes thoughts across JSON/MD/TXT when enabled, excludes by default, handles null/empty", () => {
    // Excluded by default (JSON)
    let r = buildExportArtifact(messagesWithThoughts, opts("json"), SESSION_ID, null);
    let parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts, undefined, "default — thoughts excluded");

    // Included when enabled (JSON) — recall + native fragments merged
    r = buildExportArtifact(messagesWithThoughts, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.ok(Array.isArray(parsed.messages[0].thoughts), "thoughts is array");
    assert.equal(parsed.messages[0].thoughts.length, 2, "2 thought rows (recall + native)");
    assert.equal(parsed.messages[0].thoughts[0].kind, "recall", "first kind = recall");
    assert.equal(parsed.messages[0].thoughts[0].text, "remembered context", "recall text");
    assert.equal(parsed.messages[0].thoughts[1].kind, "native", "second kind = native");
    assert.equal(parsed.messages[0].thoughts[1].text, "The user says", "native merged text");
    assert.equal(parsed.messages[0].thoughts[0].ts, undefined, "no timestamps");

    // Included in Markdown
    r = buildExportArtifact(messagesWithThoughts, opts("md", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    assert.match(r.artifact.content, /remembered context/, "MD — recall text present");
    assert.match(r.artifact.content, /The user says/, "MD — native text present");

    // Included in TXT
    r = buildExportArtifact(messagesWithThoughts, opts("txt", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    assert.match(r.artifact.content, /remembered context/, "TXT — recall text present");
    assert.match(r.artifact.content, /The user says/, "TXT — native text present");

    // Null thoughts gracefully handled
    r = buildExportArtifact(twoTurnMessages, opts("json", { include_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts.length, 0, "null thoughts → empty array");

    // Empty thoughts handled
    const empty = [makeMsg({ id: "e1", turnIndex: 0, role: "user", content: "hi", thoughts: [] })];
    r = buildExportArtifact(empty, opts("json", { include_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts.length, 0, "empty thoughts → empty array");
  });

  it("joins thought fragments with locale-aware spacing (ASCII/CJK/mixed)", () => {
    const ascii: ChatMessage[] = [makeMsg({ id: "a1", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "native", text: "I", ts: 1 }, { kind: "native", text: " think", ts: 2 }, { kind: "native", text: " so", ts: 3 }] })];
    let r = buildExportArtifact(ascii, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    let parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts[0].text, "I think so", "ASCII fragments joined with spaces");

    const cjk: ChatMessage[] = [makeMsg({ id: "c1", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "native", text: "我", ts: 1 }, { kind: "native", text: "觉得", ts: 2 }, { kind: "native", text: "可以", ts: 3 }] })];
    r = buildExportArtifact(cjk, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts[0].text, "我觉得可以", "CJK fragments joined without extra spaces");

    const mixed: ChatMessage[] = [makeMsg({ id: "x1", turnIndex: 0, role: "user", content: "test",
      thoughts: [{ kind: "native", text: "OK", ts: 1 }, { kind: "native", text: " 好的", ts: 2 }] })];
    r = buildExportArtifact(mixed, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts[0].text, "OK 好的", "mixed ASCII-CJK boundary correct");
  });

  it("excludes non-exportable / unknown / kind-less thought rows (JSON, MD, TXT)", () => {
    // Unknown thought kinds excluded (JSON)
    const unknown: ChatMessage[] = [makeMsg({ id: "u1", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "native", text: "visible", ts: 1 }, { kind: "internal_meta", text: "hidden", ts: 2 }, { kind: "debug_only", text: "also hidden", ts: 3 }, { kind: "recall", text: "also visible", ts: 4 }] })];
    let r = buildExportArtifact(unknown, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    let parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts.length, 2, "unknown kinds filtered out");
    assert.equal(parsed.messages[0].thoughts[0].kind, "native", "native kept");
    assert.equal(parsed.messages[0].thoughts[1].kind, "recall", "recall kept");

    // No string kind excluded (JSON)
    const noKind: ChatMessage[] = [makeMsg({ id: "nk1", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "native", text: "visible", ts: 1 }, { text: "no kind here", ts: 2 }, { kind: "recall", text: "also visible", ts: 3 }] })];
    r = buildExportArtifact(noKind, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts.length, 2, "kind-less row filtered out");
    assert.equal(parsed.messages[0].thoughts[0].kind, "native", "native kept");
    assert.equal(parsed.messages[0].thoughts[1].kind, "recall", "recall kept");

    // Non-exportable kinds excluded in MD
    const mixedKinds: ChatMessage[] = [makeMsg({ id: "u2", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "tool_decision", text: "decided to search", ts: 1 }, { kind: "internal_state", text: "should not appear", ts: 2 }, { kind: "rewrite", text: "rewritten content", ts: 3 }] })];
    r = buildExportArtifact(mixedKinds, opts("md", { include_thoughts: true }), SESSION_ID, null);
    assert.match(r.artifact.content, /decided to search/, "MD — tool_decision kept");
    assert.match(r.artifact.content, /rewritten content/, "MD — rewrite kept");
    assert.doesNotMatch(r.artifact.content, /should not appear/, "MD — internal_state excluded");

    // Non-exportable kinds excluded in TXT
    const txtKinds: ChatMessage[] = [makeMsg({ id: "u3", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "native", text: "keep me", ts: 1 }, { kind: "debug_ts", text: "drop me", ts: 2 }, { kind: "deflect", text: "keep me too", ts: 3 }] })];
    r = buildExportArtifact(txtKinds, opts("txt", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    assert.match(r.artifact.content, /keep me/, "TXT — native kept");
    assert.match(r.artifact.content, /keep me too/, "TXT — deflect kept");
    assert.doesNotMatch(r.artifact.content, /drop me/, "TXT — debug_ts excluded");
  });

  it("gates native thoughts on include_native_thoughts flag", () => {
    // False: native thoughts excluded
    const excluded: ChatMessage[] = [makeMsg({ id: "g1", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "native", text: "should be excluded", ts: 1 }, { kind: "recall", text: "should be included", ts: 2 }, { kind: "tool_decision", text: "also included", ts: 3 }] })];
    let r = buildExportArtifact(excluded, opts("json", { include_thoughts: true, include_native_thoughts: false }), SESSION_ID, null);
    let parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts.length, 2, "native excluded — 2 remaining");
    assert.equal(parsed.messages[0].thoughts[0].kind, "recall", "recall kept");
    assert.equal(parsed.messages[0].thoughts[1].kind, "tool_decision", "tool_decision kept");

    // True: native thoughts included
    const included: ChatMessage[] = [makeMsg({ id: "g2", turnIndex: 0, role: "user", content: "hi",
      thoughts: [{ kind: "recall", text: "context", ts: 1 }, { kind: "native", text: "native text", ts: 2 }, { kind: "deflect", text: "deflected", ts: 3 }] })];
    r = buildExportArtifact(included, opts("json", { include_thoughts: true, include_native_thoughts: true }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].thoughts.length, 3, "native included — 3 kept");
    assert.equal(parsed.messages[0].thoughts[0].kind, "recall", "recall first");
    assert.equal(parsed.messages[0].thoughts[1].kind, "native", "native");
    assert.equal(parsed.messages[0].thoughts[2].kind, "deflect", "deflect");
  });

  it("includes/excludes app_command messages based on turn_types", () => {
    let r = buildExportArtifact(messagesWithAppCommands, opts("json"), SESSION_ID, null);
    let parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.message_count, 4);
    for (const msg of parsed.messages) {
      assert.notEqual(msg.route, "app_command");
    }

    r = buildExportArtifact(messagesWithAppCommands, opts("json", { turn_types: ["roleplay", "app_command", "unsupported"] }), SESSION_ID, null);
    parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.message_count, 6);
    const appMsgs = parsed.messages.filter((m: { route: string }) => m.route === "app_command");
    assert.equal(appMsgs.length, 2);
  });

  // ---------------------------------------------------------------------------
  // TG1: Emotional-axis snapshot export
  // ---------------------------------------------------------------------------

  const validAxisSnapshot: EmotionalAxisTurnExportSnapshot = {
    version: 1,
    source: "post_turn_engine",
    tick: 3,
    scope: "main_married",
    axes: { connection: 0.23, valence: 0.10, arousal: -0.12, restraint: 0.68 },
    bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
    axes_before: { connection: 0.0, valence: 0.0, arousal: 0.0, restraint: 0.5 },
    event_type: "user_shows_warmth",
    event_intensity: 0.6,
    event_deltas: { connection: 0.23, valence: 0.10 },
  };

  const messagesWithAxisSnapshot: ChatMessage[] = [
    makeMsg({ id: "a1", turnIndex: 0, role: "user", content: "hello" }),
    makeMsg({ id: "a2", turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "Hi there!", emotionalAxis: validAxisSnapshot }),
    makeMsg({ id: "a3", turnIndex: 2, role: "user", content: "I appreciate you" }),
    makeMsg({ id: "a4", turnIndex: 3, role: "assistant", route: "roleplay_turn", content: "Of course!", emotionalAxis: {
      version: 1,
      source: "post_turn_engine",
      tick: 4,
      scope: "main_married",
      axes: { connection: 0.45, valence: 0.30, arousal: 0.10, restraint: 0.50 },
      bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
    } }),
  ];

  it("JSON export includes emotional_axis on messages with a valid snapshot", () => {
    const r = buildExportArtifact(messagesWithAxisSnapshot, opts("json"), SESSION_ID, "Axis Test");
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.message_count, 4);

    // User message — no emotional_axis
    assert.equal(parsed.messages[0].emotional_axis, undefined, "user message has no emotional_axis");

    // Assistant message with snapshot (tick 3)
    const em1 = parsed.messages[1].emotional_axis;
    assert.ok(em1, "assistant message has emotional_axis");
    assert.equal(em1.version, 1);
    assert.equal(em1.tick, 3);
    assert.equal(em1.scope, "main_married");
    assert.deepEqual(em1.axes, { connection: 0.23, valence: 0.10, arousal: -0.12, restraint: 0.68 });
    assert.deepEqual(em1.bands, { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" });
    assert.deepEqual(em1.axes_before, { connection: 0.0, valence: 0.0, arousal: 0.0, restraint: 0.5 });
    assert.equal(em1.event_type, "user_shows_warmth");
    assert.equal(em1.event_intensity, 0.6);
    assert.deepEqual(em1.event_deltas, { connection: 0.23, valence: 0.10 });
    assert.equal(em1.source, "post_turn_engine");

    // Second assistant message with snapshot (tick 4, minimal fields)
    const em2 = parsed.messages[3].emotional_axis;
    assert.ok(em2, "second assistant message has emotional_axis");
    assert.equal(em2.tick, 4);
    assert.equal(em2.axes.connection, 0.45);
    assert.equal(em2.bands.connection, "mid");
    // Optional fields not present
    assert.equal(em2.axes_before, undefined);
    assert.equal(em2.event_type, undefined);
  });

  it("TXT export includes [Emotional Axis] block for messages with a valid snapshot", () => {
    const r = buildExportArtifact(messagesWithAxisSnapshot, opts("txt"), SESSION_ID, "Axis Test");
    const content = r.artifact.content;

    // Header present
    assert.match(content, /Session Transcript/);

    // First assistant message (tick 3) — full emotional axis block
    assert.match(content, /\[Emotional Axis\]/);
    assert.match(content, /tick: 3/);
    assert.match(content, /scope: main_married/);
    assert.match(content, /connection: 0.23 \(mid\)/);
    assert.match(content, /valence: 0.1 \(mid\)/);
    assert.match(content, /restraint: 0.68 \(high\)/);

    // Second assistant message (tick 4)
    assert.match(content, /tick: 4/);
    assert.match(content, /connection: 0.45 \(mid\)/);

    // User message — no axis block between user turn markers
    const userSection = content.split(/--- Turn 0 \| User ---/)[1]?.split(/--- Turn 1 \| Assistant ---/)[0] ?? "";
    assert.doesNotMatch(userSection, /\[Emotional Axis\]/, "user message has no axis block");
  });

  it("JSON export omits emotional_axis when snapshot is null", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(r.artifact.content);
    for (const msg of parsed.messages) {
      assert.equal(msg.emotional_axis, undefined, "messages without snapshot have no emotional_axis field");
    }
  });

  it("TXT export omits [Emotional Axis] block when snapshot is null", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, null);
    assert.doesNotMatch(r.artifact.content, /\[Emotional Axis\]/, "no axis block for null snapshots");
  });

  it("JSON export ignores malformed emotional_axis snapshots", () => {
    const malformedMessages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "bad", emotionalAxis: { version: 999, source: "unknown" } }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "not object", emotionalAxis: "string instead of object" }),
      makeMsg({ id: "m3", turnIndex: 2, role: "assistant", route: "roleplay_turn", content: "missing axes", emotionalAxis: { version: 1, source: "post_turn_engine", tick: 1, scope: "test" } }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", route: "roleplay_turn", content: "null", emotionalAxis: null }),
    ];
    const r = buildExportArtifact(malformedMessages, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.message_count, 4);
    for (const msg of parsed.messages) {
      assert.equal(msg.emotional_axis, undefined, `malformed message ${msg.id} has no emotional_axis field`);
    }
  });

  it("TXT export ignores malformed emotional_axis snapshots", () => {
    const malformedMessages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "bad", emotionalAxis: { version: 999, source: "unknown" } }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "not object", emotionalAxis: "string instead of object" }),
      makeMsg({ id: "m3", turnIndex: 2, role: "assistant", route: "roleplay_turn", content: "missing axes", emotionalAxis: { version: 1, source: "post_turn_engine", tick: 1, scope: "test" } }),
    ];
    const r = buildExportArtifact(malformedMessages, opts("txt"), SESSION_ID, null);
    assert.doesNotMatch(r.artifact.content, /\[Emotional Axis\]/, "no axis block for malformed snapshots");
  });

  // ---------------------------------------------------------------------------
  // F2: Partial axes / invalid bands — must be rejected, not coerced
  // ---------------------------------------------------------------------------

  it("F2: JSON export rejects snapshot with partial axes (missing valence)", () => {
    const partialAxes: ChatMessage[] = [
      makeMsg({ id: "f2a", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "partial",
        emotionalAxis: {
          version: 1, source: "post_turn_engine", tick: 1, scope: "main",
          axes: { connection: 0.2 },
          bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" },
        },
      }),
    ];
    const r = buildExportArtifact(partialAxes, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].emotional_axis, undefined, "partial axes rejected");
  });

  it("F2: JSON export rejects snapshot with non-finite axis value", () => {
    const nanAxes: ChatMessage[] = [
      makeMsg({ id: "f2b", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "nan",
        emotionalAxis: {
          version: 1, source: "post_turn_engine", tick: 1, scope: "main",
          axes: { connection: Infinity, valence: 0, arousal: 0, restraint: 0 },
          bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" },
        },
      }),
    ];
    const r = buildExportArtifact(nanAxes, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].emotional_axis, undefined, "non-finite axis rejected");
  });

  it("F2: JSON export rejects snapshot with invalid band label", () => {
    const invalidBand: ChatMessage[] = [
      makeMsg({ id: "f2c", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "bad band",
        emotionalAxis: {
          version: 1, source: "post_turn_engine", tick: 1, scope: "main",
          axes: { connection: 0.2, valence: 0, arousal: 0, restraint: 0 },
          bands: { connection: "nonsense", valence: "mid", arousal: "mid", restraint: "mid" },
        },
      }),
    ];
    const r = buildExportArtifact(invalidBand, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].emotional_axis, undefined, "invalid band label rejected");
  });

  it("F2: JSON export rejects snapshot with missing bands entirely", () => {
    const missingBands: ChatMessage[] = [
      makeMsg({ id: "f2d", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "no bands",
        emotionalAxis: {
          version: 1, source: "post_turn_engine", tick: 1, scope: "main",
          axes: { connection: 0.2, valence: 0, arousal: 0, restraint: 0 },
        },
      }),
    ];
    const r = buildExportArtifact(missingBands, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(r.artifact.content);
    assert.equal(parsed.messages[0].emotional_axis, undefined, "missing bands rejected");
  });

  it("F2: TXT export also rejects partial axes and invalid bands", () => {
    const badMessages: ChatMessage[] = [
      makeMsg({ id: "f2e", turnIndex: 0, role: "assistant", route: "roleplay_turn", content: "partial",
        emotionalAxis: {
          version: 1, source: "post_turn_engine", tick: 1, scope: "main",
          axes: { connection: 0.2 },
          bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" },
        },
      }),
      makeMsg({ id: "f2f", turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "bad band",
        emotionalAxis: {
          version: 1, source: "post_turn_engine", tick: 2, scope: "main",
          axes: { connection: 0.2, valence: 0, arousal: 0, restraint: 0 },
          bands: { connection: "nonsense", valence: "mid", arousal: "mid", restraint: "mid" },
        },
      }),
    ];
    const r = buildExportArtifact(badMessages, opts("txt"), SESSION_ID, null);
    assert.doesNotMatch(r.artifact.content, /\[Emotional Axis\]/, "no axis block for partial/invalid data");
  });
});
