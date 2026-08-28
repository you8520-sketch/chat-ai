import { getDb } from "@/lib/db";
import { worldContentFingerprint } from "@/lib/derivedCache/versions";

/**
 * Owned-world English cache consumer.
 * Reuses worlds.content_en only when the character's frozen Korean world snapshot
 * exactly matches the world's current Korean source (live link, not stale snapshot).
 */
export function loadOwnedWorldEnglishForCharacter(characterId: number): string | null {
  const db = getDb();
  const character = db
    .prepare(`SELECT world_id, world FROM characters WHERE id = ?`)
    .get(characterId) as { world_id: number | null; world: string | null } | undefined;
  if (!character?.world_id || character.world_id <= 0) return null;

  const world = db
    .prepare(
      `SELECT content, content_en, content_translation_fingerprint FROM worlds WHERE id = ?`
    )
    .get(character.world_id) as
    | {
        content: string;
        content_en?: string | null;
        content_translation_fingerprint?: string | null;
      }
    | undefined;
  if (!world) return null;

  const snapshot = character.world ?? "";
  if (snapshot !== world.content) return null;

  const expected = worldContentFingerprint(world.content);
  if ((world.content_translation_fingerprint ?? "") !== expected) return null;
  const en = (world.content_en ?? "").trim();
  return en || null;
}
