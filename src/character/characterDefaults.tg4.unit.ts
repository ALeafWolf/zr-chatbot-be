/**
 * TG4 tests — Precedence + equivalence for persist-internal-logic-in-db.
 *
 * Tests mergeDbInternalLogic (and its caller warmCharacterCache) by
 * mocking the getCharacterProfile dependency. No live DB needed.
 *
 * Run with: npm run test:unit
 */
import assert from "node:assert/strict";
import { describe, it, mock, before } from "node:test";
import type { CharacterProfile } from "../db/schema/persona";
import { formatInternalLogic } from "./psychology/formatInternalLogic";

// ---------------------------------------------------------------------------
// Mutable delegates for module mocks
// ---------------------------------------------------------------------------
let _mockProfile: CharacterProfile | null = null;
let _getCharacterProfileCalls = 0;

// Mock getCharacterProfile at the top level (per test-file scope).
// A call counter spy proves the per-turn path never calls the DB.
mock.module("./characterProfiles", {
  namedExports: {
    getCharacterProfile: async (_characterId: string) => {
      _getCharacterProfileCalls++;
      return _mockProfile;
    },
  },
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const CHARACTER_ID = "zuo_ran";

const YAML_INTERNAL_LOGIC: Record<string, string> = {
  growth_environment:
    "在一个有温度但对能力与责任要求极高的家庭中长大——被爱过，也被严格要求过。",
  core_belief: "真正的在意必须通过可靠的行动和长期承诺来证明。",
  core_motivation: "以稳定、可靠、可承担后果的方式守护所珍视的人。",
  core_fear: "因一时情绪、误判或失控而辜负他人，造成无法弥补的后果。",
  defense_mechanism:
    "当他感到压力或情绪即将溢出时，会本能地先做以下一件事：沉默、转移话题、确认事实。",
  transition_rule: "从克制到坦露之间必须存在可见的中间态。",
  relationship_scope_gate: "以上内在逻辑的表达强度必须与当前关系阶段匹配。",
  expression_constraint: "以上内在逻辑是生成行为的依据，不是角色会说出口的内容。",
};

const DB_INTERNAL_LOGIC_NEWER: Record<string, string> = {
  ...YAML_INTERNAL_LOGIC,
  core_motivation: "以稳定、可靠、可承担后果的方式守护所珍视的人。——DB更新版",
};

const DB_INTERNAL_LOGIC_SAME: Record<string, string> = {
  ...YAML_INTERNAL_LOGIC,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the cached zuo_ran entry to a clean YAML state. */
function resetYamlCached(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cache: Map<string, any>,
  version = "2.1",
): void {
  const entry = cache.get(CHARACTER_ID);
  if (entry) {
    entry.internal_logic = { ...YAML_INTERNAL_LOGIC };
    entry.version = version;
  } else {
    cache.set(CHARACTER_ID, {
      character_id: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version,
      internal_logic: { ...YAML_INTERNAL_LOGIC },
    });
  }
}

/** Reset the spy counter. */
function resetSpy(): void {
  _getCharacterProfileCalls = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TG4 — mergeDbInternalLogic precedence", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: Map<string, any>;
  let mergeFn: (characterId: string) => Promise<void>;
  let loadDefaultsFn: (characterId: string) => unknown;

  before(async () => {
    // Dynamic import so module mocks take effect
    const mod = await import("./characterDefaults");
    mergeFn = mod.mergeDbInternalLogic;
    loadDefaultsFn = mod.loadCharacterDefaults;
    // Populate the module cache via a normal load
    loadDefaultsFn(CHARACTER_ID);
    // Grab a reference to the internal cache entry
    cache = new Map();
    const defaults = mod.loadCharacterDefaults(CHARACTER_ID);
    cache.set(CHARACTER_ID, defaults);
  });

  it("row missing → YAML fallback (warns, does not mutate cached internal_logic)", async () => {
    resetYamlCached(cache);
    _mockProfile = null;
    const before = { ...cache.get(CHARACTER_ID).internal_logic };

    await mergeFn(CHARACTER_ID);

    const after = cache.get(CHARACTER_ID).internal_logic;
    assert.deepEqual(after, before, "internal_logic should be unchanged when row is missing");
  });

  it("internal_logic null → YAML fallback", async () => {
    resetYamlCached(cache);
    _mockProfile = {
      characterId: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version: "2.1",
      internalLogic: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const before = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    const after = cache.get(CHARACTER_ID).internal_logic;
    assert.deepEqual(after, before, "internal_logic should be unchanged when DB value is null");
  });

  it("malformed version (NaN) → YAML fallback", async () => {
    resetYamlCached(cache);
    _mockProfile = {
      characterId: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version: "invalid",
      internalLogic: DB_INTERNAL_LOGIC_NEWER,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const before = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    const after = cache.get(CHARACTER_ID).internal_logic;
    assert.deepEqual(after, before, "internal_logic should be unchanged when DB version is malformed");
  });

  it("older DB version → YAML fallback", async () => {
    resetYamlCached(cache);
    _mockProfile = {
      characterId: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version: "1.5",
      internalLogic: DB_INTERNAL_LOGIC_NEWER,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const before = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    const after = cache.get(CHARACTER_ID).internal_logic;
    assert.deepEqual(
      after,
      before,
      "internal_logic should be unchanged when DB version (1.5) is older than YAML (2.1)",
    );
  });

  it("same DB version → DB wins (merge applied)", async () => {
    resetYamlCached(cache);
    _mockProfile = {
      characterId: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version: "2.1",
      internalLogic: DB_INTERNAL_LOGIC_NEWER,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await mergeFn(CHARACTER_ID);
    const after = cache.get(CHARACTER_ID).internal_logic;
    assert.equal(
      after.core_motivation,
      DB_INTERNAL_LOGIC_NEWER.core_motivation,
      "DB version (same as YAML) should win and override core_motivation",
    );
    assert.equal(
      after.growth_environment,
      YAML_INTERNAL_LOGIC.growth_environment,
      "Unchanged fields should still match YAML originals",
    );
  });

  it("newer DB version → DB wins (full merge)", async () => {
    resetYamlCached(cache);
    _mockProfile = {
      characterId: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version: "2.2",
      internalLogic: DB_INTERNAL_LOGIC_NEWER,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await mergeFn(CHARACTER_ID);
    const after = cache.get(CHARACTER_ID).internal_logic;
    assert.equal(
      after.core_motivation,
      DB_INTERNAL_LOGIC_NEWER.core_motivation,
      "Newer DB version should win and override core_motivation",
    );
  });

  it("equivalence: DB seeded from same YAML → byte-identical rendered prompt block", async () => {
    resetYamlCached(cache);

    // Render YAML-only side through formatInternalLogic
    const yamlOnly = cache.get(CHARACTER_ID).internal_logic;
    const yamlRendered = formatInternalLogic(yamlOnly);

    // Mock DB returning the exact same YAML data
    _mockProfile = {
      characterId: CHARACTER_ID,
      name: "左然",
      archetype: "elite_lawyer_controlled_romantic",
      version: "2.1",
      internalLogic: DB_INTERNAL_LOGIC_SAME,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await mergeFn(CHARACTER_ID);
    const dbMerged = cache.get(CHARACTER_ID).internal_logic;
    const dbRendered = formatInternalLogic(dbMerged);

    assert.equal(
      dbRendered,
      yamlRendered,
      "formatInternalLogic output must be byte-identical between YAML-only and DB-merged-from-same-YAML",
    );
  });
});

describe("TG4 — per-turn sync loader has no DB dependency", () => {
  let loadDefaultsFn: (characterId: string) => unknown;

  before(async () => {
    resetSpy();
    const mod = await import("./characterDefaults");
    loadDefaultsFn = mod.loadCharacterDefaults;
  });

  it("loadCharacterDefaults does not call getCharacterProfile (zero DB calls on per-turn path)", () => {
    const callsBefore = _getCharacterProfileCalls;

    // This is a cache hit (populated by the first describe), which proves
    // the per-turn synchronous loader path never queries the DB.
    const defaults = loadDefaultsFn(CHARACTER_ID) as { internal_logic?: Record<string, string>; version?: string };

    assert.equal(
      _getCharacterProfileCalls,
      callsBefore,
      "getCharacterProfile must NOT be called during loadCharacterDefaults — per-turn path has zero DB dependency",
    );

    // Verify returned data is pure YAML content
    assert.ok(defaults.internal_logic, "Should return internal_logic from YAML");
    assert.equal(
      defaults.internal_logic!.growth_environment,
      YAML_INTERNAL_LOGIC.growth_environment,
      "Should return pure YAML content on the per-turn path",
    );
    assert.equal(defaults.version, "2.1", "Should return the YAML version");
  });
});
