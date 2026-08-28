import { getDb } from "@/lib/db";
import type { CharacterChunk } from "@/types";
import { serializeCharacterChunks } from "@/utils/characterParser";
import { loadOwnedWorldEnglishForCharacter } from "@/lib/derivedCache/ownedWorldEnglish";
import { loadShareWorldEnglishForCharacter } from "@/lib/derivedCache/shareWorldEnglish";
import {
  enqueueWorldShareTranslationJob,
  enqueueWorldTranslationJob,
} from "@/lib/derivedCache/worldTranslation";
import {
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

/**
 * Translate character chunks for background derived refresh.
 * Reuses immutable share/owned world English when CURRENT — never per-borrower retranslation.
 */
export async function translateCharacterChunksForDerivedRefresh(
  characterId: number,
  koreanChunks: CharacterChunk[]
): Promise<boolean> {
  const translatable = koreanChunks.filter(isTranslatableChunk);
  if (translatable.length === 0) return true;

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
      const worldEnglish = await translateChunksToEnglish(worldChunks);
      if (worldEnglish === null) return false;
      for (const chunk of worldEnglish) {
        translatedById.set(chunk.id, chunk);
      }
    }
  }

  if (nonWorldChunks.length > 0) {
    const nonWorldEnglish = await translateChunksToEnglish(nonWorldChunks);
    if (nonWorldEnglish === null) return false;
    for (const chunk of nonWorldEnglish) {
      translatedById.set(chunk.id, chunk);
    }
  }

  const englishLayer = mergeTranslatedChunksInOrder(
    koreanChunks.filter(isTranslatableChunk),
    translatedById
  );

  const db = getDb();
  const result = db
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

export function resolveWorldEnglishForCharacterForTests(characterId: number): WorldEnglishResolution {
  return resolveWorldEnglishForCharacter(characterId);
}
