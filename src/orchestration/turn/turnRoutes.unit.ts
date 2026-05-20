import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistedRouteForRoleplayResult } from "./turnRoutes";

describe("persistedRouteForRoleplayResult", () => {
  it("keeps successful roleplay turns in the roleplay route", () => {
    assert.equal(
      persistedRouteForRoleplayResult({ wasDeflected: false }),
      "roleplay_turn",
    );
  });

  it("stores validator deflections as unsupported so future roleplay ignores them", () => {
    assert.equal(
      persistedRouteForRoleplayResult({ wasDeflected: true }),
      "unsupported",
    );
  });
});
