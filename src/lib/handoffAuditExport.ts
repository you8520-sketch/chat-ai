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
export const HANDOFF_AUDIT_PRIVATE_DIR = "data/handoff-audit-exports";

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
  id: number;
  name: string;
  user_id: number;
  owner_email: string;
};

export type HandoffAuditHashedField = {
  sha256: string;
  chars: number;
};

export type HandoffAuditSnapshot = {
  PRODUCTION_RECORD_PROVEN: boolean;
  FLOOD_PRODUCTION_RECORD_PROVEN: boolean;
  ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: boolean;
  database_source: "live_production" | "local_non_production";
  snapshot_timestamp: string;
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

export function isHandoffAuditExportEnabled(): boolean {
  const raw = process.env[HANDOFF_AUDIT_EXPORT_ENABLED_ENV]?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isLiveProductionDatabase(): boolean {
  const env = (
    process.env.RAILWAY_ENVIRONMENT_NAME ??
    process.env.RAILWAY_ENVIRONMENT ??
    ""
  ).toLowerCase();
  const mounted =
    process.env.RAILWAY_VOLUME_MOUNT_PATH === "/data" || process.env.DATA_DIR === "/data";
  return env === "production" && mounted;
}

export function requestHandoffAuditExportToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-admin-debug-token")?.trim() || "";
}

export function authorizeHandoffAuditExport(req: Request): boolean {
  if (!isHandoffAuditExportEnabled()) return false;
  const expected = process.env.ADMIN_DEBUG_TOKEN?.trim() ?? "";
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
  const allowEmails = (process.env.ADMIN_EMAILS ?? "")
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
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.name, p.user_id, u.email AS owner_email
       FROM user_personas p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id IN (${placeholders})
       ORDER BY p.user_id ASC, p.id ASC`
    )
    .all(...adminIds) as HandoffAuditPersonaCandidate[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? "",
    user_id: row.user_id,
    owner_email: row.owner_email ?? "",
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
  return {
    PRODUCTION_RECORD_PROVEN: live,
    FLOOD_PRODUCTION_RECORD_PROVEN: live,
    ADMIN_PERSONA_PRODUCTION_RECORD_PROVEN: live,
    database_source: live ? "live_production" : "local_non_production",
    snapshot_timestamp: new Date().toISOString(),
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
  const dir = path.join(process.cwd(), HANDOFF_AUDIT_PRIVATE_DIR, snapshot.snapshot_timestamp.replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SNAPSHOT.json"), JSON.stringify(snapshot, null, 2), "utf8");
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
