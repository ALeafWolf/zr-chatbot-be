import { db } from "../db/client";
import { characterProfiles } from "../db/schema/persona";
import { eq } from "drizzle-orm";
import type { CharacterProfile } from "../db/schema/persona";

export async function getCharacterProfile(
  characterId: string,
): Promise<CharacterProfile | null> {
  const rows = await db
    .select()
    .from(characterProfiles)
    .where(eq(characterProfiles.characterId, characterId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCharacters(): Promise<
  Pick<CharacterProfile, "characterId" | "name">[]
> {
  return db
    .select({ characterId: characterProfiles.characterId, name: characterProfiles.name })
    .from(characterProfiles);
}
