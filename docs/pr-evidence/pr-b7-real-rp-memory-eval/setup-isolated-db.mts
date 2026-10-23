/**
 * Builds the isolated B7 evaluation DB from a read-only production export.
 *
 * Input (never committed): B7_PROD_CONFIG (character 18 row, persona 1 row,
 * persona secrets, enabled global lorebook entries, admin user settings,
 * recent admin safe-chat settings) and B7_PROD_WORLD (world 4 row).
 * Output: DATA_DIR/app.db with the real character + admin persona and one
 * fresh safe-mode chat created through the canonical createChatSession owner.
 *
 * Usage:
 *   DATA_DIR=<dir> SESSION_SECRET=<s> B7_PROD_CONFIG=<json> B7_PROD_WORLD=<json> \
 *     node --conditions=react-server --import tsx setup-isolated-db.mts
 */
import fs from "node:fs";

import { createSession } from "@/lib/auth";
import { createChatSession } from "@/lib/chatSessionCreate";
import { getDb } from "@/lib/db";
import { SESSION_COOKIE_NAME } from "@/lib/sessionCookie";

const MODEL = process.env.B7_MODEL ?? "gemini-3.8-flash";
const LOCAL_ADMIN_EMAIL = "b7-admin@local.test";

type Row = Record<string, unknown>;
const config = JSON.parse(fs.readFileSync(process.env.B7_PROD_CONFIG!, "utf8")) as {
  character: Row;
  persona: Row;
  persona_secrets: Row[];
  global_lorebook_entries: Row[];
  user: Row;
  recent_safe_chats: Row[];
};
const { world } = JSON.parse(fs.readFileSync(process.env.B7_PROD_WORLD!, "utf8")) as { world: Row };

const db = getDb();

function columns(table: string): Set<string> {
  return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

function insertRow(table: string, row: Row, overrides: Row = {}): number {
  const cols = columns(table);
  const merged = { ...row, ...overrides };
  const keys = Object.keys(merged).filter((k) => cols.has(k) && merged[k] !== undefined);
  const missing = Object.keys(row).filter((k) => !cols.has(k));
  if (missing.length) console.log(`[setup] ${table}: production-only columns skipped: ${missing.join(",")}`);
  const info = db
    .prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .run(...keys.map((k) => merged[k] as never));
  return Number(info.lastInsertRowid);
}

const userId = insertRow(
  "users",
  {
    email: LOCAL_ADMIN_EMAIL,
    nickname: config.user.nickname,
    pw_hash: "x",
    is_adult: config.user.is_adult,
    nsfw_on: config.user.nsfw_on,
    points: 1_000_000,
    chat_prefs: config.user.chat_prefs,
    ai_model_ux_json: config.user.ai_model_ux_json,
    selected_ai: MODEL,
    onboarding_completed_at: "2026-01-01 00:00:00",
  }
);

for (const creatorId of [config.character.creator_id, world.creator_id]) {
  const exists = db.prepare("SELECT 1 FROM users WHERE id=?").get(creatorId);
  if (!exists) {
    db.prepare("INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)").run(
      creatorId,
      `b7-creator-${creatorId}@local.test`,
      `creator${creatorId}`,
      "x"
    );
  }
}

const worldTaken = db.prepare("SELECT 1 FROM worlds WHERE id=?").get(world.id);
if (worldTaken) db.prepare("DELETE FROM worlds WHERE id=?").run(world.id);
insertRow("worlds", world);

const charTaken = db.prepare("SELECT 1 FROM characters WHERE id=?").get(config.character.id);
if (charTaken) throw new Error(`local characters.id=${String(config.character.id)} already exists`);
const characterId = insertRow("characters", config.character);

const personaTaken = db.prepare("SELECT 1 FROM user_personas WHERE id=?").get(config.persona.id);
if (personaTaken) db.prepare("DELETE FROM user_personas WHERE id=?").run(config.persona.id);
const personaId = insertRow("user_personas", config.persona, { user_id: userId });
for (const secret of config.persona_secrets) {
  insertRow("persona_secrets", secret, { id: undefined, persona_id: personaId });
}

db.prepare("DELETE FROM global_lorebook_entries").run();
for (const entry of config.global_lorebook_entries) insertRow("global_lorebook_entries", entry);

const chatId = createChatSession({
  userId,
  characterId,
  greeting: String(config.character.greeting ?? ""),
  mode: "safe",
  selectedPersonaId: personaId,
  targetResponseChars: 3200,
  __testOnGreetingSchedule: () => {},
});

const reference = config.recent_safe_chats.find((c) => c.user_lorebook_id == null) ?? config.recent_safe_chats[0]!;
db.prepare(
  `UPDATE chats SET gemini_model=?, narrative_pov=?, user_authoring_level=?, status_window_enabled=?,
     status_widget_mode=?, memory_capacity=?, writing_style_override=?, user_coauthor_mode=?, adult_handoff_enabled=?
   WHERE id=?`
).run(
  MODEL,
  reference.narrative_pov,
  reference.user_authoring_level,
  reference.status_window_enabled,
  reference.status_widget_mode,
  reference.memory_capacity,
  reference.writing_style_override,
  reference.user_coauthor_mode,
  reference.adult_handoff_enabled,
  chatId
);

const token = createSession(userId);
console.log(
  JSON.stringify({
    userId,
    characterId,
    personaId,
    chatId,
    model: MODEL,
    referenceChatId: reference.id,
    adminEmail: LOCAL_ADMIN_EMAIL,
  })
);
console.log(`TOKEN ${SESSION_COOKIE_NAME}=${token}`);
