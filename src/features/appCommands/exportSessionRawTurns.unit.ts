import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExportArtifact } from "./exportSessionRawTurns";
import type { ChatMessage } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeMsg(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
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
    id: "m1",
    sessionId: SESSION_ID,
    turnIndex: 0,
    role: "user",
    content: "Hello there",
    createdAt: new Date("2025-06-01T10:00:00Z"),
  }),
  makeMsg({
    id: "m2",
    sessionId: SESSION_ID,
    turnIndex: 1,
    role: "assistant",
    route: "roleplay_turn",
    content: "Hi! How can I help?",
    createdAt: new Date("2025-06-01T10:00:05Z"),
  }),
  makeMsg({
    id: "m3",
    sessionId: SESSION_ID,
    turnIndex: 2,
    role: "user",
    content: "Tell me a joke",
    createdAt: new Date("2025-06-01T10:01:00Z"),
  }),
  makeMsg({
    id: "m4",
    sessionId: SESSION_ID,
    turnIndex: 3,
    role: "assistant",
    route: "roleplay_turn",
    content: "Why did the chicken cross the road?",
    createdAt: new Date("2025-06-01T10:01:05Z"),
  }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("buildExportArtifact", () => {
  // ---- general shape ----
  it("returns a file_export result with correct kind and command", () => {
    const result = buildExportArtifact(twoTurnMessages, "md", SESSION_ID, null);
    assert.equal(result.kind, "file_export");
    assert.equal(result.command, "export_session_raw_turns");
  });

  it("sorts messages by turn_index ascending", () => {
    const unsorted = [
      twoTurnMessages[3],
      twoTurnMessages[1],
      twoTurnMessages[0],
      twoTurnMessages[2],
    ];
    const result = buildExportArtifact(unsorted, "json", SESSION_ID, null);
    const parsed = JSON.parse(result.artifact.content);
    assert.equal(parsed.messages[0].turn_index, 0);
    assert.equal(parsed.messages[1].turn_index, 1);
    assert.equal(parsed.messages[2].turn_index, 2);
    assert.equal(parsed.messages[3].turn_index, 3);
  });

  it("reports correct message_count", () => {
    const result = buildExportArtifact(twoTurnMessages, "txt", SESSION_ID, null);
    assert.equal(result.artifact.message_count, 4);
  });

  it("uses displayTitle when provided", () => {
    const result = buildExportArtifact(
      twoTurnMessages,
      "md",
      SESSION_ID,
      "My Chat",
    );
    assert.equal(result.artifact.title, "My Chat");
  });

  it("falls back to session-based title when displayTitle is null", () => {
    const result = buildExportArtifact(
      twoTurnMessages,
      "md",
      SESSION_ID,
      null,
    );
    assert.match(result.artifact.title, /^Session aaaaaaaa/);
  });

  // ---- JSON format ----
  describe("json format", () => {
    it("produces valid JSON with session metadata", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "json",
        SESSION_ID,
        "Test Session",
      );
      const parsed = JSON.parse(result.artifact.content);
      assert.equal(parsed.session_id, SESSION_ID);
      assert.equal(parsed.title, "Test Session");
      assert.equal(parsed.message_count, 4);
      assert.ok(typeof parsed.exported_at === "string");
    });

    it("includes all message fields", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "json",
        SESSION_ID,
        null,
      );
      const parsed = JSON.parse(result.artifact.content);
      assert.equal(parsed.messages.length, 4);
      const first = parsed.messages[0];
      assert.ok(first.id);
      assert.ok(first.role);
      assert.ok(first.route);
      assert.equal(typeof first.turn_index, "number");
      assert.ok(first.created_at);
      assert.ok(first.content);
      assert.ok(Array.isArray(first.thoughts));
    });

    it("sets correct MIME type", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "json",
        SESSION_ID,
        null,
      );
      assert.equal(result.artifact.mime_type, "application/json");
      assert.equal(result.artifact.format, "json");
    });

    it("sets correct filename", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "json",
        SESSION_ID,
        null,
      );
      assert.match(result.artifact.filename, /\.json$/);
      assert.match(result.artifact.filename, /session-aaaaaaaa/);
    });
  });

  // ---- Markdown format ----
  describe("markdown format", () => {
    it("renders a header with the title", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "md",
        SESSION_ID,
        "Chat",
      );
      assert.match(result.artifact.content, /^# Session Transcript: Chat/);
    });

    it("renders each message as a turn section", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "md",
        SESSION_ID,
        null,
      );
      assert.match(result.artifact.content, /Turn 0 — User/);
      assert.match(result.artifact.content, /Turn 1 — Assistant/);
      assert.match(result.artifact.content, /Turn 2 — User/);
      assert.match(result.artifact.content, /Turn 3 — Assistant/);
    });

    it("includes message content", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "md",
        SESSION_ID,
        null,
      );
      assert.match(result.artifact.content, /Hello there/);
      assert.match(result.artifact.content, /Why did the chicken/);
    });

    it("sets correct MIME type and filename", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "md",
        SESSION_ID,
        null,
      );
      assert.equal(result.artifact.mime_type, "text/markdown");
      assert.equal(result.artifact.format, "md");
      assert.match(result.artifact.filename, /\.md$/);
    });
  });

  // ---- Text format ----
  describe("txt format", () => {
    it("includes header metadata", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "txt",
        SESSION_ID,
        "Chat",
      );
      assert.match(result.artifact.content, /^Session Transcript/);
      assert.match(result.artifact.content, /Title: Chat/);
      assert.match(result.artifact.content, /Messages: 4/);
    });

    it("renders each message with turn markers", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "txt",
        SESSION_ID,
        null,
      );
      assert.match(result.artifact.content, /--- Turn 0 \| User ---/);
      assert.match(result.artifact.content, /--- Turn 3 \| Assistant ---/);
    });

    it("sets correct MIME type and filename", () => {
      const result = buildExportArtifact(
        twoTurnMessages,
        "txt",
        SESSION_ID,
        null,
      );
      assert.equal(result.artifact.mime_type, "text/plain");
      assert.equal(result.artifact.format, "txt");
      assert.match(result.artifact.filename, /\.txt$/);
    });
  });

  // ---- byte_length ----
  it("reports byte_length matching content length in UTF-8", () => {
    const result = buildExportArtifact(
      twoTurnMessages,
      "txt",
      SESSION_ID,
      null,
    );
    const expectedBytes = Buffer.byteLength(result.artifact.content, "utf8");
    assert.equal(result.artifact.byte_length, expectedBytes);
  });

  // ---- app_command filtering (executor-level default behavior) ----
  describe("when messages include prior app_command rows", () => {
    const messagesWithAppCommands: ChatMessage[] = [
      ...twoTurnMessages,
      makeMsg({
        id: "m5",
        sessionId: SESSION_ID,
        turnIndex: 4,
        role: "user",
        content: "export this",
        createdAt: new Date("2025-06-01T10:02:00Z"),
      }),
      makeMsg({
        id: "m6",
        sessionId: SESSION_ID,
        turnIndex: 5,
        role: "assistant",
        route: "app_command",
        content: "Your transcript has been exported.",
        validatorResult: { route: "app_command" },
        createdAt: new Date("2025-06-01T10:02:05Z"),
      }),
    ];

    it("excludes app_command messages when filtered before calling buildExportArtifact", () => {
      const filtered = messagesWithAppCommands.filter(
        (m) => m.route !== "app_command",
      );
      const result = buildExportArtifact(filtered, "json", SESSION_ID, null);
      const parsed = JSON.parse(result.artifact.content);

      // 4 roleplay + 1 user export request = 5; the assistant app_command row is excluded
      assert.equal(parsed.message_count, 5);
      for (const msg of parsed.messages) {
        assert.notEqual(msg.route, "app_command");
      }
    });

    it("preserves roleplay and unsupported messages alongside app_command rows", () => {
      const filtered = messagesWithAppCommands.filter(
        (m) => m.route !== "app_command",
      );
      const result = buildExportArtifact(filtered, "md", SESSION_ID, null);

      assert.match(result.artifact.content, /Hello there/);
      assert.match(result.artifact.content, /Tell me a joke/);
      assert.match(result.artifact.content, /Why did the chicken/);
      assert.doesNotMatch(result.artifact.content, /Your transcript has been exported/);
    });

    it("includes app_command messages when explicitly requested (forward-compatible)", () => {
      const result = buildExportArtifact(
        messagesWithAppCommands,
        "json",
        SESSION_ID,
        null,
      );
      const parsed = JSON.parse(result.artifact.content);
      assert.equal(parsed.message_count, 6);

      const appCommandMsgs = parsed.messages.filter(
        (m: { route: string }) => m.route === "app_command",
      );
      assert.equal(appCommandMsgs.length, 1);
    });
  });
});
