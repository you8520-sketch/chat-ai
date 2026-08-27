/**
 * PR #174 follow-up — shared persona save + secret compilation service.
 * POST /api/personas and PUT /api/personas/[id] must go through here.
 *
 * Response never includes secret source — only compile summary DTO.
 */
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { isPersonaSecretBoundaryEnabled } from "@/lib/personaSecretBoundaryPolicy";
import {
  compileAndApplyPersonaSecrets,
  hashPersonaSecretSource,
  toCompileSummaryDto,
  type PersonaSecretCompileSummaryDto,
} from "@/lib/personaSecretCompiler";
import { findSuccessfulCompilationRun } from "@/lib/personaSecretCompilerApply";
import { PERSONA_SECRET_COMPILER_VERSION } from "@/lib/personaSecretCompilerCatalog";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import type { CharacterGender } from "@/lib/characterGender";
import { getPersonaById } from "@/lib/userPersonas";
import { ensurePersonaSecretDiscoverySchema } from "@/lib/personaSecretDiscoverySchema";
import { deletePersonaSecretActivationRowsForPersona } from "@/lib/personaSecretLifecycleCleanup";

export type PersonaSecretInput =
  | { supplied: false }
  | { supplied: true; value: string };

export type PersonaSaveFields = {
  name: string;
  memo: string;
  gender: CharacterGender;
  description: string;
  /**
   * Legacy direct-service callers may still provide this value. API routes must
   * use secretInput to preserve omitted vs explicit-empty intent.
   */
  secret_description: string;
  secretInput?: PersonaSecretInput;
  image_url: string | null;
  image_focus_x: number;
  image_focus_y: number;
};

export type PersonaSaveWithSecretsResult = {
  ok: true;
  personaId: number;
  compile: PersonaSecretCompileSummaryDto | null;
  compilePreservedPrior: boolean;
} | { ok: false; error: string; status: number; code?: "SECRET_SETTINGS_DISABLED" };

/** Insert or update persona + compile secrets when Boundary ON and source changed. */
export function savePersonaWithSecretCompilation(opts: {
  userId: number;
  personaId?: number | null;
  fields: PersonaSaveFields;
  db?: Database.Database;
}): PersonaSaveWithSecretsResult {
  const db = opts.db ?? getDb();
  const f = opts.fields;

  if (!f.name) return { ok: false, error: "페르소나 이름을 입력하세요.", status: 400 };

  const existingId = opts.personaId ?? null;
  if (existingId != null) {
    const owned = db
      .prepare(`SELECT id FROM user_personas WHERE id=? AND user_id=?`)
      .get(existingId, opts.userId) as { id: number } | undefined;
    if (!owned) return { ok: false, error: "페르소나를 찾을 수 없습니다.", status: 404 };
  }

  const boundaryOn = isPersonaSecretBoundaryEnabled({ userId: opts.userId });
  const priorSource =
    existingId != null
      ? (getPersonaById(opts.userId, existingId)?.secret_description ?? "")
      : "";
  const secretInput: PersonaSecretInput = f.secretInput ?? {
    supplied: true,
    value: f.secret_description,
  };

  // Authorization is decided before the persona INSERT/UPDATE so a rejected
  // secret mutation can never partially save unrelated fields.
  if (
    !boundaryOn &&
    secretInput.supplied &&
    secretInput.value.trim() !== priorSource.trim()
  ) {
    return {
      ok: false,
      status: 403,
      code: "SECRET_SETTINGS_DISABLED",
      error: "비밀 설정은 현재 사용할 수 없습니다.",
    };
  }

  const newSource =
    boundaryOn && secretInput.supplied ? secretInput.value : priorSource;
  const sourceChanged = newSource.trim() !== priorSource.trim();

  let personaId: number;
  if (existingId == null) {
    const info = db
      .prepare(
        `INSERT INTO user_personas
         (user_id, name, memo, gender, description, secret_description, speech_examples, image_url, image_focus_x, image_focus_y)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        opts.userId,
        f.name,
        f.memo,
        f.gender,
        f.description,
        newSource,
        "",
        f.image_url ?? "",
        f.image_focus_x,
        f.image_focus_y
      );
    personaId = Number(info.lastInsertRowid);
  } else {
    db.prepare(
      `UPDATE user_personas
       SET name=?, memo=?, gender=?, description=?, secret_description=?,
           image_url=?, image_focus_x=?, image_focus_y=?
       WHERE id=? AND user_id=?`
    ).run(
      f.name,
      f.memo,
      f.gender,
      f.description,
      newSource,
      f.image_url,
      f.image_focus_x,
      f.image_focus_y,
      existingId,
      opts.userId
    );
    personaId = existingId;
  }

  let compile: PersonaSecretCompileSummaryDto | null = null;
  let compilePreservedPrior = false;
  if (boundaryOn) {
    // Compile when the source changed OR when the current source has no successful
    // compilation run — a prior attempt may have failed after the source was saved,
    // and an unchanged source must not leave compilation permanently unretried.
    const hasSuccessCache =
      !sourceChanged &&
      findSuccessfulCompilationRun({
        personaId,
        sourceHash: hashPersonaSecretSource(newSource),
        compilerVersion: PERSONA_SECRET_COMPILER_VERSION,
        db,
      }) != null;
    if (sourceChanged || !hasSuccessCache) {
      const result = compileAndApplyPersonaSecrets({
        personaId,
        source: newSource,
        userId: opts.userId,
        db,
      });
      if (result.ok) {
        compile = toCompileSummaryDto(result);
      } else {
        compilePreservedPrior = true;
      }
    }
  }

  return { ok: true, personaId, compile, compilePreservedPrior };
}

/** Remove all secret-related data for a persona (DELETE transaction). */
export function deletePersonaSecretData(
  personaId: number,
  db: Database.Database = getDb()
): void {
  ensurePersonaSecretDiscoverySchema(db);
  ensureInvestigationSchema(db);
  const secretIds = (
    db.prepare(`SELECT id FROM persona_secrets WHERE persona_id=?`).all(personaId) as Array<{ id: string }>
  ).map((r) => r.id);
  const placeholders = secretIds.length > 0 ? secretIds.map(() => "?").join(",") : null;

  // PERSONA investigation targets: delete linked results → attempts → targets,
  // in this order, so no attempt/result can keep referencing a removed target.
  const personaTargetIds = (
    db
      .prepare(`SELECT id FROM investigation_targets WHERE owner_scope='PERSONA' AND owner_id=?`)
      .all(String(personaId)) as Array<{ id: string }>
  ).map((r) => r.id);
  if (personaTargetIds.length > 0) {
    const targetPh = personaTargetIds.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM investigation_results
       WHERE target_id IN (${targetPh})
          OR attempt_id IN (
            SELECT id FROM investigation_attempts WHERE target_id IN (${targetPh})
          )`
    ).run(...personaTargetIds, ...personaTargetIds);
    db.prepare(
      `DELETE FROM investigation_attempts WHERE target_id IN (${targetPh})`
    ).run(...personaTargetIds);
  }
  db.prepare(`DELETE FROM investigation_targets WHERE owner_scope='PERSONA' AND owner_id=?`).run(String(personaId));

  db.prepare(`DELETE FROM persona_secret_discovery_rules WHERE secret_id IN (SELECT id FROM persona_secrets WHERE persona_id=?)`).run(personaId);
  db.prepare(`DELETE FROM persona_secret_compilation_runs WHERE persona_id=?`).run(personaId);
  // Activation overlay must go before evidence wipe (evidence_id PK).
  deletePersonaSecretActivationRowsForPersona(db, personaId);
  db.prepare(`DELETE FROM persona_secret_evidence_events WHERE persona_id=?`).run(personaId);
  db.prepare(`DELETE FROM chat_character_secret_knowledge WHERE persona_id=?`).run(personaId);
  db.prepare(`DELETE FROM knowledge_transfer_events WHERE persona_id=?`).run(personaId);
  db.prepare(`DELETE FROM chat_persona_secret_reveals WHERE persona_id=?`).run(personaId);
  if (placeholders) {
    db.prepare(`DELETE FROM persona_secret_evidence_events WHERE secret_id IN (${placeholders})`).run(...secretIds);
    db.prepare(`DELETE FROM chat_character_secret_knowledge WHERE secret_id IN (${placeholders})`).run(...secretIds);
    db.prepare(`DELETE FROM knowledge_transfer_events WHERE secret_id IN (${placeholders})`).run(...secretIds);
  }
  db.prepare(`DELETE FROM persona_secrets WHERE persona_id=?`).run(personaId);
}
