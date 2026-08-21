import "server-only";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getDb } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdminUser";
import {
  loadCharacterChunksForPromptReadOnly,
  type CharacterSettingRow,
} from "@/lib/characterChunks";
import { resolveExampleDialogForPrompt } from "@/lib/narrationFewShotTemplates";
import { parseStoredSpeechProfile } from "@/lib/speechLock";
import { getPersonaById } from "@/lib/userPersonas";
import { formatPublicPersonaForPrompt } from "@/lib/personaSecretPrompt";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";

export const HANDOFF_AUDIT_EXPORT_ENABLED_ENV = "HANDOFF_AUDIT_EXPORT_ENABLED";
export const HANDOFF_AUDIT_PRIVATE_DIR = "/data/handoff-audit-exports";
export const FLOOD_AUDIT_EXACT_NAME = "플러드";

export type HandoffAuditExportMode = "snapshot" | "resolve-character" | "resolve-admin-personas";

export type HandoffAuditCharacterCandidate = {
  id: number;
  name: string;
  official: number;
  creator_id: number | null;
  nsfw: number;
  visibility: string;
  moderation_status: string;
};

export type HandoffAuditPersonaCandidate = {
  personaId: number;
  name: string;
  createdAt: string;
  inUse: boolean;
};

export type HandoffAuditHashedField = {
  sha256: string;
  chars: number;
};

export type HandoffAuditSnapshot = {
  SNAPSHOT_ID: string;
  PRODUCTION_RECORD_PROVEN: boolean;
  FLOOD_PRODUCTION_RECORD_PROVEN: boolean;
  ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: boolean;
  database_source: "live_production" | "local_non_production";
  snapshot_timestamp: string;
  CHARACTER_SHA: string;
  PERSONA_SHA: string;
  SPEECH_LOCK_SHA: string;
  WORLD_CANON_SHA: string;
  loaders: string[];
  character: {
    id: number;
    name: string;
    official: number;
    creator_id: number | null;
    nsfw: number;
    visibility: string;
    moderation_status: string;
    content_kind: string;
    gender: string;
    fields: Record<string, string>;
    hashes: Record<string, HandoffAuditHashedField>;
  };
  persona: {
    id: number;
    user_id: number;
    owner_email: string;
    name: string;
    gender: string;
    fields: Record<string, string>;
    hashes: Record<string, HandoffAuditHashedField>;
    formatted_public_prompt: string | null;
  };
  speech_lock: {
    fields: Record<string, string>;
    hashes: Record<string, HandoffAuditHashedField>;
  };
  world_canon: {
    fields: Record<string, string>;
    hashes: Record<string, HandoffAuditHashedField>;
  };
  prompt_relevant_config: {
    greeting_chars: number;
    example_dialog_prompt_chars: number;
    used_english_character_prompt: boolean;
    chunk_count: number;
    adult_dialogue_profile_chars: number;
    adult_status_chars: number;
    simulation_cast_chars: number;
    speech_examples_consumed_by_buildContext: false;
  };
};

type CharacterPromptRow = CharacterSettingRow & {
  description?: string | null;
  greeting?: string | null;
  nsfw?: number | null;
  official?: number | null;
  creator_id?: number | null;
  visibility?: string | null;
  moderation_status?: string | null;
  genres?: string | null;
  speech_personality?: string | null;
  speech_traits?: string | null;
  content_kind?: string | null;
  simulation_cast?: string | null;
  adult_dialogue_profile?: string | null;
  adult_status?: string | null;
};

function sha256Text(value: string): HandoffAuditHashedField {
  return {
    sha256: crypto.createHash("sha256").update(value, "utf8").digest("hex"),
    chars: value.length,
  };
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function runtimeEnv(name: string): string {
  const env = globalThis.process?.env;
  if (!env) return "";
  return String(env[name] ?? "").trim();
}

export function isHandoffAuditExportEnabled(): boolean {
  const raw = runtimeEnv(HANDOFF_AUDIT_EXPORT_ENABLED_ENV).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isLiveProductionDatabase(): boolean {
  const env = (
    runtimeEnv("RAILWAY_ENVIRONMENT_NAME") || runtimeEnv("RAILWAY_ENVIRONMENT")
  ).toLowerCase();
  const mounted =
    runtimeEnv("RAILWAY_VOLUME_MOUNT_PATH") === "/data" || runtimeEnv("DATA_DIR") === "/data";
  return env === "production" && mounted;
}

export function requestHandoffAuditExportToken(req: Request): string {
  const headerToken = req.headers.get("x-admin-debug-token")?.trim() ?? "";
  if (headerToken) return headerToken;
  const auth = req.headers.get("authorization") ?? "";
  return auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

export function authorizeHandoffAuditExport(req: Request): boolean {
  if (!isHandoffAuditExportEnabled()) return false;
  const expected = runtimeEnv("ADMIN_DEBUG_TOKEN");
  if (!expected) return false;
  return requestHandoffAuditExportToken(req) === expected;
}

export function parseHandoffAuditExportMode(raw: string | null): HandoffAuditExportMode | null {
  switch (raw) {
    case "snapshot":
    case "resolve-character":
    case "resolve-admin-personas":
      return raw;
    case null:
    case "":
      return "snapshot";
    default:
      return null;
  }
}

export function resolveHandoffAuditCharacterCandidates(
  exactName: string
): HandoffAuditCharacterCandidate[] {
  const name = exactName.trim();
  if (!name) return [];
  return getDb()
    .prepare(
      `SELECT id, name, official, creator_id, nsfw, visibility, moderation_status
       FROM characters
       WHERE name = ?
       ORDER BY id ASC`
    )
    .all(name) as HandoffAuditCharacterCandidate[];
}

export function resolveHandoffAuditAdminPersonaCandidates(): HandoffAuditPersonaCandidate[] {
  const allowEmails = runtimeEnv("ADMIN_EMAILS")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const users = (
    allowEmails.length > 0
      ? (getDb()
          .prepare(
            `SELECT id, email, is_admin FROM users
             WHERE is_admin = 1 OR lower(email) IN (${allowEmails.map(() => "?").join(", ")})`
          )
          .all(...allowEmails) as Array<{ id: number; email: string; is_admin: number }>)
      : (getDb()
          .prepare("SELECT id, email, is_admin FROM users WHERE is_admin = 1")
          .all() as Array<{ id: number; email: string; is_admin: number }>)
  ).filter((user) => isAdminUser({ email: user.email, is_admin: user.is_admin }));
  const adminIds = users.map((user) => user.id);
  if (adminIds.length === 0) return [];

  const placeholders = adminIds.map(() => "?").join(", ");
  const inUseIds = new Set(
    (
      getDb()
        .prepare(
          `SELECT selected_persona_id AS persona_id
           FROM chats
           WHERE user_id IN (${placeholders}) AND selected_persona_id IS NOT NULL
           ORDER BY id DESC`
        )
        .all(...adminIds) as Array<{ persona_id: number | null }>
    )
      .map((row) => Number(row.persona_id))
      .filter((id) => Number.isInteger(id) && id > 0)
  );
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.created_at
       FROM user_personas p
       WHERE p.user_id IN (${placeholders})
       ORDER BY p.user_id ASC, p.id ASC`
    )
    .all(...adminIds) as Array<{ id: number; name: string; created_at: string }>;
  return rows.map((row) => ({
    personaId: row.id,
    name: row.name ?? "",
    createdAt: row.created_at ?? "",
    inUse: inUseIds.has(row.id),
  }));
}

function loadCharacterPromptRow(characterId: number): CharacterPromptRow | undefined {
  return getDb()
    .prepare("SELECT * FROM characters WHERE id = ?")
    .get(characterId) as CharacterPromptRow | undefined;
}

function fieldMap(entries: Array<[string, string]>): {
  fields: Record<string, string>;
  hashes: Record<string, HandoffAuditHashedField>;
} {
  const fields: Record<string, string> = {};
  const hashes: Record<string, HandoffAuditHashedField> = {};
  for (const [key, value] of entries) {
    fields[key] = value;
    hashes[key] = sha256Text(value);
  }
  return { fields, hashes };
}

export function exportProductionHandoffAuditSnapshot(opts: {
  characterId: number;
  personaId: number;
}): HandoffAuditSnapshot {
  const ch = loadCharacterPromptRow(opts.characterId);
  if (!ch) {
    throw new Error(`character not found: ${opts.characterId}`);
  }

  const ownerRow = getDb()
    .prepare("SELECT user_id FROM user_personas WHERE id = ?")
    .get(opts.personaId) as { user_id: number } | undefined;
  if (!ownerRow) {
    throw new Error(`persona not found: ${opts.personaId}`);
  }

  const owner = getDb()
    .prepare("SELECT id, email, nickname, is_admin FROM users WHERE id = ?")
    .get(ownerRow.user_id) as
    | { id: number; email: string; nickname: string; is_admin: number }
    | undefined;
  if (!owner) {
    throw new Error(`persona owner not found: ${ownerRow.user_id}`);
  }
  if (!isAdminUser({ email: owner.email, is_admin: owner.is_admin })) {
    throw new Error("persona owner is not an admin account");
  }

  const persona = getPersonaById(owner.id, opts.personaId);
  if (!persona) {
    throw new Error(`persona loader miss: ${opts.personaId}`);
  }

  const settingRow: CharacterSettingRow = {
    id: ch.id,
    name: ch.name,
    gender: ch.gender,
    system_prompt: asText(ch.system_prompt),
    world: asText(ch.world),
    example_dialog: asText(ch.example_dialog),
    setting_chunks: asText(ch.setting_chunks),
    setting_chunks_en: asText(ch.setting_chunks_en),
    prompt_translation_hash: asText(ch.prompt_translation_hash),
    speech_profile: asText(ch.speech_profile),
    creator_compiled_description_json: asText(ch.creator_compiled_description_json),
    appearance_raw: asText(ch.appearance_raw),
    appearance_compiled: asText(ch.appearance_compiled),
  };

  const personaDisplayName = persona.name.trim() || owner.nickname;
  const loaded = loadCharacterChunksForPromptReadOnly(
    settingRow,
    personaDisplayName,
    owner.nickname
  );
  const effectiveExampleDialog = resolveExampleDialogForPrompt(
    asText(ch.example_dialog),
    ch.name
  );
  const storedSpeech = parseStoredSpeechProfile(asText(ch.speech_profile));
  const publicDescription = toPublicPersonaDescription(persona.description ?? "");
  const formattedPublicPrompt = formatPublicPersonaForPrompt(
    personaDisplayName,
    persona.gender,
    publicDescription
  );

  const characterFields = fieldMap([
    ["system_prompt", asText(ch.system_prompt)],
    ["description", asText(ch.description)],
    ["greeting", asText(ch.greeting)],
    ["example_dialog", asText(ch.example_dialog)],
    ["setting_chunks", asText(ch.setting_chunks)],
    ["setting_chunks_en", asText(ch.setting_chunks_en)],
    ["creator_compiled_description_json", asText(ch.creator_compiled_description_json)],
    ["appearance_raw", asText(ch.appearance_raw)],
    ["appearance_compiled", asText(ch.appearance_compiled)],
    ["simulation_cast", asText(ch.simulation_cast)],
    ["genres", asText(ch.genres)],
  ]);
  const personaFields = fieldMap([
    ["name", persona.name ?? ""],
    ["gender", persona.gender ?? "other"],
    ["description", persona.description ?? ""],
    ["secret_description", persona.secret_description ?? ""],
    ["speech_examples", persona.speech_examples ?? ""],
  ]);
  const speechLockFields = fieldMap([
    ["speech_profile", asText(ch.speech_profile)],
    ["speech_personality", asText(ch.speech_personality)],
    ["speech_traits", asText(ch.speech_traits)],
    ["example_dialog_for_prompt", effectiveExampleDialog],
    ["parsed_speech_profile_json", storedSpeech ? JSON.stringify(storedSpeech) : ""],
  ]);
  const worldFields = fieldMap([["world", asText(ch.world)]]);

  const live = isLiveProductionDatabase();
  const floodProven = live && ch.name === FLOOD_AUDIT_EXACT_NAME;
  const personaProven = live;
  const snapshotTimestamp = new Date().toISOString();
  return {
    SNAPSHOT_ID: `handoff-${ch.id}-${persona.id}-${snapshotTimestamp.replace(/[:.]/g, "-")}`,
    PRODUCTION_RECORD_PROVEN: floodProven && personaProven,
    FLOOD_PRODUCTION_RECORD_PROVEN: floodProven,
    ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: personaProven,
    database_source: live ? "live_production" : "local_non_production",
    snapshot_timestamp: snapshotTimestamp,
    CHARACTER_SHA: sha256Text(JSON.stringify(characterFields.fields)).sha256,
    PERSONA_SHA: sha256Text(JSON.stringify(personaFields.fields)).sha256,
    SPEECH_LOCK_SHA: sha256Text(JSON.stringify(speechLockFields.fields)).sha256,
    WORLD_CANON_SHA: sha256Text(JSON.stringify(worldFields.fields)).sha256,
    loaders: [
      "getDb().prepare('SELECT * FROM characters WHERE id = ?')",
      "loadCharacterChunksForPromptReadOnly",
      "resolveExampleDialogForPrompt",
      "parseStoredSpeechProfile",
      "getPersonaById",
      "toPublicPersonaDescription",
      "formatPublicPersonaForPrompt",
      "isAdminUser",
    ],
    character: {
      id: ch.id,
      name: ch.name,
      official: Number(ch.official ?? 0),
      creator_id: ch.creator_id ?? null,
      nsfw: Number(ch.nsfw ?? 0),
      visibility: asText(ch.visibility) || "public",
      moderation_status: asText(ch.moderation_status) || "approved",
      content_kind: asText(ch.content_kind) || "character",
      gender: asText(ch.gender),
      ...characterFields,
    },
    persona: {
      id: persona.id,
      user_id: persona.user_id,
      owner_email: owner.email,
      name: persona.name,
      gender: persona.gender,
      ...personaFields,
      formatted_public_prompt: formattedPublicPrompt,
    },
    speech_lock: speechLockFields,
    world_canon: worldFields,
    prompt_relevant_config: {
      greeting_chars: asText(ch.greeting).length,
      example_dialog_prompt_chars: effectiveExampleDialog.length,
      used_english_character_prompt: loaded.usedEnglish,
      chunk_count: loaded.chunks.length,
      adult_dialogue_profile_chars: asText(ch.adult_dialogue_profile).length,
      adult_status_chars: asText(ch.adult_status).length,
      simulation_cast_chars: asText(ch.simulation_cast).length,
      speech_examples_consumed_by_buildContext: false,
    },
  };
}

export function writeHandoffAuditSnapshotPrivate(snapshot: HandoffAuditSnapshot): string {
  const dir = path.join(HANDOFF_AUDIT_PRIVATE_DIR, snapshot.SNAPSHOT_ID);
  fs.mkdirSync(HANDOFF_AUDIT_PRIVATE_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "SNAPSHOT.json"), JSON.stringify(snapshot, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  return dir;
}

export function snapshotPublicLogLine(snapshot: HandoffAuditSnapshot): string {
  return [
    `[handoff-audit-export] source=${snapshot.database_source}`,
    `characterId=${snapshot.character.id}`,
    `personaId=${snapshot.persona.id}`,
    `character_system_sha=${snapshot.character.hashes.system_prompt.sha256}`,
    `persona_description_sha=${snapshot.persona.hashes.description.sha256}`,
    `speech_profile_sha=${snapshot.speech_lock.hashes.speech_profile.sha256}`,
    `world_sha=${snapshot.world_canon.hashes.world.sha256}`,
  ].join(" ");
}
