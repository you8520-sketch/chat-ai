import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  buildCharacterChunksFromSafeRuntimeCanon,
  casPublishCharacterSettingChunks,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { deserializeCharacterChunks } from "@/utils/characterParser";
import {
  compileAppearanceForChat,
  hashAppearanceRaw,
  serializeAppearanceCompiledJson,
  APPEARANCE_COMPILED_VERSION,
  replaceAppearanceInSetting,
} from "@/lib/appearanceCompiler";
import { isAppearanceCompiledCurrent, resolveAppearancePromptText } from "@/lib/derivedCache/appearanceCurrentness";
import { characterCanonicalSourceFingerprintFromRow } from "@/lib/derivedCache/characterSourceFingerprint";
import { FORCE_APPEARANCE_JOB_FLAG } from "@/lib/derivedCache/characterEnqueue";
import { completeDerivedCacheJob, type DerivedCacheJobRow } from "@/lib/derivedCache/jobs";
import { translateCharacterChunksForDerivedRefresh } from "@/lib/derivedCache/characterTranslation";
import { refreshWorldEnglishCache, refreshWorldShareEnglishCache } from "@/lib/derivedCache/worldTranslation";
import { TRANSLATION_DERIVATION_VERSION } from "@/lib/derivedCache/versions";
import { parseCharacterGender } from "@/lib/characterGender";
import {
  compiledPublicCanonText,
  parseCreatorDescriptionCompiled,
} from "@/lib/creatorDescriptionTriggerCompiler";

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

function jobHasForceAppearance(job: DerivedCacheJobRow): boolean {
  return (job.job_flags ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(FORCE_APPEARANCE_JOB_FLAG);
}

function casPublishAppearanceCompiled(
  db: Database.Database,
  characterId: number,
  expectedRaw: string,
  compiledJson: string
): boolean {
  const sourceHash = hashAppearanceRaw(expectedRaw);
  const updated = db
    .prepare(
      `UPDATE characters
       SET appearance_compiled = ?,
           appearance_compiled_source_hash = ?,
           appearance_compiled_version = ?
       WHERE id = ?
         AND appearance_raw = ?`
    )
    .run(compiledJson, sourceHash, APPEARANCE_COMPILED_VERSION, characterId, expectedRaw);
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

  const canonicalFingerprint = characterCanonicalSourceFingerprintFromRow(row);
  if (canonicalFingerprint !== job.source_fingerprint) {
    return { ok: true };
  }

  const contentKind = row.content_kind ?? "character";
  const appearanceRaw = row.appearance_raw ?? "";
  const forceAppearance = jobHasForceAppearance(job);

  if (contentKind !== "simulation" && appearanceRaw.trim()) {
    const needsCompile =
      forceAppearance ||
      !isAppearanceCompiledCurrent({
        raw: appearanceRaw,
        compiledJson: row.appearance_compiled,
        compiledSourceHash: row.appearance_compiled_source_hash,
        compiledVersion: row.appearance_compiled_version,
      });
    if (needsCompile) {
      const compiled = await compileAppearanceForChat(appearanceRaw);
      if (compiled) {
        casPublishAppearanceCompiled(
          db,
          job.entity_id,
          appearanceRaw,
          serializeAppearanceCompiledJson(compiled)
        );
      }
    }
  }

  const refreshed = loadCharacterSettingRow(db, job.entity_id);
  if (!refreshed) return { ok: false, error: "character_not_found", retryable: false };

  const refreshedCanonical = characterCanonicalSourceFingerprintFromRow(refreshed);
  if (refreshedCanonical !== job.source_fingerprint) {
    return { ok: true };
  }

  const safeRuntimeCanon = rebuildSafeRuntimeCanon(refreshed);
  const gender = parseCharacterGender(refreshed.gender) ?? "other";
  const expectedExistingSettingChunks = refreshed.setting_chunks?.trim() || "[]";
  const rebuiltChunks = buildCharacterChunksFromSafeRuntimeCanon(job.entity_id, {
    name: refreshed.name,
    gender,
    safeRuntimeCanon,
    exampleDialog: refreshed.example_dialog ?? "",
  });

  const published = casPublishCharacterSettingChunks(job.entity_id, {
    expectedExistingSettingChunks,
    rebuiltChunks,
    canonicalRow: refreshed,
  });

  let chunksForTranslation = rebuiltChunks;
  if (!published) {
    const reloaded = loadCharacterSettingRow(db, job.entity_id);
    if (!reloaded || characterCanonicalSourceFingerprintFromRow(reloaded) !== job.source_fingerprint) {
      return { ok: true };
    }
    const currentChunks = deserializeCharacterChunks(reloaded.setting_chunks ?? "[]");
    if (currentChunks.length === 0) {
      return { ok: false, error: "character_translation_failed", retryable: true };
    }
    chunksForTranslation = currentChunks;
  }

  const translated = await translateCharacterChunksForDerivedRefresh(
    job.entity_id,
    chunksForTranslation
  );
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

export { casPublishAppearanceCompiled, loadCharacterSettingRow };
