/**
 * Read-only production row loader for the PRECALL final-wire runner.
 *
 * It runs in the SAME process as the assembler (inside the approved Railway
 * container), so raw rows stay in memory and never reach stdout, an SSH stream,
 * a pipe, a log or a file. Only the runner's metadata output leaves the process.
 *
 * Guarantees: native node:sqlite readOnly:true + PRAGMA query_only=ON, one read
 * transaction, a fixed column list (no SELECT *), no write, no network.
 */
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import {
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  type RpQualityPrecallFxSnapshotRow,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";
import type {
  PrecallAssemblyRows,
  PrecallCharacterRow,
  PrecallPersonaRow,
  PrecallUserRow,
} from "./rpQualityPrecallFinalWire";

/** Exactly the character columns the assembler reads. Missing optional ones are skipped. */
export const PRECALL_CHARACTER_COLUMNS = [
  "id",
  "name",
  "description",
  "system_prompt",
  "world",
  "example_dialog",
  "greeting",
  "gender",
  "content_kind",
  "speech_profile",
  "speech_personality",
  "speech_traits",
  "narration_style_instructions",
  "jsx_components_json",
  "creator_compiled_description_json",
  "creator_canon_plan_json",
  "creator_raw_description",
  "adult_consent_modes_json",
  "status_widget_json",
  "status_widget_allow_user_override",
  "genres",
  "assets",
  "simulation_cast",
  "setting_chunks",
  "setting_chunks_en",
  "prompt_translation_hash",
  "appearance_raw",
  "appearance_compiled",
  "updated_at",
] as const;

const REQUIRED_CHARACTER_COLUMNS = ["id", "name", "greeting", "system_prompt", "world"] as const;

/** Reporting only: the process env already carries production's real values. */
const FLAG_NAME_ALLOW =
  /^(NODE_ENV$|CANON_|EPISODIC_|MEMORY_|PERSONA_SECRET_|RP_DIAGNOSTIC_|SCENE_DIRECTIVE|LIVING_SCENE|INTERACTIVE_USER_OWNERSHIP|AUTHORIAL_|COMPLETION_INTEGRITY|SCENE_BOUNDARY|ADULT_|SKIP_ADULT_VERIFICATION|PHASE\d|PROSE_|SHARED_NOVEL|SNPV2|GEMINI31|MUSE_|NARRATION_FEW_SHOT|REGISTER_PATCH|SPEECH_LOCK|EXAMPLE_DIALOG|USER_IMPERSONATION|REGENERATE_|GIBBERISH|STATUS_WIDGET_)/;
const FLAG_NAME_DENY = /KEY|SECRET$|TOKEN|PASSWORD|URL|EMAIL/i;

export class PrecallRowsStop extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PrecallRowsStop";
  }
}

function sha256(value: unknown): string {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function assertRows(condition: boolean, code: string): asserts condition {
  if (!condition) throw new PrecallRowsStop(code);
}

export type PrecallProductionRows = {
  proof: RpQualityPrecallLiveProofInput;
  rows: PrecallAssemblyRows;
  fx: RpQualityPrecallFxSnapshotRow;
  flags: Record<string, string>;
  dbReadOnly: true;
  queryOnly: true;
  singleReadTransaction: true;
};

export function collectAllowlistedFlags(env: NodeJS.ProcessEnv): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (FLAG_NAME_ALLOW.test(name) && !FLAG_NAME_DENY.test(name)) flags[name] = String(value ?? "");
  }
  return flags;
}

export function loadPrecallProductionRows(input: {
  dbPath: string;
  deployedGitSha: string;
  env: NodeJS.ProcessEnv;
}): PrecallProductionRows {
  const deployedGitSha = input.deployedGitSha.trim();
  assertRows(/^[a-f0-9]{40}$/i.test(deployedGitSha), "DEPLOY_SHA_INVALID");
  const target = RP_QUALITY_PRECALL_TARGET_SELECTOR;

  let db: DatabaseSync | null = null;
  let txOpen = false;
  try {
    db = new DatabaseSync(input.dbPath, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    const queryOnly = db.prepare("PRAGMA query_only").get() as { query_only?: number } | undefined;
    assertRows(queryOnly?.query_only === 1, "QUERY_ONLY_NOT_ENABLED");
    db.exec("BEGIN DEFERRED");
    txOpen = true;

    const existing = new Set(
      (db.prepare("PRAGMA table_info(characters)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    for (const column of REQUIRED_CHARACTER_COLUMNS) {
      assertRows(existing.has(column), "CHARACTER_COLUMN_MISSING");
    }
    const selected = PRECALL_CHARACTER_COLUMNS.filter((column) => existing.has(column));
    const characterRows = db
      .prepare(`SELECT ${selected.join(", ")} FROM characters WHERE id = ?`)
      .all(target.characterId) as unknown as PrecallCharacterRow[];
    assertRows(characterRows.length === 1, "CHARACTER_ROW_COUNT_INVALID");
    const character = characterRows[0]!;
    assertRows(
      Number(character.id) === target.characterId && String(character.name ?? "").trim() === target.characterName,
      "CHARACTER_IDENTITY_MISMATCH"
    );

    const allowEmails = String(input.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const adminRows = (
      allowEmails.length
        ? db
            .prepare(
              `SELECT id FROM users WHERE COALESCE(account_kind,'') <> 'portone_reviewer' AND (is_admin = 1 OR lower(email) IN (${allowEmails
                .map(() => "?")
                .join(",")})) ORDER BY id ASC`
            )
            .all(...allowEmails)
        : db
            .prepare(
              "SELECT id FROM users WHERE COALESCE(account_kind,'') <> 'portone_reviewer' AND is_admin = 1 ORDER BY id ASC"
            )
            .all()
    ) as Array<{ id: number }>;
    const adminIds = [...new Set(adminRows.map((row) => Number(row.id)))];
    assertRows(adminIds.length === 1, "ADMIN_IDENTITY_AMBIGUOUS");

    const personas = db
      .prepare(
        `SELECT id, name, gender, description, active_status_widget_preset_id,
            COALESCE((
              SELECT preset.widget_json
              FROM user_status_widget_presets preset
              WHERE preset.id=user_personas.active_status_widget_preset_id
                AND preset.user_id=user_personas.user_id
            ), '') AS active_status_widget_json
         FROM user_personas WHERE user_id = ? AND name = ? ORDER BY id ASC`
      )
      .all(adminIds[0]!, target.personaName) as unknown as PrecallPersonaRow[];
    assertRows(personas.length === 1, "PERSONA_COUNT_INVALID");
    const persona = personas[0]!;

    const user = db
      .prepare("SELECT id, nickname, user_note, sub_until, sub_plan FROM users WHERE id = ?")
      .get(adminIds[0]!) as unknown as PrecallUserRow;
    assertRows(Boolean(user), "USER_ROW_MISSING");

    const attachments = Number(
      (
        db
          .prepare("SELECT COUNT(*) n FROM character_lorebook_attachments WHERE character_id = ?")
          .get(target.characterId) as { n: number }
      ).n
    );
    const globalLorebook = db
      .prepare(
        `SELECT id, name, triggers_json, content, depth, enabled, sort_order
         FROM global_lorebook_entries WHERE enabled = 1 ORDER BY depth ASC, sort_order ASC, id ASC`
      )
      .all() as unknown as PrecallAssemblyRows["globalLorebook"];
    const fx =
      (db
        .prepare(
          `SELECT date_key, base_usd_krw, source, fetched_at
           FROM billing_fx_daily_snapshots ORDER BY date_key DESC LIMIT 1`
        )
        .get() as RpQualityPrecallFxSnapshotRow | undefined) ?? null;

    db.exec("ROLLBACK");
    txOpen = false;

    const personaPublic = toPublicPersonaDescription(persona.description ?? "");
    return {
      proof: {
        source: "railway-production-readonly-in-process-v1",
        generatedAt: new Date().toISOString(),
        deployedGitSha,
        characterId: Number(character.id),
        characterName: String(character.name ?? "").trim(),
        personaId: Number(persona.id),
        personaName: String(persona.name ?? "").trim(),
        personaGender: String(persona.gender ?? ""),
        personaPublicChars: personaPublic.length,
        greetingSha256: sha256(character.greeting),
        systemPromptSha256: sha256(character.system_prompt),
        worldSha256: sha256(character.world),
        settingChunksSha256: sha256(character.setting_chunks),
        personaPublicSha256: sha256(personaPublic),
        authoringLevel: "NORMAL",
        contentMode: "SAFE",
      },
      rows: {
        character,
        persona,
        user,
        creatorLorebookAttachments: attachments,
        globalLorebook,
      },
      fx,
      flags: collectAllowlistedFlags(input.env),
      dbReadOnly: true,
      queryOnly: true,
      singleReadTransaction: true,
    };
  } finally {
    if (db && txOpen) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // read-only connection: nothing to undo
      }
    }
    try {
      db?.close();
    } catch {
      // already closed
    }
  }
}
