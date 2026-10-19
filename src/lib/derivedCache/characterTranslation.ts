import { getDb } from "@/lib/db";
import type { CharacterChunk } from "@/types";
import { deserializeCharacterChunks, serializeCharacterChunks } from "@/utils/characterParser";
import { loadOwnedWorldEnglishForCharacter } from "@/lib/derivedCache/ownedWorldEnglish";
import { loadShareWorldEnglishForCharacter } from "@/lib/derivedCache/shareWorldEnglish";
import {
  enqueueWorldShareTranslationJob,
  enqueueWorldTranslationJob,
} from "@/lib/derivedCache/worldTranslation";
import {
  classifyEnglishLayer,
  isTranslatableChunk,
  koreanChunksTranslationFingerprint,
  translateChunksToEnglish,
} from "@/lib/promptTranslation";

export const OWNED_WORLD_EN_CONSUMER_PATH = "loadOwnedWorldEnglishForCharacter";
export const SHARE_WORLD_EN_CONSUMER_PATH = "loadShareWorldEnglishForCharacter";

function mergeTranslatedChunksInOrder(
  korean: CharacterChunk[],
  translatedById: Map<string, CharacterChunk>
): CharacterChunk[] {
  return korean.map((chunk) => {
    if (!isTranslatableChunk(chunk)) return chunk;
    return translatedById.get(chunk.id) ?? chunk;
  });
}

type WorldEnglishResolution =
  | { kind: "current"; english: string; consumerPath: string }
  | { kind: "pending" }
  | { kind: "inline" };

function resolveWorldEnglishForCharacter(characterId: number): WorldEnglishResolution {
  const db = getDb();
  const row = db
    .prepare(`SELECT world_id, source_world_share_id, world FROM characters WHERE id = ?`)
    .get(characterId) as
    | { world_id: number | null; source_world_share_id: number | null; world: string | null }
    | undefined;
  if (!row) return { kind: "inline" };

  if (row.source_world_share_id != null && row.source_world_share_id > 0) {
    const shareEn = loadShareWorldEnglishForCharacter(characterId);
    if (shareEn) {
      return { kind: "current", english: shareEn, consumerPath: SHARE_WORLD_EN_CONSUMER_PATH };
    }
    enqueueWorldShareTranslationJob(db, row.source_world_share_id, row.world ?? "");
    return { kind: "pending" };
  }

  if (row.world_id != null && row.world_id > 0) {
    const ownedEn = loadOwnedWorldEnglishForCharacter(characterId);
    if (ownedEn) {
      return { kind: "current", english: ownedEn, consumerPath: OWNED_WORLD_EN_CONSUMER_PATH };
    }
    const world = db
      .prepare(`SELECT content FROM worlds WHERE id = ?`)
      .get(row.world_id) as { content: string } | undefined;
    if (world) {
      enqueueWorldTranslationJob(db, row.world_id, world.content);
    }
    return { kind: "pending" };
  }

  return { kind: "inline" };
}

function publishCharacterEnglishLayer(
  characterId: number,
  englishLayer: CharacterChunk[],
  expectedTranslationFingerprint: string,
  expectedSettingChunks: string
): boolean {
  const result = getDb()
    .prepare(
      `UPDATE characters SET setting_chunks_en=?, prompt_translation_hash=?
       WHERE id=? AND setting_chunks=?`
    )
    .run(
      JSON.stringify(englishLayer),
      expectedTranslationFingerprint,
      characterId,
      expectedSettingChunks
    );
  return result.changes > 0;
}

/**
 * Character layer is already CURRENT. Non-world English stays on disk.
 * Owned/share world freshness still runs: pending/stale keeps the existing
 * dependency, and a newer valid world English blob is copied with the same CAS.
 */
function refreshCurrentLinkedWorldEnglish(
  characterId: number,
  koreanChunks: CharacterChunk[],
  storedEn: string
): boolean {
  const worldChunks = koreanChunks.filter(
    (chunk) => isTranslatableChunk(chunk) && chunk.category === "world"
  );
  if (worldChunks.length === 0) return true;

  const worldResolution = resolveWorldEnglishForCharacter(characterId);
  if (worldResolution.kind === "pending") return false;
  if (worldResolution.kind !== "current") return true;

  const stored = deserializeCharacterChunks(storedEn);
  const fresh = worldResolution.english;
  const worldIds = new Set(worldChunks.map((chunk) => chunk.id));
  const aligned = worldChunks.every((chunk) =>
    stored.some((row) => row.id === chunk.id && row.content === fresh)
  );
  if (aligned) return true;

  const next = stored
    .filter((chunk) => chunk.category !== "world" || worldIds.has(chunk.id))
    .map((chunk) => (worldIds.has(chunk.id) ? { ...chunk, content: fresh } : chunk));
  for (const chunk of worldChunks) {
    if (!next.some((row) => row.id === chunk.id)) {
      next.push({ ...chunk, content: fresh });
    }
  }
  return publishCharacterEnglishLayer(
    characterId,
    next,
    koreanChunksTranslationFingerprint(koreanChunks),
    serializeCharacterChunks(koreanChunks)
  );
}

/**
 * Translate character chunks for background derived refresh.
 * Skips provider work when classifyEnglishLayer is CURRENT for the rebuilt Korean
 * chunks — same freshness owner as translateAndSaveCharacterPromptEn.
 * A CURRENT layer still resolves owned/share world English. Non-world text is not
 * sent again. Pending or stale linked worlds keep the existing dependency.
 */
export async function translateCharacterChunksForDerivedRefresh(
  characterId: number,
  koreanChunks: CharacterChunk[],
  jobId?: string | null
): Promise<boolean> {
  const translatable = koreanChunks.filter(isTranslatableChunk);
  if (translatable.length === 0) return true;

  const stored = getDb()
    .prepare(`SELECT setting_chunks_en, prompt_translation_hash FROM characters WHERE id=?`)
    .get(characterId) as
    | { setting_chunks_en?: string | null; prompt_translation_hash?: string | null }
    | undefined;
  if (
    classifyEnglishLayer({
      koreanChunks,
      settingChunksEn: stored?.setting_chunks_en,
      promptTranslationHash: stored?.prompt_translation_hash,
    }) === "CURRENT"
  ) {
    return refreshCurrentLinkedWorldEnglish(
      characterId,
      koreanChunks,
      stored?.setting_chunks_en ?? ""
    );
  }

  const expectedSettingChunks = serializeCharacterChunks(koreanChunks);
  const expectedTranslationFingerprint = koreanChunksTranslationFingerprint(koreanChunks);

  const worldChunks = translatable.filter((c) => c.category === "world");
  const nonWorldChunks = translatable.filter((c) => c.category !== "world");

  const translatedById = new Map<string, CharacterChunk>();

  if (worldChunks.length > 0) {
    const worldResolution = resolveWorldEnglishForCharacter(characterId);
    if (worldResolution.kind === "pending") {
      return false;
    }
    if (worldResolution.kind === "current") {
      for (const chunk of worldChunks) {
        translatedById.set(chunk.id, { ...chunk, content: worldResolution.english });
      }
    } else {
      const worldEnglish = await translateChunksToEnglish(worldChunks, jobId);
      if (worldEnglish === null) return false;
      for (const chunk of worldEnglish) {
        translatedById.set(chunk.id, chunk);
      }
    }
  }

  if (nonWorldChunks.length > 0) {
    const nonWorldEnglish = await translateChunksToEnglish(nonWorldChunks, jobId);
    if (nonWorldEnglish === null) return false;
    for (const chunk of nonWorldEnglish) {
      translatedById.set(chunk.id, chunk);
    }
  }

  const englishLayer = mergeTranslatedChunksInOrder(
    koreanChunks.filter(isTranslatableChunk),
    translatedById
  );

  return publishCharacterEnglishLayer(
    characterId,
    englishLayer,
    expectedTranslationFingerprint,
    expectedSettingChunks
  );
}

export function resolveWorldEnglishForCharacterForTests(characterId: number): WorldEnglishResolution {
  return resolveWorldEnglishForCharacter(characterId);
}
