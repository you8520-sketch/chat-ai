import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  consumeSelectedAiEntryNotice,
  ensureUserSelectedAI,
  globalModelChangedNotice,
  globalModelIntroNotice,
  globalModelRetiredRemapNotice,
  globalModelStatusLabel,
  parseAiModelUxJson,
  serializeAiModelUxJson,
} from "@/lib/userSelectedAI";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_KIMI_K3_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "@/lib/chatModels";

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      selected_ai TEXT NOT NULL DEFAULT '',
      ai_model_ux_json TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      gemini_model TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

describe("userSelectedAI helpers", () => {
  it("formats global status and notices", () => {
    assert.equal(
      globalModelStatusLabel(OPENROUTER_MUSE_SPARK_11_MODEL),
      "Muse Spark 1.1 · 모든 채팅에 적용"
    );
    assert.match(
      globalModelIntroNotice(OPENROUTER_MUSE_SPARK_11_MODEL),
      /모든 채팅에 공통으로 적용/
    );
    assert.match(
      globalModelChangedNotice(OPENROUTER_GEMINI_25_PRO_MODEL),
      /Gemini 2\.5 Pro로 변경했습니다/
    );
    assert.match(globalModelRetiredRemapNotice(), /제공이 종료되어.*Muse Spark 1\.1/);
  });

  it("round-trips ux json including retiredRemapNoticePending", () => {
    const raw = serializeAiModelUxJson({
      v: 1,
      globalMigrationNoticeSeen: true,
      firstChatNoticeSeen: false,
      changeNoticePending: true,
      lastChangedModelId: OPENROUTER_GEMINI_25_PRO_MODEL,
      retiredRemapNoticePending: true,
    });
    const parsed = parseAiModelUxJson(raw);
    assert.equal(parsed.retiredRemapNoticePending, true);
    assert.equal(parsed.changeNoticePending, true);
  });

  it("empty selected_ai → Muse and does not resurrect chats.gemini_model", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    db.prepare("INSERT INTO chats (id, user_id, gemini_model) VALUES (1, 1, ?)").run(
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL
    );
    const r = ensureUserSelectedAI(db, 1);
    assert.equal(r.selectedAI, OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(r.seeded, true);
    assert.equal(r.remappedFromRetired, false);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, OPENROUTER_MUSE_SPARK_11_MODEL);
    db.close();
  });

  it("keeps Gemini / DeepSeek global selections", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      OPENROUTER_GEMINI_25_PRO_MODEL
    );
    assert.equal(ensureUserSelectedAI(db, 1).selectedAI, OPENROUTER_GEMINI_25_PRO_MODEL);
    db.prepare("UPDATE users SET selected_ai=? WHERE id=1").run(OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(ensureUserSelectedAI(db, 1).selectedAI, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    db.close();
  });

  it("remaps Kimi → Muse and queues retired notice once", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(OPENROUTER_KIMI_K3_MODEL);
    const r = ensureUserSelectedAI(db, 1);
    assert.equal(r.selectedAI, OPENROUTER_MUSE_SPARK_11_MODEL);
    assert.equal(r.remappedFromRetired, true);
    const notice1 = consumeSelectedAiEntryNotice(db, 1);
    assert.equal(notice1.kind, "retired");
    assert.match(notice1.notice ?? "", /제공이 종료되어/);
    const notice2 = consumeSelectedAiEntryNotice(db, 1);
    assert.equal(notice2.notice, null);
    db.close();
  });
});
