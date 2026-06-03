import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { persistedRouteForRoleplayResult } from "./turnRoutes";

describe("persistedRouteForRoleplayResult", () => {
  it("keeps successful roleplay as roleplay_turn and stores deflections as unsupported", () => {
    assert.equal(persistedRouteForRoleplayResult({ wasDeflected: false }), "roleplay_turn", "success — roleplay");
    assert.equal(persistedRouteForRoleplayResult({ wasDeflected: true }), "unsupported", "deflected — unsupported");
  });
});
