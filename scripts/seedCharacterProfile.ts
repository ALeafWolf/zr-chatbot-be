/**
 * Seed character_profiles.internal_logic from the YAML source of truth.
 *
 * Reads zuo_ran.yaml and upserts one character_profiles row with
 * internal_logic, version, name, and archetype filled from YAML.
 *
 * Usage:
 *   npm run seed:character-profile -- --dry-run     # print seed plan, no writes
 *   npm run seed:character-profile -- --apply       # insert/update row
 *
 * --apply requires a live DB connection.
 */
import { db } from "../src/db/client";
import { characterProfiles } from "../src/db/schema/persona";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isApply = args.includes("--apply");

if (!isDryRun && !isApply) {
  console.log(
    "Usage: npm run seed:character-profile -- --dry-run | --apply",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Load YAML
// ---------------------------------------------------------------------------
const DEFAULTS_DIR = path.join(__dirname, "..", "src", "character", "defaults");
const YAML_FILE = path.join(DEFAULTS_DIR, "zuo_ran.yaml");

if (!fs.existsSync(YAML_FILE)) {
  console.error(`YAML file not found: ${YAML_FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(YAML_FILE, "utf-8");
const parsed = yaml.load(raw) as Record<string, unknown>;

const characterId = parsed.character_id as string;
const name = parsed.name as string;
const archetype = parsed.archetype as string | null ?? null;
const version = parsed.version as string | null ?? null;
const internalLogic = (parsed.internal_logic as Record<string, string>) ?? null;

if (!characterId) {
  console.error("YAML is missing character_id");
  process.exit(1);
}

if (!name) {
  console.error("YAML is missing name");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------
async function runDryRun(): Promise<void> {
  console.log(`\n[DRY-RUN] Character profile seed plan`);
  console.log(`  character_id:  ${characterId}`);
  console.log(`  name:          ${name}`);
  console.log(`  archetype:     ${archetype}`);
  console.log(`  version:       ${version}`);
  console.log(`  internal_logic: ${internalLogic ? Object.keys(internalLogic).join(", ") : "(none)"}`);
  console.log(`  internal_logic keys: ${internalLogic ? Object.keys(internalLogic).length : 0}`);
  console.log(`  internal_logic blocks:`);

  if (internalLogic) {
    for (const [key, value] of Object.entries(internalLogic)) {
      const preview = (value ?? "").slice(0, 80).replace(/\n/g, "\\n");
      console.log(`    ${key}: "${preview}..."`);
    }
  }

  // Check if row already exists
  try {
    const existing = await db
      .select({ characterId: characterProfiles.characterId })
      .from(characterProfiles)
      .where(eq(characterProfiles.characterId, characterId))
      .limit(1);

    if (existing.length > 0) {
      console.log(`\n  → Row exists for "${characterId}". Will UPDATE.`);
    } else {
      console.log(`\n  → No row exists for "${characterId}". Will INSERT.`);
    }
  } catch (err) {
    console.log(`\n  (DB not available: ${(err as Error).message})`);
    console.log(`  Cannot check existing row.`);
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Apply mode
// ---------------------------------------------------------------------------
async function runApply(): Promise<void> {
  console.log(`\n[APPLY] Seeding character profile for ${characterId}\n`);

  const rowData = {
    characterId,
    name,
    archetype: archetype ?? undefined,
    version: version ?? undefined,
    internalLogic: internalLogic as Record<string, string> | undefined,
  };

  // Check if row exists
  const existing = await db
    .select({ characterId: characterProfiles.characterId })
    .from(characterProfiles)
    .where(eq(characterProfiles.characterId, characterId))
    .limit(1);

  try {
    if (existing.length > 0) {
      // Update existing row
      await db
        .update(characterProfiles)
        .set({
          name,
          archetype: archetype ?? undefined,
          version: version ?? undefined,
          internalLogic: internalLogic as Record<string, string> | undefined,
          updatedAt: new Date(),
        })
        .where(eq(characterProfiles.characterId, characterId));
      console.log(`  ✓ Updated "${characterId}"`);
    } else {
      // Insert new row
      await db.insert(characterProfiles).values(rowData);
      console.log(`  ✓ Inserted "${characterId}"`);
    }
  } catch (err) {
    console.error(`  [FAIL] DB write failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // Verify the written row
  const verify = await db
    .select({
      characterId: characterProfiles.characterId,
      name: characterProfiles.name,
      archetype: characterProfiles.archetype,
      version: characterProfiles.version,
      internalLogic: characterProfiles.internalLogic,
    })
    .from(characterProfiles)
    .where(eq(characterProfiles.characterId, characterId))
    .limit(1);

  if (verify.length > 0) {
    const row = verify[0];
    console.log(`\nVerification:`);
    console.log(`  characterId:   ${row.characterId}`);
    console.log(`  name:          ${row.name}`);
    console.log(`  archetype:     ${row.archetype}`);
    console.log(`  version:       ${row.version}`);
    const ilKeys = row.internalLogic
      ? Object.keys(row.internalLogic as Record<string, string>).join(", ")
      : "(none)";
    console.log(`  internal_logic: ${ilKeys}`);
    console.log(`  ✓ Row verified in DB.`);
  } else {
    console.error(`  [FAIL] Row not found after write.`);
    process.exit(1);
  }

  console.log(`\nDone.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (isDryRun) await runDryRun();
  if (isApply) await runApply();
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
