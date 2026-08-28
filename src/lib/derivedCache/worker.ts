import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  buildAndSaveCharacterChunks,
  loadCharacterChunks,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import {
  compileAppearanceForChat,
  hashAppearanceRaw,
  serializeAppearanceCompiledJson,
  APPEARANCE_COMPILED_VERSION,
  replaceAppearanceInSetting,
} from "@/lib/appearanceCompiler";
import { isAppearanceCompiledCurrent, resolveAppearancePromptText } from "@/lib/derivedCache/appearanceCurrentness";
import { completeDerivedCacheJob, type DerivedCacheJobRow } from "@/lib/derivedCache/jobs";
import { translateCharacterChunksForDerivedRefresh } from "@/lib/derivedCache/characterTranslation";
import { refreshWorldEnglishCache, refreshWorldShareEnglishCache } from "@/lib/derivedCache/worldTranslation";
import { TRANSLATION_DERIVATION_VERSION } from "@/lib/derivedCache/versions";
import { parseCharacterGender } from "@/lib/characterGender";
import {
  compiledPublicCanonText,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";
import { speechCreatorFromLegacyExampleDialog } from "@/lib/speechCreatorFields";
import { koreanChunksTranslationFingerprint } from "@/lib/promptTranslation";

type CharacterDerivedRow = CharacterSettingRow & {
  content_kind?: string | null;
  source_world_share_id?: number | null;
};

function loadCharacterSettingRow(db: Database.Database, characterId: number): CharacterDerivedRow | null {
  return (
    (db
      .prepare(
        `SELECT id, name, gender, system_prompt, world, example_dialog, setting_chunks,
                creator_compiled_description_json, appearance_raw, appearance_compiled,
                appearance_compiled_source_hash, appearance_compiled_version,
                content_kind, source_world_share_id
         FROM characters WHERE id=?`
      )
      .get(characterId) as CharacterDerivedRow | undefined) ?? null
  );
}

function casPublishAppearanceCompiled(
  db: Database.Database,
  characterId: number,
  expectedSourceHash: string,
  compiledJson: string
): boolean {
  const row = db
    .prepare(`SELECT appearance_raw FROM characters WHERE id = ?`)
    .get(characterId) as { appearance_raw: string | null } | undefined;
  if (!row || hashAppearanceRaw(row.appearance_raw ?? "") !== expectedSourceHash) {
    return false;
  }
  const updated = db
    .prepare(
      `UPDATE characters
       SET appearance_compiled = ?,
           appearance_compiled_source_hash = ?,
           appearance_compiled_version = ?
       WHERE id = ?`
    )
    .run(compiledJson, expectedSourceHash, APPEARANCE_COMPILED_VERSION, characterId);
  return updated.changes > 0;
}

function rebuildSafeRuntimeCanon(row: CharacterDerivedRow): string {
  const compiled = parseCreatorDescriptionCompiled(row.creator_compiled_description_json);
  const publicCanon = compiledPublicCanonText(compiled);
  const appearanceText = resolveAppearancePromptText({
    raw: row.appearance_raw ?? "",
    compiledJson: row.appearance_compiled,
    compiledSourceHash: row.appearance_compiled_source_hash,
    compiledVersion: row.appearance_compiled_version,
  });
  return replaceAppearanceInSetting(publicCanon, appearanceText);
}

async function processCharacterDerivedRefresh(
  db: Database.Database,
  job: DerivedCacheJobRow
): Promise<{ ok: true } | { ok: false; error: string; retryable?: boolean }> {
  const row = loadCharacterSettingRow(db, job.entity_id);
  if (!row) return { ok: false, error: "character_not_found", retryable: false };

  const chunks = loadCharacterChunks(row);
  const currentFingerprint = koreanChunksTranslationFingerprint(chunks);
  if (currentFingerprint !== job.source_fingerprint) {
    return { ok: true };
  }

  const contentKind = row.content_kind ?? "character";
  const appearanceRaw = row.appearance_raw ?? "";

  if (contentKind !== "simulation" && appearanceRaw.trim()) {
    const needsCompile = !isAppearanceCompiledCurrent({
      raw: appearanceRaw,
      compiledJson: row.appearance_compiled,
      compiledSourceHash: row.appearance_compiled_source_hash,
      compiledVersion: row.appearance_compiled_version,
    });
    if (needsCompile) {
      const sourceHash = hashAppearanceRaw(appearanceRaw);
      const compiled = await compileAppearanceForChat(appearanceRaw);
      if (compiled) {
        casPublishAppearanceCompiled(
          db,
          job.entity_id,
          sourceHash,
          serializeAppearanceCompiledJson(compiled)
        );
      }
    }
  }

  const refreshed = loadCharacterSettingRow(db, job.entity_id);
  if (!refreshed) return { ok: false, error: "character_not_found", retryable: false };

  const safeRuntimeCanon = rebuildSafeRuntimeCanon(refreshed);
  const gender = parseCharacterGender(refreshed.gender) ?? "other";
  const speech = speechCreatorFromLegacyExampleDialog(refreshed.example_dialog ?? "");

  const rebuilt = buildAndSaveCharacterChunks(job.entity_id, {
    name: refreshed.name,
    gender,
    systemPrompt: refreshed.system_prompt ?? "",
    world: refreshed.world ?? "",
    exampleDialog: refreshed.example_dialog ?? "",
    safeRuntimeCanon,
    speechInput: speech,
  });

  const rebuiltFingerprint = koreanChunksTranslationFingerprint(rebuilt);
  if (rebuiltFingerprint !== job.source_fingerprint) {
    return { ok: true };
  }

  db.prepare(`UPDATE characters SET prompt_translation_hash=? WHERE id=?`).run(
    rebuiltFingerprint,
    job.entity_id
  );

  const translated = await translateCharacterChunksForDerivedRefresh(job.entity_id, rebuilt);
  if (!translated) {
    return { ok: false, error: "character_translation_failed", retryable: true };
  }
  return { ok: true };
}

export async function processDerivedCacheJob(
  db: Database.Database,
  job: DerivedCacheJobRow
): Promise<void> {
  if (job.derivation_version !== TRANSLATION_DERIVATION_VERSION) {
    completeDerivedCacheJob(db, job.id, {
      ok: false,
      error: "derivation_version_mismatch",
      retryable: false,
    });
    return;
  }

  try {
    let outcome: { ok: true } | { ok: false; error: string; retryable?: boolean };
    switch (job.job_kind) {
      case "character_derived_refresh":
        outcome = await processCharacterDerivedRefresh(db, job);
        break;
      case "world_translate":
        outcome = await refreshWorldEnglishCache(db, job.entity_id, job.source_fingerprint);
        break;
      case "world_share_translate":
        outcome = await refreshWorldShareEnglishCache(db, job.entity_id, job.source_fingerprint);
        break;
      default: {
        const unknownKind: never = job.job_kind;
        outcome = { ok: false, error: `unknown_job_kind:${String(unknownKind)}`, retryable: false };
      }
    }
    completeDerivedCacheJob(db, job.id, outcome);
  } catch (err) {
    completeDerivedCacheJob(db, job.id, {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: true,
    });
  }
}

export async function drainDerivedCacheJobsForTests(db = getDb(), maxJobs = 10): Promise<number> {
  const { claimNextDerivedCacheJob } = await import("@/lib/derivedCache/jobs");
  let processed = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = claimNextDerivedCacheJob(db);
    if (!job) break;
    await processDerivedCacheJob(db, job);
    processed++;
  }
  return processed;
}
