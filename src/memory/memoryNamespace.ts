/**
 * Branded MemoryNamespace type and the single authoritative builder.
 *
 * Raw strings cannot be passed where MemoryNamespace is expected.
 * Every caller must go through buildMemoryNamespace — this gives compile-time
 * protection against malformed namespaces and prevents AU/main-world mixups.
 */

export type MemoryNamespace = string & { readonly __brand: "MemoryNamespace" };

export interface BuildNamespaceInput {
  continuityFamily: "main_world" | "au";
  scope: string;
  auWorldKey?: string;
  playerId: string;
}

/**
 * Encodes the active world identity into a canonical namespace string.
 *
 * Main-world:  main:<scope>:<playerId>          e.g. main:main_married:player_123
 * AU:          au:<auWorldKey>:<playerId>        e.g. au:yishi_world_x:player_123
 */
export function buildMemoryNamespace(input: BuildNamespaceInput): MemoryNamespace {
  const { continuityFamily, scope, auWorldKey, playerId } = input;

  if (!playerId || playerId.trim() === "") {
    throw new Error("buildMemoryNamespace: playerId must not be empty");
  }

  if (continuityFamily === "main_world") {
    if (!scope || scope.trim() === "") {
      throw new Error(
        "buildMemoryNamespace: scope must not be empty for main_world",
      );
    }
    if (scope.startsWith("au_") || scope.startsWith("au:")) {
      throw new Error(
        `buildMemoryNamespace: main_world scope must not look like an AU scope ("${scope}")`,
      );
    }
    return `main:${scope}:${playerId}` as MemoryNamespace;
  }

  if (continuityFamily === "au") {
    if (!auWorldKey || auWorldKey.trim() === "") {
      throw new Error(
        "buildMemoryNamespace: auWorldKey is required for AU continuity family",
      );
    }
    return `au:${auWorldKey}:${playerId}` as MemoryNamespace;
  }

  throw new Error(
    `buildMemoryNamespace: unknown continuityFamily "${continuityFamily as string}"`,
  );
}

/**
 * Validate that a raw namespace string is structurally correct and matches
 * the expected continuity family. Throws on mismatch.
 *
 * Used by repository guards before any write.
 */
export function assertNamespaceMatchesFamily(
  namespace: MemoryNamespace,
  continuityFamily: "main_world" | "au",
): void {
  if (continuityFamily === "main_world") {
    if (!namespace.startsWith("main:")) {
      throw new Error(
        `Namespace guard violation: main_world session has non-main namespace "${namespace}"`,
      );
    }
    return;
  }
  if (continuityFamily === "au") {
    if (!namespace.startsWith("au:")) {
      throw new Error(
        `Namespace guard violation: au session has non-AU namespace "${namespace}"`,
      );
    }
    const parts = namespace.split(":");
    if (parts.length < 3 || !parts[1] || parts[1].trim() === "") {
      throw new Error(
        `Namespace guard violation: AU namespace "${namespace}" is missing a valid au_world_key`,
      );
    }
    return;
  }
  throw new Error(`Unknown continuityFamily: "${continuityFamily as string}"`);
}
