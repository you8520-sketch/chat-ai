import { getDb } from "@/lib/db";
import { worldContentFingerprint } from "@/lib/derivedCache/versions";

export function loadCurrentShareWorldEnglish(shareId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT content, content_en, content_translation_fingerprint
       FROM world_shares WHERE id = ?`
    )
    .get(shareId) as
    | {
        content: string;
        content_en?: string | null;
        content_translation_fingerprint?: string | null;
      }
    | undefined;
  if (!row) return null;
  const expected = worldContentFingerprint(row.content);
  if ((row.content_translation_fingerprint ?? "") !== expected) return null;
  const en = (row.content_en ?? "").trim();
  return en || null;
}

export function loadShareWorldEnglishForCharacter(characterId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(`SELECT source_world_share_id FROM characters WHERE id = ?`)
    .get(characterId) as { source_world_share_id: number | null } | undefined;
  const shareId = row?.source_world_share_id;
  if (shareId == null || shareId <= 0) return null;
  return loadCurrentShareWorldEnglish(shareId);
}
