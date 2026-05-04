import { db } from "../db/client";
import { personaOverlays } from "../db/schema/persona";
import { and, eq } from "drizzle-orm";
import type { PersonaOverlay } from "../db/schema/persona";

export async function getPersonaOverlay(
  overlayId: string,
): Promise<PersonaOverlay | null> {
  const rows = await db
    .select()
    .from(personaOverlays)
    .where(eq(personaOverlays.overlayId, overlayId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getOverlayForScope(
  characterId: string,
  continuityScope: string,
): Promise<PersonaOverlay | null> {
  const rows = await db
    .select()
    .from(personaOverlays)
    .where(
      and(
        eq(personaOverlays.characterId, characterId),
        eq(personaOverlays.continuityScope, continuityScope),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
