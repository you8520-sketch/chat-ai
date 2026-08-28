import type Database from "better-sqlite3";
import type { CharacterChunk } from "@/types";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";
import { enqueueDerivedCacheJob } from "@/lib/derivedCache/jobs";
import { TRANSLATION_DERIVATION_VERSION } from "@/lib/derivedCache/versions";

export function enqueueCharacterDerivedRefreshJob(
  db: Database.Database,
  characterId: number,
  koreanChunks: CharacterChunk[]
): string {
  const sourceFingerprint = koreanChunksTranslationFingerprint(koreanChunks);
  enqueueDerivedCacheJob(db, {
    jobKind: "character_derived_refresh",
    entityType: "character",
    entityId: characterId,
    sourceFingerprint,
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
  });
  return sourceFingerprint;
}
