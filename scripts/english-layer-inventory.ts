/**
 * Character English Layer inventory / controlled backfill.
 *
 * READ-ONLY default:
 *   npx tsx scripts/english-layer-inventory.ts
 *
 * Apply one character (writes setting_chunks Korean if generated, then EN layer):
 *   npx tsx scripts/english-layer-inventory.ts --apply=18
 *
 * Never overwrites system_prompt / world.
 */
import { getDb } from "../src/lib/db";
import {
  classifyEnglishLayer,
  hashKoreanChunks,
  isTranslatableChunk,
  loadEnglishChunks,
  resolveTranslationModels,
  translateAndSaveCharacterPromptEn,
} from "../src/lib/promptTranslation";
import {
  loadCharacterChunksReadOnly,
  saveCharacterChunks,
  type CharacterSettingRow,
} from "../src/lib/characterChunks";

const FOCUS_IDS = [18, 14, 1, 4, 6, 7, 8, 9];

function parseApplyId(): number | null {
  const arg = process.argv.find((a) => a.startsWith("--apply="));
  if (!arg) return null;
  const id = Number(arg.slice("--apply=".length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function loadRow(id: number): CharacterSettingRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, name, gender, system_prompt, world, example_dialog, status_window_prompt,
              setting_chunks, setting_chunks_en, prompt_translation_hash, speech_profile,
              creator_compiled_description_json, appearance_raw, appearance_compiled
       FROM characters WHERE id=?`
    )
    .get(id) as CharacterSettingRow | undefined;
}

function inspectCharacter(id: number) {
  const row = loadRow(id);
  if (!row) {
    return { id, name: null, status: "NOT_FOUND" as const };
  }
  const korean = loadCharacterChunksReadOnly(row);
  const status = classifyEnglishLayer({
    koreanChunks: korean,
    settingChunksEn: row.setting_chunks_en,
    promptTranslationHash: row.prompt_translation_hash,
  });
  const english = loadEnglishChunks(row, korean);
  return {
    id,
    name: row.name,
    status,
    koreanChunkCount: korean.length,
    translatableCount: korean.filter(isTranslatableChunk).length,
    speechCount: korean.filter((c) => c.category === "speech").length,
    hasStoredKoreanChunks: !!row.setting_chunks?.trim() && row.setting_chunks.trim() !== "[]",
    currentHash: korean.length ? hashKoreanChunks(korean) : null,
    storedHash: row.prompt_translation_hash || null,
    loadEnglishChunks: english ? "present" : "null",
    usedEnglishCharacterPrompt: english !== null,
    systemPromptChars: row.system_prompt?.length ?? 0,
    worldChars: row.world?.length ?? 0,
  };
}

async function applyCharacter(id: number) {
  const row = loadRow(id);
  if (!row) {
    return { id, ok: false, reason: "NOT_FOUND" };
  }
  const korean = loadCharacterChunksReadOnly(row);
  if (korean.filter(isTranslatableChunk).length === 0) {
    return { id, ok: false, reason: "NO_TRANSLATABLE_CONTENT" };
  }
  if (!row.setting_chunks?.trim() || row.setting_chunks.trim() === "[]") {
    saveCharacterChunks(id, korean);
  }
  const ok = await translateAndSaveCharacterPromptEn(id, korean);
  const after = inspectCharacter(id);
  return { id, ok, after };
}

async function main() {
  const applyId = parseApplyId();
  console.log(
    JSON.stringify(
      {
        models: resolveTranslationModels(),
        applyId,
      },
      null,
      2
    )
  );

  if (applyId != null) {
    const result = await applyCharacter(applyId);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const db = getDb();
  const ids = (
    db.prepare("SELECT id FROM characters ORDER BY id").all() as { id: number }[]
  ).map((r) => r.id);
  const rows = ids.map(inspectCharacter);
  const counts = {
    CURRENT: rows.filter((r) => r.status === "CURRENT").length,
    STALE: rows.filter((r) => r.status === "STALE").length,
    MISSING: rows.filter((r) => r.status === "MISSING").length,
    NO_TRANSLATABLE_CONTENT: rows.filter((r) => r.status === "NO_TRANSLATABLE_CONTENT").length,
    NOT_FOUND: rows.filter((r) => r.status === "NOT_FOUND").length,
  };
  const focus = FOCUS_IDS.map(inspectCharacter);
  console.log(
    JSON.stringify(
      {
        counts,
        focus,
        total: rows.length,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
