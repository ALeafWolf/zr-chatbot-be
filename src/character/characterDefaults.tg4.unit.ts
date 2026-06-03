/**
 * TG4 tests — Precedence + equivalence for persist-internal-logic-in-db.
 */
import assert from "node:assert/strict";
import { describe, it, mock, before } from "node:test";
import type { CharacterProfile } from "../db/schema/persona";
import { formatInternalLogic } from "./psychology/formatInternalLogic";

let _mockProfile: CharacterProfile | null = null;
let _getCharacterProfileCalls = 0;

mock.module("./characterProfiles", {
  namedExports: {
    getCharacterProfile: async (_characterId: string) => {
      _getCharacterProfileCalls++;
      return _mockProfile;
    },
  },
});

const CHARACTER_ID = "zuo_ran";

const YAML_INTERNAL_LOGIC: Record<string, string> = {
  growth_environment: "在一个有温度但对能力与责任要求极高的家庭中长大——被爱过，也被严格要求过。",
  core_belief: "真正的在意必须通过可靠的行动和长期承诺来证明。",
  core_motivation: "以稳定、可靠、可承担后果的方式守护所珍视的人。",
  core_fear: "因一时情绪、误判或失控而辜负他人，造成无法弥补的后果。",
  defense_mechanism: "当他感到压力或情绪即将溢出时，会本能地先做以下一件事：沉默、转移话题、确认事实。",
  transition_rule: "从克制到坦露之间必须存在可见的中间态。",
  relationship_scope_gate: "以上内在逻辑的表达强度必须与当前关系阶段匹配。",
  expression_constraint: "以上内在逻辑是生成行为的依据，不是角色会说出口的内容。",
};

const DB_INTERNAL_LOGIC_NEWER: Record<string, string> = {
  ...YAML_INTERNAL_LOGIC,
  core_motivation: "以稳定、可靠、可承担后果的方式守护所珍视的人。——DB更新版",
};

const DB_INTERNAL_LOGIC_SAME: Record<string, string> = { ...YAML_INTERNAL_LOGIC };

function resetYamlCached(cache: Map<string, any>, version = "2.1"): void {
  const entry = cache.get(CHARACTER_ID);
  if (entry) { entry.internal_logic = { ...YAML_INTERNAL_LOGIC }; entry.version = version; }
  else { cache.set(CHARACTER_ID, { character_id: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version, internal_logic: { ...YAML_INTERNAL_LOGIC } }); }
}

describe("TG4 — mergeDbInternalLogic precedence", () => {
  let cache: Map<string, any>;
  let mergeFn: (characterId: string) => Promise<void>;
  let loadDefaultsFn: (characterId: string) => unknown;

  before(async () => {
    const mod = await import("./characterDefaults");
    mergeFn = mod.mergeDbInternalLogic;
    loadDefaultsFn = mod.loadCharacterDefaults;
    loadDefaultsFn(CHARACTER_ID);
    cache = new Map();
    const defaults = mod.loadCharacterDefaults(CHARACTER_ID);
    cache.set(CHARACTER_ID, defaults);
  });

  it("handles all merge scenarios: missing, null, malformed, older, same, newer, equivalence", async () => {
    // Row missing → YAML fallback
    resetYamlCached(cache);
    _mockProfile = null;
    const beforeMissing = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    assert.deepEqual(cache.get(CHARACTER_ID).internal_logic, beforeMissing, "missing row → unchanged");

    // internal_logic null → YAML fallback
    resetYamlCached(cache);
    _mockProfile = { characterId: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version: "2.1", internalLogic: null } as any;
    const beforeNull = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    assert.deepEqual(cache.get(CHARACTER_ID).internal_logic, beforeNull, "null → unchanged");

    // Malformed version (NaN) → YAML fallback
    resetYamlCached(cache);
    _mockProfile = { characterId: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version: "invalid", internalLogic: DB_INTERNAL_LOGIC_NEWER } as any;
    const beforeMalformed = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    assert.deepEqual(cache.get(CHARACTER_ID).internal_logic, beforeMalformed, "malformed → unchanged");

    // Older DB version → YAML fallback
    resetYamlCached(cache);
    _mockProfile = { characterId: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version: "1.5", internalLogic: DB_INTERNAL_LOGIC_NEWER } as any;
    const beforeOlder = { ...cache.get(CHARACTER_ID).internal_logic };
    await mergeFn(CHARACTER_ID);
    assert.deepEqual(cache.get(CHARACTER_ID).internal_logic, beforeOlder, "older → unchanged");

    // Same DB version → DB wins (merge applied)
    resetYamlCached(cache);
    _mockProfile = { characterId: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version: "2.1", internalLogic: DB_INTERNAL_LOGIC_NEWER } as any;
    await mergeFn(CHARACTER_ID);
    let after = cache.get(CHARACTER_ID).internal_logic;
    assert.equal(after.core_motivation, DB_INTERNAL_LOGIC_NEWER.core_motivation, "same version — DB wins core_motivation");
    assert.equal(after.growth_environment, YAML_INTERNAL_LOGIC.growth_environment, "same version — unchanged fields preserved");

    // Newer DB version → DB wins
    resetYamlCached(cache);
    _mockProfile = { characterId: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version: "2.2", internalLogic: DB_INTERNAL_LOGIC_NEWER } as any;
    await mergeFn(CHARACTER_ID);
    after = cache.get(CHARACTER_ID).internal_logic;
    assert.equal(after.core_motivation, DB_INTERNAL_LOGIC_NEWER.core_motivation, "newer version — DB wins");

    // Byte-identical rendered prompt block
    resetYamlCached(cache);
    const yamlOnly = cache.get(CHARACTER_ID).internal_logic;
    const yamlRendered = formatInternalLogic(yamlOnly);
    _mockProfile = { characterId: CHARACTER_ID, name: "左然", archetype: "elite_lawyer_controlled_romantic", version: "2.1", internalLogic: DB_INTERNAL_LOGIC_SAME } as any;
    await mergeFn(CHARACTER_ID);
    const dbMerged = cache.get(CHARACTER_ID).internal_logic;
    const dbRendered = formatInternalLogic(dbMerged);
    assert.equal(dbRendered, yamlRendered, "equivalence — byte-identical");
  });
});

describe("TG4 — per-turn sync loader has no DB dependency", () => {
  let loadDefaultsFn: (characterId: string) => unknown;

  before(async () => {
    _getCharacterProfileCalls = 0;
    const mod = await import("./characterDefaults");
    loadDefaultsFn = mod.loadCharacterDefaults;
  });

  it("loadCharacterDefaults does not call getCharacterProfile (zero DB calls on per-turn path)", () => {
    const callsBefore = _getCharacterProfileCalls;
    const defaults = loadDefaultsFn(CHARACTER_ID) as { internal_logic?: Record<string, string>; version?: string };
    assert.equal(_getCharacterProfileCalls, callsBefore, "zero DB calls");
    assert.ok(defaults.internal_logic, "returns internal_logic from YAML");
    assert.equal(defaults.internal_logic!.growth_environment, YAML_INTERNAL_LOGIC.growth_environment, "pure YAML growth_environment");
    assert.equal(defaults.version, "2.1", "YAML version");
  });
});
