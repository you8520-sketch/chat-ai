/**
 * Audit-only helpers for handoff benchmark capsule export/import.
 * NEVER import from production runtime (src/).
 */

import crypto from "crypto";

export const CAPSULE_SCHEMA_VERSION = 2;

/**
 * Step 1 conclusion (verified against src/app/api/chat/route.ts,
 * src/lib/userPersonas.ts, src/lib/personaSecretBoundaryPolicy.ts,
 * src/lib/isAdminUser.ts):
 *
 * ADMIN_STATUS_AFFECTS_PERSONA_PROMPT = false
 *
 * is_admin / ADMIN_EMAILS affect adult handoff canary and billing receipt
 * visibility only — not persona prompt text assembly.
 */
export const ADMIN_STATUS_AFFECTS_PERSONA_PROMPT = false;

/**
 * Character columns that affect prompt/context generation.
 * Excludes lorebook_id — that FK is identity, not prompt semantics.
 * Resolved keyword lorebook content is hashed separately.
 */
export const CHARACTER_ROW_PROMPT_FIELDS = [
  "name",
  "gender",
  "description",
  "greeting",
  "system_prompt",
  "world",
  "example_dialog",
  "setting_chunks",
  "setting_chunks_en",
  "prompt_translation_hash",
  "speech_profile",
  "creator_compiled_description_json",
  "appearance_raw",
  "appearance_compiled",
  "creator_raw_description",
  "creator_canon_plan_json",
  "genres",
  "assets",
  "content_kind",
  "simulation_cast",
  "adult_dialogue_profile",
  "adult_status",
  "participant_min_age",
  "adult_consent_modes_json",
  "status_widget_json",
  "status_window_prompt",
  "status_widget_allow_user_override",
  "nsfw",
];

/** @deprecated use CHARACTER_ROW_PROMPT_FIELDS — lorebook_id is not prompt semantics */
export const CHARACTER_PROMPT_FIELDS = CHARACTER_ROW_PROMPT_FIELDS;

/** Keyword lorebook row content referenced by characters.lorebook_id. */
export const CHARACTER_KEYWORD_LOREBOOK_FIELD = "keyword_lorebook_entries_json";

/**
 * Persona columns assembled into RP persona prompt (public + secret boundary).
 * memo, speech_examples, image_* are not used on the main chat persona path.
 */
export const PERSONA_PROMPT_FIELDS = [
  "name",
  "gender",
  "description",
  "secret_description",
];

/**
 * User account fields that affect prompt assembly but are not persona row data.
 * nickname: replaceUserPlaceholderInChunks + personaDisplayName fallback
 * is_adult: adult eligibility routing (not persona text)
 */
export const BENCHMARK_USER_CONTEXT_FIELDS = ["nickname", "is_adult"];

/** Fields used only for export safety checks — never written to capsule payload. */
export const CHARACTER_LISTABILITY_FIELDS = [
  "official",
  "visibility",
  "moderation_status",
  "creator_id",
];

export const LISTABLE_WHERE_SQL = `(official=1 OR (visibility='public' AND moderation_status='approved' AND creator_id IS NOT NULL))`;

const NULLABLE_INT_FIELDS = new Set(["participant_min_age", "nsfw"]);

export function parseArgs(argv) {
  const positional = [];
  const env = { ...process.env };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        env[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        env[arg.slice(2)] = argv[++i];
      } else {
        env[arg.slice(2)] = "1";
      }
    } else {
      positional.push(arg);
    }
  }
  return { env, positional };
}

export function requirePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer (got ${value})`);
  }
  return n;
}

export function isAdminUser(row, env = process.env) {
  if (row.is_admin === 1) return true;
  const allow = env.ADMIN_EMAILS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allow?.length) return false;
  return allow.includes(String(row.email ?? "").toLowerCase());
}

export function isCharacterListable(row) {
  if (Number(row.official) === 1) return true;
  return (
    row.visibility === "public" &&
    row.moderation_status === "approved" &&
    row.creator_id != null
  );
}

export function normalizeSqlValue(key, value) {
  if (value === undefined || value === null) {
    return NULLABLE_INT_FIELDS.has(key) ? null : "";
  }
  if (NULLABLE_INT_FIELDS.has(key)) {
    if (value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

export function pickFields(record, fields) {
  const out = {};
  for (const key of fields) {
    out[key] = normalizeSqlValue(key, record[key]);
  }
  return out;
}

/**
 * Stable JSON SHA-256 for prompt-relevant records.
 * Keys sorted; null/int/string normalized for SQLite round-trip.
 */
export function sha256PromptPayload(fields, record, extra = {}) {
  const payload = { ...pickFields(record, fields), ...extra };
  const sortedKeys = Object.keys(payload).sort();
  const canonical = {};
  for (const key of sortedKeys) {
    const val = payload[key];
    canonical[key] = val === undefined ? null : val;
  }
  return crypto.createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

function normalizeKeywordLorebookPayload(keywordLorebookEntriesJson) {
  if (keywordLorebookEntriesJson == null) return null;
  const trimmed = String(keywordLorebookEntriesJson).trim();
  return trimmed ? keywordLorebookEntriesJson : null;
}

/**
 * Character prompt fidelity hash:
 * CHARACTER_ROW_PROMPT_FIELDS + resolved keyword lorebook content.
 * Does NOT include lorebook_id.
 */
export function buildCharacterPromptHash(characterRow, keywordLorebookEntriesJson = null) {
  return sha256PromptPayload(CHARACTER_ROW_PROMPT_FIELDS, characterRow, {
    [CHARACTER_KEYWORD_LOREBOOK_FIELD]: normalizeKeywordLorebookPayload(keywordLorebookEntriesJson),
  });
}

export function buildPersonaPromptHash(personaRow) {
  return sha256PromptPayload(PERSONA_PROMPT_FIELDS, personaRow);
}

export function buildBenchmarkUserContextHash(userRow) {
  return sha256PromptPayload(BENCHMARK_USER_CONTEXT_FIELDS, userRow);
}

export function loadKeywordLorebookEntries(db, lorebookId) {
  if (lorebookId == null || !Number.isFinite(Number(lorebookId)) || Number(lorebookId) <= 0) {
    return null;
  }
  const row = db
    .prepare("SELECT entries_json FROM keyword_lorebooks WHERE id = ?")
    .get(lorebookId);
  return row?.entries_json ?? null;
}

export function tableExists(db, name) {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return !!row;
}

export function insertUnrelatedKeywordLorebook(db, name = "unrelated-preseed-lorebook") {
  const result = db
    .prepare(
      `INSERT INTO keyword_lorebooks (creator_id, name, summary, entries_json)
       VALUES (0, ?, '', '[]')`
    )
    .run(name);
  return Number(result.lastInsertRowid);
}
