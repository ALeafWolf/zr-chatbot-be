import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  tryExtractAppCommandPayload,
  AppCommandValidatorResultSchema,
} from "./appCommandTypes";

describe("tryExtractAppCommandPayload", () => {
  it("extracts app_command from a valid validator_result", () => {
    const raw = {
      route: "app_command",
      status: "ok",
      command: "export_session_raw_turns",
      app_command: {
        kind: "file_export",
        command: "export_session_raw_turns",
        message: "Exported.",
        options: {
          format: "md",
          turn_types: ["roleplay", "unsupported"],
          include_thoughts: false,
        },
        artifact: {
          title: "Test",
          filename: "test.md",
          mime_type: "text/markdown",
          format: "md",
          content: "# hello",
          byte_length: 7,
          message_count: 1,
        },
      },
    };

    const result = tryExtractAppCommandPayload(raw);
    assert.ok(result);
    assert.equal(result.kind, "file_export");
  });

  it("returns undefined for null input", () => {
    assert.equal(tryExtractAppCommandPayload(null), undefined);
  });

  it("returns undefined for undefined input", () => {
    assert.equal(tryExtractAppCommandPayload(undefined), undefined);
  });

  it("returns undefined for non-app_command validator_result", () => {
    const raw = {
      route: "roleplay_turn",
      status: "ok",
    };
    assert.equal(tryExtractAppCommandPayload(raw), undefined);
  });

  it("returns undefined for malformed payload", () => {
    const raw = {
      route: "app_command",
      status: "ok",
      command: "export_session_raw_turns",
      app_command: { kind: "file_export" }, // missing required fields
    };
    assert.equal(tryExtractAppCommandPayload(raw), undefined);
  });
});

describe("AppCommandValidatorResultSchema", () => {
  it("parses a valid export command wrapper", () => {
    const input = {
      route: "app_command",
      status: "ok",
      command: "export_session_raw_turns",
      app_command: {
        kind: "file_export",
        command: "export_session_raw_turns",
        message: "Download ready.",
        options: {
          format: "json",
          turn_types: ["roleplay", "unsupported"],
          include_thoughts: false,
        },
        artifact: {
          title: "S",
          filename: "s.json",
          mime_type: "application/json",
          format: "json",
          content: "{}",
          byte_length: 2,
          message_count: 1,
        },
      },
    };
    const parsed = AppCommandValidatorResultSchema.parse(input);
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.command, "export_session_raw_turns");
  });

  it("parses an unsupported command wrapper", () => {
    const input = {
      route: "app_command",
      status: "unsupported",
      command: "unknown",
      app_command: {
        kind: "unsupported",
        command: "unknown",
        message: "Unknown command.",
        available_commands: ["export_session_raw_turns"],
      },
    };
    const parsed = AppCommandValidatorResultSchema.parse(input);
    assert.equal(parsed.status, "unsupported");
    assert.equal(parsed.command, "unknown");
  });
});
