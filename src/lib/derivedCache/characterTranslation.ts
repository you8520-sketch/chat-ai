import { getDb } from "@/lib/db";
import type { CharacterChunk } from "@/types";
import { loadShareWorldEnglishForCharacter } from "@/lib/derivedCache/shareWorldEnglish";
import {
  isTranslatableChunk,
  koreanChunksTranslationFingerprint,
  translateChunksToEnglish,
} from "@/lib/promptTranslation";

function mergeTranslatedChunksInOrder(
  korean: CharacterChunk[],
  translatedById: Map<string, CharacterChunk>
): CharacterChunk[] {
  return korean.map((chunk) => {
    if (!isTranslatableChunk(chunk)) return chunk;
    return translatedById.get(chunk.id) ?? chunk;
  });
}

/**
 * Translate character chunks for background derived refresh.
 * Reuses immutable share world English for world-category chunks when CURRENT.
 */
export async function translateCharacterChunksForDerivedRefresh(
  characterId: number,
  koreanChunks: CharacterChunk[]
): Promise<boolean> {
  const shareWorldEn = loadShareWorldEnglishForCharacter(characterId);
  const translatable = koreanChunks.filter(isTranslatableChunk);
  if (translatable.length === 0) return true;

  const worldChunks = translatable.filter((c) => c.category === "world");
  const nonWorldChunks = translatable.filter((c) => c.category !== "world");

  const translatedById = new Map<string, CharacterChunk>();

  if (nonWorldChunks.length > 0) {
    const nonWorldEnglish = await translateChunksToEnglish(nonWorldChunks);
    if (nonWorldEnglish === null) return false;
    for (const chunk of nonWorldEnglish) {
      translatedById.set(chunk.id, chunk);
    }
  }

  if (worldChunks.length > 0) {
    if (shareWorldEn) {
      for (const chunk of worldChunks) {
        translatedById.set(chunk.id, { ...chunk, content: shareWorldEn });
      }
    } else {
      const worldEnglish = await translateChunksToEnglish(worldChunks);
      if (worldEnglish === null) return false;
      for (const chunk of worldEnglish) {
        translatedById.set(chunk.id, chunk);
      }
    }
  }

  const englishLayer = mergeTranslatedChunksInOrder(
    koreanChunks.filter(isTranslatableChunk),
    translatedById
  );

  const db = getDb();
  const expectedFingerprint = koreanChunksTranslationFingerprint(koreanChunks);
  const result = db
    .prepare(
      `UPDATE characters SET setting_chunks_en=?
       WHERE id=? AND prompt_translation_hash=?`
    )
    .run(JSON.stringify(englishLayer), characterId, expectedFingerprint);
  return result.changes > 0;
}
