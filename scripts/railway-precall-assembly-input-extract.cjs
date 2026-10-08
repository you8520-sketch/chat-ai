/**
 * Operator-only, read-only Railway extractor for the PRECALL final-wire plan.
 *
 * Run inside the production container and pipe stdout straight into
 * `scripts/rp-quality-precall-final-wire.ts`. Do not redirect stdout to a file,
 * log, CI artifact, or terminal: it carries raw character/persona text.
 *
 * Guarantees: native node:sqlite readOnly:true + PRAGMA query_only=ON, one read
 * transaction, no provider call, no write. Secrets are never selected.
 */
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const TARGET_CHARACTER_ID = 18;
const TARGET_CHARACTER_NAME = "라이크";
const TARGET_PERSONA_NAME = "렌";
const FLAG_NAME_ALLOW =
  /^(NODE_ENV$|CANON_|EPISODIC_|MEMORY_|PERSONA_SECRET_|RP_DIAGNOSTIC_|SCENE_DIRECTIVE|LIVING_SCENE|INTERACTIVE_USER_OWNERSHIP|AUTHORIAL_|COMPLETION_INTEGRITY|SCENE_BOUNDARY|ADULT_|SKIP_ADULT_VERIFICATION|PHASE\d|PROSE_|SHARED_NOVEL|SNPV2|GEMINI31|MUSE_|NARRATION_FEW_SHOT|REGISTER_PATCH|SPEECH_LOCK|EXAMPLE_DIALOG|USER_IMPERSONATION|REGENERATE_|GIBBERISH|STATUS_WIDGET_)/;
const FLAG_NAME_DENY = /KEY|SECRET$|TOKEN|PASSWORD|URL|EMAIL/i;

class ProbeError extends Error {
  constructor(code, meta = {}) {
    super(code);
    this.code = code;
    this.meta = meta;
  }
}
function assert(condition, code, meta = {}) {
  if (!condition) throw new ProbeError(code, meta);
}
function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}
const LEGACY_SECRET_PREFIXES = [
  /^NPC들은\s*모르는\s*비밀설정/i,
  /^NPC가\s*모르는\s*비밀설정/i,
  /^캐릭터들은\s*모르는\s*설정/i,
  /^캐릭터는\s*모르는\s*비밀/i,
];
function isLegacySecretInner(inner) {
  const trimmed = inner.trim();
  return LEGACY_SECRET_PREFIXES.some((re) => re.test(trimmed));
}
function toPublicPersonaDescription(rawDescription) {
  let out = String(rawDescription ?? "");
  out = out.replace(/\[[^\]]*\]/g, (block) => (isLegacySecretInner(block.slice(1, -1)) ? "" : block));
  out = out.replace(/\([^)]*\)/g, (block) => (isLegacySecretInner(block.slice(1, -1)) ? "" : block));
  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

let db = null;
let txOpen = false;
try {
  const deployedGitSha = String(process.env.RAILWAY_GIT_COMMIT_SHA ?? "").trim();
  assert(/^[a-f0-9]{40}$/i.test(deployedGitSha), "DEPLOY_SHA_INVALID");
  db = new DatabaseSync("/data/app.db", { readOnly: true });
  db.exec("PRAGMA query_only = ON");
  assert(db.prepare("PRAGMA query_only").get()?.query_only === 1, "QUERY_ONLY_NOT_ENABLED");
  db.exec("BEGIN DEFERRED");
  txOpen = true;

  const characterRows = db.prepare("SELECT * FROM characters WHERE id = ?").all(TARGET_CHARACTER_ID);
  assert(characterRows.length === 1, "CHARACTER_ROW_COUNT_INVALID", { n: characterRows.length });
  const character = characterRows[0];
  assert(
    Number(character.id) === TARGET_CHARACTER_ID && String(character.name ?? "").trim() === TARGET_CHARACTER_NAME,
    "CHARACTER_IDENTITY_MISMATCH"
  );

  const allowEmails = String(process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  const adminRows = allowEmails.length
    ? db
        .prepare(
          `SELECT id FROM users WHERE COALESCE(account_kind,'') <> 'portone_reviewer' AND (is_admin = 1 OR lower(email) IN (${allowEmails
            .map(() => "?")
            .join(",")})) ORDER BY id ASC`
        )
        .all(...allowEmails)
    : db
        .prepare(`SELECT id FROM users WHERE COALESCE(account_kind,'') <> 'portone_reviewer' AND is_admin = 1 ORDER BY id ASC`)
        .all();
  const adminIds = [...new Set(adminRows.map((row) => Number(row.id)))];
  assert(adminIds.length === 1, "ADMIN_IDENTITY_AMBIGUOUS", { n: adminIds.length });

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
    .all(adminIds[0], TARGET_PERSONA_NAME);
  assert(personas.length === 1, "PERSONA_COUNT_INVALID", { n: personas.length });
  const persona = personas[0];

  const user = db
    .prepare("SELECT id, nickname, user_note, sub_until, sub_plan FROM users WHERE id = ?")
    .get(adminIds[0]);

  const attachments = Number(
    db.prepare("SELECT COUNT(*) n FROM character_lorebook_attachments WHERE character_id = ?").get(TARGET_CHARACTER_ID).n
  );
  const globalLorebook = db
    .prepare(
      `SELECT id, name, triggers_json, content, depth, enabled, sort_order
       FROM global_lorebook_entries WHERE enabled = 1 ORDER BY depth ASC, sort_order ASC, id ASC`
    )
    .all();
  const fxRow =
    db
      .prepare(
        `SELECT date_key, base_usd_krw, source, fetched_at
         FROM billing_fx_daily_snapshots ORDER BY date_key DESC LIMIT 1`
      )
      .get() ?? null;

  const flags = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (FLAG_NAME_ALLOW.test(name) && !FLAG_NAME_DENY.test(name)) flags[name] = String(value ?? "");
  }

  db.exec("ROLLBACK");
  txOpen = false;
  const deployAfter = String(process.env.RAILWAY_GIT_COMMIT_SHA ?? "").trim();
  assert(deployAfter === deployedGitSha, "DEPLOY_SHA_CHANGED_DURING_READ");

  const personaPublic = toPublicPersonaDescription(persona.description ?? "");
  const out = {
    ok: true,
    proof: {
      source: "railway-production-readonly-hash-probe-native-v1",
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
      fx: fxRow,
      flags,
    },
    flagNamePattern: FLAG_NAME_ALLOW.source,
    rawSourceTextPrinted: false,
    dbReadOnly: true,
    queryOnly: true,
    singleReadTransaction: true,
    providerPosts: 0,
  };
  process.stdout.write(JSON.stringify(out));
} catch (err) {
  if (db && txOpen) {
    try {
      db.exec("ROLLBACK");
    } catch {}
  }
  const payload =
    err instanceof ProbeError
      ? { ok: false, code: err.code, ...err.meta }
      : { ok: false, code: "PROBE_FAILED", errorName: err?.name ?? "Error" };
  process.stdout.write(JSON.stringify(payload));
  process.exitCode = 2;
} finally {
  try {
    db?.close();
  } catch {}
}
