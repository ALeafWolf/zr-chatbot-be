import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExportArtifact } from "./exportSessionRawTurns";
import type { ChatMessage } from "../../db/schema/chat";
import type { ExportOptions } from "./appCommandTypes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default options helper — keeps the test call sites concise. */
function opts(
  format: ExportOptions["format"],
  overrides?: Partial<ExportOptions>,
): ExportOptions {
  return {
    format,
    turn_types: ["roleplay", "unsupported"],
    include_thoughts: false,
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
    validatorResult: overrides.validatorResult ?? null,
    createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00Z"),
  };
}

const SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const twoTurnMessages: ChatMessage[] = [
  makeMsg({
    id: "m1", sessionId: SESSION_ID, turnIndex: 0, role: "user",
    content: "Hello there", createdAt: new Date("2025-06-01T10:00:00Z"),
  }),
  makeMsg({
    id: "m2", sessionId: SESSION_ID, turnIndex: 1, role: "assistant",
    route: "roleplay_turn", content: "Hi! How can I help?",
    createdAt: new Date("2025-06-01T10:00:05Z"),
  }),
  makeMsg({
    id: "m3", sessionId: SESSION_ID, turnIndex: 2, role: "user",
    content: "Tell me a joke", createdAt: new Date("2025-06-01T10:01:00Z"),
  }),
  makeMsg({
    id: "m4", sessionId: SESSION_ID, turnIndex: 3, role: "assistant",
    route: "roleplay_turn", content: "Why did the chicken cross the road?",
    createdAt: new Date("2025-06-01T10:01:05Z"),
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("buildExportArtifact", () => {
  // ---- general shape ----
  it("returns a file_export result with correct kind and command", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, null);
    assert.equal(r.kind, "file_export");
    assert.equal(r.command, "export_session_raw_turns");
  });

  it("includes options in the result", () => {
    const r = buildExportArtifact(
      twoTurnMessages,
      opts("json", { turn_types: ["roleplay", "app_command"], include_thoughts: true }),
      SESSION_ID, null,
    );
    assert.equal(r.options.format, "json");
    assert.deepEqual(r.options.turn_types, ["roleplay", "app_command"]);
    assert.equal(r.options.include_thoughts, true);
  });

  it("sorts messages by turn_index ascending", () => {
    const unsorted = [twoTurnMessages[3], twoTurnMessages[1], twoTurnMessages[0], twoTurnMessages[2]];
    const result = buildExportArtifact(unsorted, opts("json"), SESSION_ID, null);
    const parsed = JSON.parse(result.artifact.content);
    assert.equal(parsed.messages[0].turn_index, 0);
    assert.equal(parsed.messages[3].turn_index, 3);
  });

  it("reports correct message_count", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, null);
    assert.equal(r.artifact.message_count, 4);
  });

  it("uses displayTitle when provided", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, "My Chat");
    assert.equal(r.artifact.title, "My Chat");
  });

  it("falls back to session-based title when displayTitle is null", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, null);
    assert.match(r.artifact.title, /^Session aaaaaaaa/);
  });

  // ---- turn type filtering ----
  describe("turn type filtering", () => {
    const mixedMessages: ChatMessage[] = [
      makeMsg({ id: "r1", turnIndex: 0, role: "user", route: "roleplay_turn", content: "hi" }),
      makeMsg({ id: "r2", turnIndex: 1, role: "assistant", route: "roleplay_turn", content: "hello" }),
      makeMsg({ id: "a1", turnIndex: 2, role: "user", route: "app_command", content: "export" }),
      makeMsg({ id: "a2", turnIndex: 3, role: "assistant", route: "app_command", content: "done" }),
      makeMsg({ id: "u1", turnIndex: 4, role: "user", route: "unsupported", content: "bad" }),
      makeMsg({ id: "u2", turnIndex: 5, role: "assistant", route: "unsupported", content: "sorry" }),
    ];

    it("defaults to roleplay + unsupported", () => {
      const r = buildExportArtifact(mixedMessages, opts("json"), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      const routes = parsed.messages.map((m: { route: string }) => m.route);
      assert.deepEqual(routes, ["roleplay_turn", "roleplay_turn", "unsupported", "unsupported"]);
    });

    it("filters to roleplay only", () => {
      const r = buildExportArtifact(
        mixedMessages, opts("json", { turn_types: ["roleplay"] }), SESSION_ID, null,
      );
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages.length, 2);
      parsed.messages.forEach((m: { route: string }) => assert.equal(m.route, "roleplay_turn"));
    });

    it("filters to app_command only", () => {
      const r = buildExportArtifact(
        mixedMessages, opts("json", { turn_types: ["app_command"] }), SESSION_ID, null,
      );
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages.length, 2);
      parsed.messages.forEach((m: { route: string }) => assert.equal(m.route, "app_command"));
    });

    it("includes all types", () => {
      const r = buildExportArtifact(
        mixedMessages, opts("json", { turn_types: ["roleplay", "app_command", "unsupported"] }),
        SESSION_ID, null,
      );
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages.length, 6);
    });
  });

  // ---- JSON format ----
  describe("json format", () => {
    it("produces valid JSON with session metadata and options", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("json", { turn_types: ["roleplay"] }), SESSION_ID, "Test");
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.session_id, SESSION_ID);
      assert.equal(parsed.title, "Test");
      assert.equal(parsed.message_count, 4);
      assert.deepEqual(parsed.options, { format: "json", turn_types: ["roleplay"], include_thoughts: false });
      assert.ok(typeof parsed.exported_at === "string");
    });

    it("includes turn_type field per message", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("json"), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      parsed.messages.forEach((m: { turn_type: string; route: string }) => {
        if (m.route === "roleplay_turn") assert.equal(m.turn_type, "roleplay");
      });
    });

    it("sets correct MIME type and filename", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("json"), SESSION_ID, null);
      assert.equal(r.artifact.mime_type, "application/json");
      assert.equal(r.artifact.format, "json");
      assert.match(r.artifact.filename, /\.json$/);
    });

    it("omits thoughts by default", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("json"), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      parsed.messages.forEach((m: { thoughts?: unknown }) => assert.equal(m.thoughts, undefined));
    });
  });

  // ---- Markdown format ----
  describe("markdown format", () => {
    it("renders a header and message sections", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, "Chat");
      assert.match(r.artifact.content, /^# Session Transcript: Chat/);
      assert.match(r.artifact.content, /Turn 0 — User/);
      assert.match(r.artifact.content, /Turn 3 — Assistant/);
    });

    it("sets correct MIME type and filename", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("md"), SESSION_ID, null);
      assert.equal(r.artifact.mime_type, "text/markdown");
      assert.equal(r.artifact.format, "md");
      assert.match(r.artifact.filename, /\.md$/);
    });
  });

  // ---- Text format ----
  describe("txt format", () => {
    it("includes header metadata and turn markers", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, "Chat");
      assert.match(r.artifact.content, /^Session Transcript/);
      assert.match(r.artifact.content, /--- Turn 0 \| User ---/);
      assert.match(r.artifact.content, /--- Turn 3 \| Assistant ---/);
    });

    it("sets correct MIME type and filename", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, null);
      assert.equal(r.artifact.mime_type, "text/plain");
      assert.equal(r.artifact.format, "txt");
      assert.match(r.artifact.filename, /\.txt$/);
    });
  });

  // ---- byte_length ----
  it("reports byte_length matching content length in UTF-8", () => {
    const r = buildExportArtifact(twoTurnMessages, opts("txt"), SESSION_ID, null);
    const expectedBytes = Buffer.byteLength(r.artifact.content, "utf8");
    assert.equal(r.artifact.byte_length, expectedBytes);
  });

  // ---- thought normalization ----
  describe("thought normalization", () => {
    const messagesWithThoughts: ChatMessage[] = [
      makeMsg({
        id: "t1", turnIndex: 0, role: "user", content: "hi",
        thoughts: [
          { kind: "recall", text: "remembered context", ts: 100 },
          { kind: "native", text: "The", ts: 101 },
          { kind: "native", text: " user", ts: 102 },
          { kind: "native", text: " says", ts: 103 },
        ],
      }),
    ];

    it("excludes thoughts by default", () => {
      const r = buildExportArtifact(messagesWithThoughts, opts("json"), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts, undefined);
    });

    it("includes normalized thoughts when include_thoughts is true (JSON)", () => {
      const r = buildExportArtifact(
        messagesWithThoughts, opts("json", { include_thoughts: true }), SESSION_ID, null,
      );
      const parsed = JSON.parse(r.artifact.content);
      const thoughts = parsed.messages[0].thoughts;
      assert.ok(Array.isArray(thoughts));
      assert.equal(thoughts.length, 2);
      // recall kind appears first, native fragments merged
      assert.equal(thoughts[0].kind, "recall");
      assert.equal(thoughts[0].text, "remembered context");
      assert.equal(thoughts[1].kind, "native");
      assert.equal(thoughts[1].text, "The user says");
      // no timestamps in exported thoughts
      assert.equal(thoughts[0].ts, undefined);
    });

    it("includes thoughts in Markdown when include_thoughts is true", () => {
      const r = buildExportArtifact(
        messagesWithThoughts, opts("md", { include_thoughts: true }), SESSION_ID, null,
      );
      assert.match(r.artifact.content, /remembered context/);
      assert.match(r.artifact.content, /The user says/);
    });

    it("includes thoughts in text when include_thoughts is true", () => {
      const r = buildExportArtifact(
        messagesWithThoughts, opts("txt", { include_thoughts: true }), SESSION_ID, null,
      );
      assert.match(r.artifact.content, /remembered context/);
      assert.match(r.artifact.content, /The user says/);
    });

    it("handles null thoughts gracefully", () => {
      const r = buildExportArtifact(twoTurnMessages, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts.length, 0);
    });

    it("handles empty thought arrays gracefully", () => {
      const empty = [makeMsg({ id: "e1", turnIndex: 0, role: "user", content: "hi", thoughts: [] })];
      const r = buildExportArtifact(empty, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts.length, 0);
    });

    it("inserts spaces between ASCII fragments", () => {
      const ascii: ChatMessage[] = [
        makeMsg({
          id: "a1", turnIndex: 0, role: "user", content: "hi",
          thoughts: [
            { kind: "native", text: "I", ts: 1 },
            { kind: "native", text: " think", ts: 2 },
            { kind: "native", text: " so", ts: 3 },
          ],
        }),
      ];
      const r = buildExportArtifact(ascii, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts[0].text, "I think so");
    });

    it("does not add extra space between CJK fragments", () => {
      const cjk: ChatMessage[] = [
        makeMsg({
          id: "c1", turnIndex: 0, role: "user", content: "hi",
          thoughts: [
            { kind: "native", text: "我", ts: 1 },
            { kind: "native", text: "觉得", ts: 2 },
            { kind: "native", text: "可以", ts: 3 },
          ],
        }),
      ];
      const r = buildExportArtifact(cjk, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts[0].text, "我觉得可以");
    });

    it("joins mixed ASCII-CJK boundary correctly", () => {
      const mixed: ChatMessage[] = [
        makeMsg({
          id: "x1", turnIndex: 0, role: "user", content: "test",
          thoughts: [
            { kind: "native", text: "OK", ts: 1 },
            { kind: "native", text: " 好的", ts: 2 },
          ],
        }),
      ];
      const r = buildExportArtifact(mixed, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts[0].text, "OK 好的");
    });

    it("excludes unknown thought kinds from export", () => {
      const unknown: ChatMessage[] = [
        makeMsg({
          id: "u1", turnIndex: 0, role: "user", content: "hi",
          thoughts: [
            { kind: "native", text: "visible", ts: 1 },
            { kind: "internal_meta", text: "hidden", ts: 2 },
            { kind: "debug_only", text: "also hidden", ts: 3 },
            { kind: "recall", text: "also visible", ts: 4 },
          ],
        }),
      ];
      const r = buildExportArtifact(unknown, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts.length, 2);
      assert.equal(parsed.messages[0].thoughts[0].kind, "native");
      assert.equal(parsed.messages[0].thoughts[1].kind, "recall");
    });

    it("excludes a thought row with no string kind from JSON export", () => {
      const noKind: ChatMessage[] = [
        makeMsg({
          id: "nk1", turnIndex: 0, role: "user", content: "hi",
          thoughts: [
            { kind: "native", text: "visible", ts: 1 },
            { text: "no kind here", ts: 2 },
            { kind: "recall", text: "also visible", ts: 3 },
          ],
        }),
      ];
      const r = buildExportArtifact(noKind, opts("json", { include_thoughts: true }), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.messages[0].thoughts.length, 2);
      assert.equal(parsed.messages[0].thoughts[0].kind, "native");
      assert.equal(parsed.messages[0].thoughts[1].kind, "recall");
    });

    it("excludes non-exportable kinds and keeps only supported kinds in MD export", () => {
      const mixed: ChatMessage[] = [
        makeMsg({
          id: "u2", turnIndex: 0, role: "user", content: "hi",
          thoughts: [
            { kind: "tool_decision", text: "decided to search", ts: 1 },
            { kind: "internal_state", text: "should not appear", ts: 2 },
            { kind: "rewrite", text: "rewritten content", ts: 3 },
          ],
        }),
      ];
      const r = buildExportArtifact(mixed, opts("md", { include_thoughts: true }), SESSION_ID, null);
      assert.match(r.artifact.content, /decided to search/);
      assert.match(r.artifact.content, /rewritten content/);
      assert.doesNotMatch(r.artifact.content, /should not appear/);
    });

    it("excludes non-exportable kinds from TXT export", () => {
      const mixed: ChatMessage[] = [
        makeMsg({
          id: "u3", turnIndex: 0, role: "user", content: "hi",
          thoughts: [
            { kind: "native", text: "keep me", ts: 1 },
            { kind: "debug_ts", text: "drop me", ts: 2 },
            { kind: "deflect", text: "keep me too", ts: 3 },
          ],
        }),
      ];
      const r = buildExportArtifact(mixed, opts("txt", { include_thoughts: true }), SESSION_ID, null);
      assert.match(r.artifact.content, /keep me/);
      assert.match(r.artifact.content, /keep me too/);
      assert.doesNotMatch(r.artifact.content, /drop me/);
    });
  });

  // ---- app_command filtering (executor-level default behavior) ----
  describe("when messages include prior app_command rows", () => {
    const messagesWithAppCommands: ChatMessage[] = [
      ...twoTurnMessages,
      makeMsg({
        id: "m5", sessionId: SESSION_ID, turnIndex: 4, role: "user",
        route: "app_command",
        content: "export this", createdAt: new Date("2025-06-01T10:02:00Z"),
      }),
      makeMsg({
        id: "m6", sessionId: SESSION_ID, turnIndex: 5, role: "assistant",
        route: "app_command", content: "Your transcript has been exported.",
        validatorResult: { route: "app_command" },
        createdAt: new Date("2025-06-01T10:02:05Z"),
      }),
    ];

    it("excludes app_command via turn_types default", () => {
      const r = buildExportArtifact(messagesWithAppCommands, opts("json"), SESSION_ID, null);
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.message_count, 4);
      for (const msg of parsed.messages) {
        assert.notEqual(msg.route, "app_command");
      }
    });

    it("includes app_command when turn_types includes it", () => {
      const r = buildExportArtifact(
        messagesWithAppCommands,
        opts("json", { turn_types: ["roleplay", "app_command", "unsupported"] }),
        SESSION_ID, null,
      );
      const parsed = JSON.parse(r.artifact.content);
      assert.equal(parsed.message_count, 6);
      const appMsgs = parsed.messages.filter((m: { route: string }) => m.route === "app_command");
      assert.equal(appMsgs.length, 2);
    });
  });
});
