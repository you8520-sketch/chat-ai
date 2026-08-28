import type Database from "better-sqlite3";
import { enqueueDerivedCacheJob } from "@/lib/derivedCache/jobs";
import { TRANSLATION_DERIVATION_VERSION, worldContentFingerprint } from "@/lib/derivedCache/versions";
import { translateWorldContentToEnglish } from "@/lib/promptTranslation";

export function enqueueWorldTranslationJob(db: Database.Database, worldId: number, content: string): void {
  enqueueDerivedCacheJob(db, {
    jobKind: "world_translate",
    entityType: "world",
    entityId: worldId,
    sourceFingerprint: worldContentFingerprint(content),
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
  });
}

export function enqueueWorldShareTranslationJob(
  db: Database.Database,
  shareId: number,
  koreanContent: string
): void {
  enqueueDerivedCacheJob(db, {
    jobKind: "world_share_translate",
    entityType: "world_share",
    entityId: shareId,
    sourceFingerprint: worldContentFingerprint(koreanContent),
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
  });
}

export async function refreshWorldEnglishCache(
  db: Database.Database,
  worldId: number,
  expectedFingerprint: string
): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean }> {
  const row = db
    .prepare(`SELECT content, content_translation_fingerprint FROM worlds WHERE id = ?`)
    .get(worldId) as { content: string; content_translation_fingerprint?: string | null } | undefined;
  if (!row) return { ok: false, error: "world_not_found", retryable: false };
  const currentFingerprint = worldContentFingerprint(row.content);
  if (currentFingerprint !== expectedFingerprint) return { ok: true };

  const english = await translateWorldContentToEnglish(row.content);
  if (!english) return { ok: false, error: "world_translation_failed", retryable: true };

  const updated = db
    .prepare(
      `UPDATE worlds SET content_en = ?, content_translation_fingerprint = ?
       WHERE id = ? AND content = ?`
    )
    .run(english, currentFingerprint, worldId, row.content);
  return updated.changes > 0
    ? { ok: true }
    : { ok: false, error: "world_translation_cas_failed", retryable: false };
}

export async function refreshWorldShareEnglishCache(
  db: Database.Database,
  shareId: number,
  expectedFingerprint: string
): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean }> {
  const row = db
    .prepare(`SELECT content, content_translation_fingerprint FROM world_shares WHERE id = ?`)
    .get(shareId) as { content: string; content_translation_fingerprint?: string | null } | undefined;
  if (!row) return { ok: false, error: "share_not_found", retryable: false };
  const currentFingerprint = worldContentFingerprint(row.content);
  if (currentFingerprint !== expectedFingerprint) return { ok: true };

  const english = await translateWorldContentToEnglish(row.content);
  if (!english) return { ok: false, error: "share_translation_failed", retryable: true };

  const updated = db
    .prepare(
      `UPDATE world_shares SET content_en = ?, content_translation_fingerprint = ?
       WHERE id = ? AND content = ?`
    )
    .run(english, currentFingerprint, shareId, row.content);
  return updated.changes > 0
    ? { ok: true }
    : { ok: false, error: "share_translation_cas_failed", retryable: false };
}

export function copyWorldEnglishToShareIfCurrent(
  db: Database.Database,
  shareId: number,
  sourceWorldId: number,
  shareKoreanContent: string
): boolean {
  const world = db
    .prepare(
      `SELECT content, content_en, content_translation_fingerprint FROM worlds WHERE id = ?`
    )
    .get(sourceWorldId) as
    | {
        content: string;
        content_en?: string | null;
        content_translation_fingerprint?: string | null;
      }
    | undefined;
  if (!world) return false;
  const shareFingerprint = worldContentFingerprint(shareKoreanContent);
  const worldFingerprint = worldContentFingerprint(world.content);
  if (worldFingerprint !== (world.content_translation_fingerprint ?? "")) return false;
  if (world.content !== shareKoreanContent) return false;
  const en = (world.content_en ?? "").trim();
  if (!en) return false;
  db.prepare(
    `UPDATE world_shares SET content_en = ?, content_translation_fingerprint = ? WHERE id = ?`
  ).run(en, shareFingerprint, shareId);
  return true;
}
