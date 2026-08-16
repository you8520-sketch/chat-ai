#!/usr/bin/env node
/**
 * SELECT-only extractor for production 라이크 (real name 조태형).
 * Past chat extraction is optional. Character + 렌 persona snapshots are primary.
 *
 *   railway ssh
 *   node scripts/real-taehyung-explicit-extract-railway.cjs
 *
 * INSERT = 0, UPDATE = 0, DELETE = 0
 */
"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.OPUS5_SHADOW_DB || process.env.TAEHYUNG_DB || "/data/app.db";
const OUT_DIR =
  process.env.TAEHYUNG_EXTRACT_OUT ||
  path.join(process.cwd(), "docs/audits/real-taehyung-explicit-qwen38-vs-deepseek0813");
const KNOWN_ID = 18;
const DISPLAY_NAME = "라이크";
const REAL_NAME = "조태형";

const EXPLICIT_ANATOMY =
  /(?:성기|음경|질\b|클리토리스|유두|정액|삽입|penetrat|genital|penis|vagina|clitoris)/i;
const EXPLICIT_ACTION =
  /(?:삽입|박아|핥아|빨아|사정|오르가슴|성교|sex\b|penetrat|ejaculat|orgasm)/i;
const INTIMATE_ONLY =
  /(?:포옹|허리\s*감싸|키스\s*직전|키스|입맞춤|더\s*가까이\s*와도\s*돼)/i;

function isOpus5(id) {
  const s = String(id || "").trim().toLowerCase();
  return s === "claude-opus-5";
}
function isGemini31(id) {
  const s = String(id || "").trim().toLowerCase();
  return s === "gemini-3.1-pro-preview" || s === "google/gemini-3.1-pro-preview";
}
function sourceKind(id) {
  if (isOpus5(id)) return "opus";
  if (isGemini31(id)) return "gemini";
  return null;
}
function parseJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}
function deliveredModel(row) {
  const usage = parseJson(row.usage);
  const meta = parseJson(row.adult_route_meta_json);
  return (
    (usage && (usage.model || usage.selectedAI || usage.requestedModel)) ||
    (meta && (meta.model || meta.deliveredModel || meta.selectedAI)) ||
    row.model ||
    ""
  );
}
function isExplicitAdult(text) {
  const t = String(text || "");
  const explicit = EXPLICIT_ACTION.test(t) || (EXPLICIT_ANATOMY.test(t) && EXPLICIT_ACTION.test(t));
  const anatomyPlusSex = EXPLICIT_ANATOMY.test(t) && /(?:넣|깊이|안쪽|혀|입술|허벅지|허리)/.test(t);
  const hit = explicit || anatomyPlusSex;
  const intimateOnly = INTIMATE_ONLY.test(t) && !hit;
  return {
    EXPLICIT_ADULT_SCENE_ACTIVE: hit,
    INTIMATE_TRANSITION_ONLY: intimateOnly && !hit,
  };
}

function characterColumns(db) {
  const cols = db.prepare("PRAGMA table_info(characters)").all().map((c) => c.name);
  return [
    "id",
    "name",
    "tagline",
    "description",
    "greeting",
    "system_prompt",
    "world",
    "example_dialog",
    "status_window_prompt",
    "status_widget_json",
    "speech_profile",
    "setting_chunks",
    "gender",
    "nsfw",
    "audience",
    "official",
    "appearance_raw",
    "appearance_compiled",
    "recommended_writing_style",
    "creator_comment",
    "content_kind",
  ].filter((c) => cols.includes(c));
}

function settingBlob(row) {
  return [
    row.description,
    row.system_prompt,
    row.world,
    row.greeting,
    row.example_dialog,
    row.setting_chunks,
    row.speech_profile,
  ]
    .map((v) => String(v ?? ""))
    .join("\n");
}

function isLikeTaehyung(row) {
  return String(row?.name || "").trim() === DISPLAY_NAME && settingBlob(row).includes(REAL_NAME);
}

function loadCharacter(db) {
  const wanted = characterColumns(db);
  const sql = `SELECT ${wanted.join(", ")} FROM characters`;
  const byId = db.prepare(`${sql} WHERE id = ?`).get(KNOWN_ID);
  if (byId && isLikeTaehyung(byId)) return { row: byId, lookup: "id=18" };
  if (byId && String(byId.name || "").trim() === DISPLAY_NAME && !settingBlob(byId).includes(REAL_NAME)) {
    throw new Error("characters.id=18 is named 라이크 but settings do not contain 조태형");
  }

  const named = db.prepare(`${sql} WHERE name = ? ORDER BY id ASC`).all(DISPLAY_NAME);
  const verified = named.filter(isLikeTaehyung);
  if (verified.length === 1) return { row: verified[0], lookup: "name=라이크 unique" };
  if (verified.length > 1) {
    const known = verified.find((r) => Number(r.id) === KNOWN_ID);
    if (known) return { row: known, lookup: "name=라이크 + id=18" };
    throw new Error("multiple 라이크 rows contain 조태형; refuse first-row fallback");
  }
  throw new Error("production character 라이크 (real name 조태형) not found");
}

function loadPersona(db, chatPersonaId, characterId) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  if (!tables.includes("user_personas")) return { persona: null, lookup: "user_personas missing" };
  const cols = db.prepare("PRAGMA table_info(user_personas)").all().map((c) => c.name);
  const wanted = ["id", "name", "description", "gender", "speech_examples"].filter((c) =>
    cols.includes(c)
  );
  if (chatPersonaId) {
    const byId = db
      .prepare(`SELECT ${wanted.join(", ")} FROM user_personas WHERE id=?`)
      .get(chatPersonaId);
    if (byId && String(byId.name || "").includes("렌")) {
      return { persona: byId, lookup: "chat.selected_persona_id" };
    }
  }
  const named = db
    .prepare(`SELECT ${wanted.join(", ")} FROM user_personas WHERE name=? ORDER BY id DESC`)
    .all("렌");
  if (named.length === 1) return { persona: named[0], lookup: "name=렌 unique" };
  if (named.length > 1) {
    const chatCols = db.prepare("PRAGMA table_info(chats)").all().map((c) => c.name);
    if (chatCols.includes("selected_persona_id") && characterId) {
      const counts = db
        .prepare(
          `SELECT selected_persona_id AS id, COUNT(*) AS n
           FROM chats
           WHERE character_id = ?
             AND selected_persona_id IS NOT NULL
           GROUP BY selected_persona_id
           ORDER BY n DESC`
        )
        .all(characterId);
      const namedIds = new Set(named.map((r) => Number(r.id)));
      const likeRen = counts.filter((r) => namedIds.has(Number(r.id)));
      const total = likeRen.reduce((s, r) => s + Number(r.n), 0);
      if (likeRen.length === 1) {
        const row = named.find((r) => Number(r.id) === Number(likeRen[0].id));
        if (row) return { persona: row, lookup: "name=렌 unique for 라이크 chats" };
      }
      if (likeRen.length > 1 && total > 0 && Number(likeRen[0].n) / total >= 0.7) {
        const row = named.find((r) => Number(r.id) === Number(likeRen[0].id));
        if (row) {
          return {
            persona: row,
            lookup: `name=렌 + 라이크-chat majority ${likeRen[0].n}/${total}`,
          };
        }
      }
    }
    return { persona: null, lookup: "multiple 렌 personas; refuse first-row fallback" };
  }
  return { persona: null, lookup: "name=렌 not found" };
}

function pickFixture(db, characterId, kind) {
  const chatCols = db.prepare("PRAGMA table_info(chats)").all().map((c) => c.name);
  const msgCols = db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
  const hasUsage = msgCols.includes("usage");
  const hasAdultMeta = msgCols.includes("adult_route_meta_json");
  const hasRefund = msgCols.includes("is_refunded");
  const hasPersona = chatCols.includes("selected_persona_id");
  const hasGeminiModel = chatCols.includes("gemini_model");
  const hasMemory = chatCols.includes("memory");
  const hasSummary = chatCols.includes("current_summary");
  const hasRoute = chatCols.includes("model_route_state_json");

  const chats = db
    .prepare(
      `SELECT id
              ${hasPersona ? ", selected_persona_id" : ""}
              ${hasGeminiModel ? ", gemini_model" : ""}
              ${hasMemory ? ", memory" : ""}
              ${hasSummary ? ", current_summary" : ""}
              ${hasRoute ? ", model_route_state_json" : ""}
       FROM chats
       WHERE character_id = ?
       ORDER BY id DESC
       LIMIT 200`
    )
    .all(characterId);

  let best = null;
  for (const chat of chats) {
    const rows = db
      .prepare(
        `SELECT id, role, content, model
                ${hasUsage ? ", usage" : ", NULL AS usage"}
                ${hasAdultMeta ? ", adult_route_meta_json" : ", '' AS adult_route_meta_json"}
         FROM messages
         WHERE chat_id = ?
           ${hasRefund ? "AND COALESCE(is_refunded,0)=0" : ""}
         ORDER BY id ASC`
      )
      .all(chat.id);
    const assistantFromSource = rows.filter(
      (r) => r.role === "assistant" && sourceKind(deliveredModel(r)) === kind
    );
    if (assistantFromSource.length < 2) continue;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.role !== "user") continue;
      const flag = isExplicitAdult(row.content);
      if (!flag.EXPLICIT_ADULT_SCENE_ACTIVE || flag.INTIMATE_TRANSITION_ONLY) continue;
      const priorAssist = rows
        .slice(0, i)
        .filter((r) => r.role === "assistant" && sourceKind(deliveredModel(r)) === kind);
      if (priorAssist.length < 2) continue;
      const history = rows.slice(0, i).map((r) => ({
        role: r.role,
        content: r.content,
        model: deliveredModel(r),
      }));
      const score = priorAssist.length * 10 + Math.min(row.content.length, 400);
      if (!best || score > best.score) {
        best = {
          score,
          chatId: "REDACTED",
          userId: "REDACTED",
          selectedPersonaId: chat.selected_persona_id || null,
          chatSelectedModel: chat.gemini_model || "",
          memory: chat.memory || "",
          currentSummary: chat.current_summary || "",
          routeState: parseJson(chat.model_route_state_json),
          history,
          currentUserTurn: row.content,
          sourceAssistants: priorAssist.slice(-2).map((r) => r.content),
          flags: flag,
        };
      }
      break;
    }
  }
  return best;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    process.stdout.write(
      `${JSON.stringify({ dbWrite: false, error: "DB_MISSING", dbPath: DB_PATH }, null, 2)}\n`
    );
    process.exitCode = 2;
    return;
  }
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const loaded = loadCharacter(db);
    const character = loaded.row;
    const opus = pickFixture(db, character.id, "opus");
    const gemini = pickFixture(db, character.id, "gemini");
    const personaLoaded = loadPersona(
      db,
      (opus && opus.selectedPersonaId) || (gemini && gemini.selectedPersonaId),
      character.id
    );
    const persona = personaLoaded.persona;
    const fixtures = {
      extractedAt: new Date().toISOString(),
      dbPath: DB_PATH,
      dbWrite: false,
      CHARACTER: "production 라이크",
      CHARACTER_REAL_NAME: REAL_NAME,
      characterLookup: loaded.lookup,
      personaLookup: personaLoaded.lookup,
      PAST_CHAT_EXTRACTION: "OPTIONAL_NOT_REQUIRED",
      character: {
        ...character,
        id: "REDACTED",
        _internalId: character.id,
      },
      persona: persona
        ? {
            name: persona.name || "렌",
            description: persona.description || "",
            gender: persona.gender || "other",
            speech_examples: persona.speech_examples || "",
            id: "REDACTED",
          }
        : null,
      opus: opus ? { ...opus, selectedPersonaId: undefined } : null,
      gemini: gemini ? { ...gemini, selectedPersonaId: undefined } : null,
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const outFile = path.join(OUT_DIR, "PRODUCTION_FIXTURES.json");
    fs.writeFileSync(outFile, `${JSON.stringify(fixtures, null, 2)}\n`);
    const summary = {
      dbWrite: false,
      CHARACTER: "production 라이크",
      CHARACTER_REAL_NAME: REAL_NAME,
      characterName: character.name,
      characterInternalIdPresent: true,
      verifiedLikeTaehyung: isLikeTaehyung(character),
      personaName: fixtures.persona ? fixtures.persona.name : null,
      personaSource: persona ? "PRODUCTION_USER_PERSONAS" : "MISSING",
      pastOpusChat: Boolean(opus),
      pastGeminiChat: Boolean(gemini),
      pastChatRequired: false,
      outFile,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!isLikeTaehyung(character) || !persona) {
      process.exitCode = 2;
    }
  } finally {
    db.close();
  }
}

main();
