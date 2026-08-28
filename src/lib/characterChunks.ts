import { getDb } from "@/lib/db";
import {
  deserializeCharacterChunks,
  parseCharacterSetting,
  serializeCharacterChunks,
} from "@/utils/characterParser";
import type { CharacterChunk } from "@/types";
import type { CharacterGender } from "@/lib/characterGender";
import {
  hashKoreanChunks,
  koreanChunksTranslationFingerprint,
  loadEnglishChunks,
  scheduleEnglishBackfill,
} from "@/lib/promptTranslation";
import { replaceUserPlaceholderInChunks } from "@/lib/userPlaceholder";
import {
  deriveSpeechProfile,
  parseStoredSpeechProfile,
  serializeSpeechProfile,
  type SpeechProfile,
} from "@/lib/speechLock";
import {
  buildCreatorSpeechProfilePartial,
  type SpeechCreatorInput,
} from "@/lib/speechCreatorFields";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import {
  compileCreatorDescriptionTriggers,
  compiledPublicCanonText,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import { resolveAppearancePromptText } from "@/lib/derivedCache/appearanceCurrentness";
import { replaceAppearanceInSetting } from "@/lib/appearanceCompiler";
import {
  enqueueCharacterDerivedRefreshJob,
  forceRequeueCharacterDerivedRefreshJob,
  FORCE_APPEARANCE_JOB_FLAG,
} from "@/lib/derivedCache/characterEnqueue";
import { kickDerivedCacheWorker } from "@/lib/derivedCache/jobs";

export type CharacterSettingRow = {
  id: number;
  name: string;
  gender?: string | null;
  system_prompt: string;
  world?: string | null;
  example_dialog?: string | null;
  status_window_prompt?: string | null;
  setting_chunks?: string | null;
  setting_chunks_en?: string | null;
  prompt_translation_hash?: string | null;
  speech_profile?: string | null;
  creator_compiled_description_json?: string | null;
  appearance_raw?: string | null;
  appearance_compiled?: string | null;
  appearance_compiled_source_hash?: string | null;
  appearance_compiled_version?: number | null;
};

function resolveSafeRuntimeCanon(row: CharacterSettingRow): string {
  const compiled = parseCreatorDescriptionCompiled(row.creator_compiled_description_json);
  const storedPublicCanon = compiledPublicCanonText(compiled);
  if (storedPublicCanon) {
    return replaceAppearanceInSetting(
      storedPublicCanon,
      resolveAppearancePromptText({
        raw: row.appearance_raw ?? "",
        compiledJson: row.appearance_compiled,
        compiledSourceHash: row.appearance_compiled_source_hash,
        compiledVersion: row.appearance_compiled_version,
      })
    );
  }

  const fallback = compileCreatorDescriptionTriggers({
    description: [row.world ?? "", row.system_prompt ?? ""].filter(Boolean).join("\n\n"),
  });
  const fallbackPublicCanon = compiledPublicCanonText(fallback);
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `[characterChunks] character ${row.id} is missing compiled creator sections; using on-the-fly public_canon fallback`
    );
  }
  return replaceAppearanceInSetting(
    fallbackPublicCanon,
    resolveAppearancePromptText({
      raw: row.appearance_raw ?? "",
      compiledJson: row.appearance_compiled,
      compiledSourceHash: row.appearance_compiled_source_hash,
      compiledVersion: row.appearance_compiled_version,
    })
  );
}

function parseFreshCharacterChunks(row: CharacterSettingRow): CharacterChunk[] {
  const safeRuntimeCanon = resolveSafeRuntimeCanon(row);
  return parseCharacterSetting({
    characterId: String(row.id),
    systemPrompt: safeRuntimeCanon,
    world: "",
    exampleDialog: resolveExampleDialogForPrompt(row.example_dialog, row.name),
    characterName: row.name,
    gender: (row.gender as CharacterGender) ?? "other",
  });
}

/** English layer omits speech chunks — merge them back from Korean source. */
export function mergeEnglishLayerWithKoreanSpeech(
  english: CharacterChunk[],
  korean: CharacterChunk[]
): CharacterChunk[] {
  const byId = new Map(english.map((c) => [c.id, c]));
  for (const c of korean) {
    if (c.category === "speech" && !byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => {
    const ai = Number(a.id.match(/chunk-(\d+)$/)?.[1] ?? 0);
    const bi = Number(b.id.match(/chunk-(\d+)$/)?.[1] ?? 0);
    return ai - bi;
  });
}

/**
 * Load parsed chunks for RP. Re-parses from system_prompt when stored JSON is stale
 * (e.g. user added [외형] after chunks were first saved).
 */
export function loadCharacterChunks(row: CharacterSettingRow): CharacterChunk[] {
  const fresh = parseFreshCharacterChunks(row);
  const stored = deserializeCharacterChunks(row.setting_chunks);

  if (stored.length === 0) {
    if (fresh.length > 0) saveCharacterChunks(row.id, fresh);
    return fresh;
  }

  if (hashKoreanChunks(stored) !== hashKoreanChunks(fresh)) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[characterChunks] stale setting_chunks for character ${row.id} — re-parsing system_prompt`);
    }
    saveCharacterChunks(row.id, fresh);
    scheduleEnglishBackfill(row.id, fresh);
    return fresh;
  }

  return stored;
}

/** Read-only chunk load — never persists setting_chunks or schedules translation backfill. */
export function loadCharacterChunksReadOnly(row: CharacterSettingRow): CharacterChunk[] {
  const fresh = parseFreshCharacterChunks(row);
  const stored = deserializeCharacterChunks(row.setting_chunks);
  if (stored.length === 0) return fresh;
  if (hashKoreanChunks(stored) !== hashKoreanChunks(fresh)) return fresh;
  return stored;
}

export function saveCharacterChunks(characterId: number, chunks: CharacterChunk[]): void {
  const db = getDb();
  db.prepare("UPDATE characters SET setting_chunks=? WHERE id=?").run(
    serializeCharacterChunks(chunks),
    characterId
  );
}

export function buildCharacterChunksFromSafeRuntimeCanon(
  characterId: number,
  input: {
    name: string;
    gender: CharacterGender;
    safeRuntimeCanon: string;
    exampleDialog?: string;
  }
): CharacterChunk[] {
  return parseCharacterSetting({
    characterId: String(characterId),
    systemPrompt: input.safeRuntimeCanon,
    world: "",
    exampleDialog: input.exampleDialog ?? "",
    characterName: input.name,
    gender: input.gender,
  });
}

export function buildAndSaveCharacterChunks(
  characterId: number,
  input: {
    name: string;
    gender: CharacterGender;
    systemPrompt: string;
    world: string;
    exampleDialog: string;
    statusWindowPrompt?: string;
    speechInput?: SpeechCreatorInput;
    safeRuntimeCanon?: string;
  }
): CharacterChunk[] {
  const chunks = input.safeRuntimeCanon
    ? buildCharacterChunksFromSafeRuntimeCanon(characterId, {
        name: input.name,
        gender: input.gender,
        safeRuntimeCanon: input.safeRuntimeCanon,
        exampleDialog: input.exampleDialog,
      })
    : parseCharacterSetting({
        characterId: String(characterId),
        systemPrompt: input.systemPrompt,
        world: input.world,
        exampleDialog: input.exampleDialog,
        characterName: input.name,
        gender: input.gender,
      });
  saveCharacterChunks(characterId, chunks);
  persistSpeechProfile(characterId, {
    name: input.name,
    systemPrompt: input.systemPrompt,
    world: input.world,
    exampleDialog: input.exampleDialog,
    chunks,
    speechInput: input.speechInput,
  });
  return chunks;
}

/** Rebuild + persist setting_chunks only — no speech_profile side effects. */
export function rebuildAndSaveCharacterChunksOnly(
  characterId: number,
  input: {
    name: string;
    gender: CharacterGender;
    safeRuntimeCanon: string;
    exampleDialog?: string;
  }
): CharacterChunk[] {
  const chunks = buildCharacterChunksFromSafeRuntimeCanon(characterId, input);
  saveCharacterChunks(characterId, chunks);
  return chunks;
}

export type CharacterSettingChunksCanonicalRow = {
  name: string;
  gender?: string | null;
  system_prompt?: string | null;
  world?: string | null;
  example_dialog?: string | null;
  appearance_raw?: string | null;
  creator_compiled_description_json?: string | null;
  content_kind?: string | null;
};

/**
 * Atomically publish rebuilt setting_chunks only when canonical source and prior chunks match.
 * Never SELECT→unconditional UPDATE.
 */
export function casPublishCharacterSettingChunks(
  characterId: number,
  input: {
    expectedExistingSettingChunks: string;
    rebuiltChunks: CharacterChunk[];
    canonicalRow: CharacterSettingChunksCanonicalRow;
  }
): boolean {
  const db = getDb();
  const serialized = serializeCharacterChunks(input.rebuiltChunks);
  const row = input.canonicalRow;
  const updated = db
    .prepare(
      `UPDATE characters SET setting_chunks = ?
       WHERE id = ?
         AND setting_chunks = ?
         AND name = ?
         AND COALESCE(gender, 'other') = ?
         AND COALESCE(system_prompt, '') = ?
         AND COALESCE(world, '') = ?
         AND COALESCE(example_dialog, '') = ?
         AND COALESCE(appearance_raw, '') = ?
         AND COALESCE(creator_compiled_description_json, '') = ?
         AND COALESCE(content_kind, 'character') = ?`
    )
    .run(
      serialized,
      characterId,
      input.expectedExistingSettingChunks,
      row.name,
      row.gender ?? "other",
      row.system_prompt ?? "",
      row.world ?? "",
      row.example_dialog ?? "",
      row.appearance_raw ?? "",
      row.creator_compiled_description_json ?? "",
      row.content_kind ?? "character"
    );
  return updated.changes > 0;
}

/** 저장 후 Korean chunks + durable derived refresh job enqueue (no provider await). */
export function buildSaveCharacterChunksAndEnqueueDerivedRefresh(
  characterId: number,
  input: Parameters<typeof buildAndSaveCharacterChunks>[1],
  options?: { forceAppearanceRefresh?: boolean }
): CharacterChunk[] {
  const chunks = buildAndSaveCharacterChunks(characterId, input);
  const db = getDb();
  if (options?.forceAppearanceRefresh) {
    forceRequeueCharacterDerivedRefreshJob(db, characterId, {
      jobFlags: FORCE_APPEARANCE_JOB_FLAG,
    });
  } else {
    enqueueCharacterDerivedRefreshJob(db, characterId);
  }
  kickDerivedCacheWorker();
  return chunks;
}

/** @deprecated Use buildSaveCharacterChunksAndEnqueueDerivedRefresh for save paths. */
export async function buildSaveAndTranslateCharacterChunks(
  characterId: number,
  input: Parameters<typeof buildAndSaveCharacterChunks>[1]
): Promise<CharacterChunk[]> {
  return buildSaveCharacterChunksAndEnqueueDerivedRefresh(characterId, input);
}

/**
 * RP용 청크 로드 — 영문 번역본이 있으면 우선 사용, 없으면 한국어 + 백그라운드 번역 예약.
 */
export function loadCharacterChunksForPrompt(
  row: CharacterSettingRow,
  personaDisplayName: string,
  userNickname: string
): { chunks: CharacterChunk[]; usedEnglish: boolean } {
  const korean = loadCharacterChunks(row);
  const english = loadEnglishChunks(row, korean);
  if (!english && korean.length > 0) {
    scheduleEnglishBackfill(row.id, korean);
  }
  const base = english ? mergeEnglishLayerWithKoreanSpeech(english, korean) : korean;
  return {
    chunks: replaceUserPlaceholderInChunks(base, personaDisplayName, userNickname),
    usedEnglish: english !== null,
  };
}

/** Model picker dry-run — no character row writes or translation backfill. */
export function loadCharacterChunksForPromptReadOnly(
  row: CharacterSettingRow,
  personaDisplayName: string,
  userNickname: string
): { chunks: CharacterChunk[]; usedEnglish: boolean } {
  const korean = loadCharacterChunksReadOnly(row);
  const english = loadEnglishChunks(row, korean);
  const base = english ? mergeEnglishLayerWithKoreanSpeech(english, korean) : korean;
  return {
    chunks: replaceUserPlaceholderInChunks(base, personaDisplayName, userNickname),
    usedEnglish: english !== null,
  };
}

function persistSpeechProfile(
  characterId: number,
  input: {
    name: string;
    systemPrompt: string;
    world: string;
    exampleDialog: string;
    chunks: CharacterChunk[];
    speechInput?: SpeechCreatorInput;
  }
): void {
  const creatorPartial = input.speechInput
    ? buildCreatorSpeechProfilePartial(input.speechInput, input.name)
    : null;
  const profile = deriveSpeechProfile({
    charName: input.name,
    chunks: input.chunks,
    exampleDialog: input.exampleDialog,
    world: input.world,
    storedProfile: creatorPartial,
  });
  const db = getDb();
  db.prepare("UPDATE characters SET speech_profile=? WHERE id=?").run(
    serializeSpeechProfile(profile),
    characterId
  );
}

export function refreshSpeechProfileForCharacter(characterId: number): SpeechProfile | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, name, system_prompt, world, example_dialog, setting_chunks, speech_profile, creator_compiled_description_json FROM characters WHERE id=?"
    )
    .get(characterId) as CharacterSettingRow | undefined;
  if (!row) return null;
  const chunks = loadCharacterChunks(row);
  const profile = deriveSpeechProfile({
    charName: row.name,
    chunks,
    exampleDialog: row.example_dialog,
    world: row.world,
    storedProfile: parseStoredSpeechProfile(row.speech_profile),
  });
  db.prepare("UPDATE characters SET speech_profile=? WHERE id=?").run(
    serializeSpeechProfile(profile),
    characterId
  );
  return profile;
}

export function backfillCharacterChunks(characterId: number): CharacterChunk[] {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks, speech_profile, creator_compiled_description_json FROM characters WHERE id=?"
    )
    .get(characterId) as CharacterSettingRow | undefined;
  if (!row) return [];
  const chunks = loadCharacterChunks(row);
  if (!row.setting_chunks?.trim() && chunks.length > 0) {
    saveCharacterChunks(characterId, chunks);
  }
  return chunks;
}

export function loadSpeechProfile(row: CharacterSettingRow): SpeechProfile {
  const chunks = loadCharacterChunks(row);
  return deriveSpeechProfile({
    charName: row.name,
    chunks,
    exampleDialog: row.example_dialog,
    world: row.world,
    storedProfile: parseStoredSpeechProfile(row.speech_profile),
  });
}
