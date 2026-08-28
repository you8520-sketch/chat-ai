import type Database from "better-sqlite3";
import {
  characterCanonicalSourceFingerprintFromRow,
} from "@/lib/derivedCache/characterSourceFingerprint";
import {
  enqueueDerivedCacheJob,
  forceRequeueDerivedCacheJob,
} from "@/lib/derivedCache/jobs";
import { TRANSLATION_DERIVATION_VERSION } from "@/lib/derivedCache/versions";

export const FORCE_APPEARANCE_JOB_FLAG = "force_appearance";

type CharacterFingerprintRow = {
  name: string;
  gender?: string | null;
  system_prompt?: string | null;
  world?: string | null;
  example_dialog?: string | null;
  appearance_raw?: string | null;
  creator_compiled_description_json?: string | null;
  content_kind?: string | null;
};

function loadCharacterFingerprintRow(
  db: Database.Database,
  characterId: number
): CharacterFingerprintRow | null {
  return (
    (db
      .prepare(
        `SELECT name, gender, system_prompt, world, example_dialog, appearance_raw,
                creator_compiled_description_json, content_kind
         FROM characters WHERE id = ?`
      )
      .get(characterId) as CharacterFingerprintRow | undefined) ?? null
  );
}

function fingerprintForCharacter(db: Database.Database, characterId: number): string {
  const row = loadCharacterFingerprintRow(db, characterId);
  if (!row) throw new Error(`character_not_found:${characterId}`);
  return characterCanonicalSourceFingerprintFromRow(row);
}

/** Idempotent enqueue — preserves pending retry/backoff and terminal failed jobs. */
export function enqueueCharacterDerivedRefreshJob(
  db: Database.Database,
  characterId: number,
  options?: { jobFlags?: string }
): string {
  const sourceFingerprint = fingerprintForCharacter(db, characterId);
  enqueueDerivedCacheJob(db, {
    jobKind: "character_derived_refresh",
    entityType: "character",
    entityId: characterId,
    sourceFingerprint,
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
    jobFlags: options?.jobFlags,
  });
  return sourceFingerprint;
}

/** Explicit requeue for force refresh (e.g. regenerate_appearance). */
export function forceRequeueCharacterDerivedRefreshJob(
  db: Database.Database,
  characterId: number,
  options?: { jobFlags?: string }
): string {
  const sourceFingerprint = fingerprintForCharacter(db, characterId);
  forceRequeueDerivedCacheJob(db, {
    jobKind: "character_derived_refresh",
    entityType: "character",
    entityId: characterId,
    sourceFingerprint,
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
    jobFlags: options?.jobFlags,
  });
  return sourceFingerprint;
}
