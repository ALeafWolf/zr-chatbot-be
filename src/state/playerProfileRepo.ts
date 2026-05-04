import { db } from "../db/client";
import { playerProfile } from "../db/schema/memory";
import { eq } from "drizzle-orm";
import type { PlayerProfile } from "../db/schema/memory";

export async function getOrCreatePlayerProfile(
  playerId: string,
): Promise<PlayerProfile> {
  const existing = await db
    .select()
    .from(playerProfile)
    .where(eq(playerProfile.playerId, playerId))
    .limit(1);

  if (existing[0]) return existing[0];

  const now = new Date();
  const newProfile = {
    playerId,
    knownName: null,
    preferenceNotes: null,
    stableFacts: null,
    relationshipNotes: null,
    updatedAt: now,
  };

  await db.insert(playerProfile).values(newProfile);
  return { ...newProfile };
}

export async function updatePlayerProfile(
  playerId: string,
  update: Partial<Pick<PlayerProfile, "knownName" | "preferenceNotes" | "stableFacts" | "relationshipNotes">>,
): Promise<void> {
  await db
    .update(playerProfile)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(playerProfile.playerId, playerId));
}
