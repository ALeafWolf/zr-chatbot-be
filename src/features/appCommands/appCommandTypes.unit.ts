import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  tryExtractAppCommandPayload,
  AppCommandValidatorResultSchema,
} from "./appCommandTypes";

describe("tryExtractAppCommandPayload", () => {
  it("extracts payload from valid input, returns undefined for null/undefined/malformed", () => {
    // valid app_command
    const valid = {
      route: "app_command", status: "ok", command: "export_session_raw_turns",
      app_command: { kind: "file_export", command: "export_session_raw_turns", message: "Exported.",
        options: { format: "md", turn_types: ["roleplay", "unsupported"], include_thoughts: false, include_native_thoughts: false },
        artifact: { title: "Test", filename: "test.md", mime_type: "text/markdown", format: "md", content: "# hello", byte_length: 7, message_count: 1 },
      },
    };
    let result = tryExtractAppCommandPayload(valid);
    assert.ok(result);
    assert.equal(result.kind, "file_export");

    // null → undefined
    assert.equal(tryExtractAppCommandPayload(null), undefined);

    // undefined → undefined
    assert.equal(tryExtractAppCommandPayload(undefined), undefined);

    // non-app_command route → undefined
    assert.equal(tryExtractAppCommandPayload({ route: "roleplay_turn", status: "ok" }), undefined);

    // malformed payload (missing required fields) → undefined
    assert.equal(tryExtractAppCommandPayload({ route: "app_command", status: "ok", command: "export_session_raw_turns", app_command: { kind: "file_export" } }), undefined);
  });
});

describe("AppCommandValidatorResultSchema", () => {
  it("parses valid export and unsupported command wrappers", () => {
    // export command
    const exportInput = {
      route: "app_command", status: "ok", command: "export_session_raw_turns",
      app_command: { kind: "file_export", command: "export_session_raw_turns", message: "Download ready.",
        options: { format: "json", turn_types: ["roleplay", "unsupported"], include_thoughts: false, include_native_thoughts: false },
        artifact: { title: "S", filename: "s.json", mime_type: "application/json", format: "json", content: "{}", byte_length: 2, message_count: 1 },
      },
    };
    let parsed = AppCommandValidatorResultSchema.parse(exportInput);
    assert.equal(parsed.status, "ok");
    assert.equal(parsed.command, "export_session_raw_turns");

    // unsupported command
    const unsupportedInput = {
      route: "app_command", status: "unsupported", command: "unknown",
      app_command: { kind: "unsupported", command: "unknown", message: "Unknown command.", available_commands: ["export_session_raw_turns"] },
    };
    parsed = AppCommandValidatorResultSchema.parse(unsupportedInput);
    assert.equal(parsed.status, "unsupported");
    assert.equal(parsed.command, "unknown");
  });
});
