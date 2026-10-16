import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  consumeSelectedAiEntryNotice,
  createSelectedAiSaveGate,
  ensureUserSelectedAI,
  globalModelChangedNotice,
  globalModelIntroNotice,
  globalModelStatusLabel,
  parseAiModelUxJson,
  serializeAiModelUxJson,
} from "@/lib/userSelectedAI";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  GEMINI_38_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
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
      globalModelStatusLabel(OPENROUTER_MUSE_SPARK_11_MODEL as never),
      "Muse Spark 1.1 · 모든 채팅에 적용"
    );
    assert.match(
      globalModelIntroNotice(OPENROUTER_MUSE_SPARK_11_MODEL as never),
      /모든 채팅에 공통으로 적용/
    );
    assert.match(
      globalModelChangedNotice(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL as never),
      /Gemini 3\.1 Pro Preview로 변경했습니다/
    );
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

  it("empty selected_ai stays unselected and does not resurrect chats.gemini_model", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    db.prepare("INSERT INTO chats (id, user_id, gemini_model) VALUES (1, 1, ?)").run(
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL
    );
    const r = ensureUserSelectedAI(db, 1);
    assert.equal(r.selectedAI, null);
    assert.equal(r.seeded, false);
    assert.equal(r.remappedFromRetired, false);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, "");
    db.close();
  });

  it("legacy stored deepseek-v4-flash is not rewritten", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      "deepseek-v4-flash"
    );
    const r = ensureUserSelectedAI(db, 1);
    assert.equal(r.selectedAI, null);
    assert.equal(r.remappedFromRetired, false);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, "deepseek-v4-flash");
    db.close();
  });

  it("keeps current live Gemini 3.8 global selections", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      GEMINI_38_FLASH_MODEL
    );
    assert.equal(ensureUserSelectedAI(db, 1).selectedAI, GEMINI_38_FLASH_MODEL);
    db.close();
  });

  it("does not remap Muse or emit a retired auto-migration notice", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      OPENROUTER_MUSE_SPARK_11_MODEL
    );
    const r = ensureUserSelectedAI(db, 1);
    assert.equal(r.selectedAI, null);
    assert.equal(r.remappedFromRetired, false);
    const notice1 = consumeSelectedAiEntryNotice(db, 1);
    assert.equal(notice1.kind, null);
    assert.equal(notice1.notice, null);
    assert.equal(notice1.selectedAI, null);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, OPENROUTER_MUSE_SPARK_11_MODEL);
    db.close();
  });

  it("keeps only the latest overlapping model save and stays busy until the last PATCH ends", () => {
    const gate = createSelectedAiSaveGate();
    const applied: string[] = [];
    const gemini = gate.begin();
    const sol = gate.begin();
    const opus = gate.begin();
    const first = gate.end(gemini);
    assert.equal(first.stillBusy, true);
    assert.equal(first.isLatest, false);
    if (first.isLatest) applied.push("gemini-3.8-flash");
    const second = gate.end(sol);
    assert.equal(second.stillBusy, true);
    assert.equal(second.isLatest, false);
    if (second.isLatest) applied.push("gpt-6.1-sol");
    const third = gate.end(opus);
    assert.equal(third.stillBusy, false);
    assert.equal(third.isLatest, true);
    if (third.isLatest) applied.push("claude-opus-5.5");
    assert.deepEqual(applied, ["claude-opus-5.5"]);
  });

  it("does not toast intro or all-chats-apply copy on first visit", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    const notice = consumeSelectedAiEntryNotice(db, 1, { isFirstChatVisitEver: true });
    assert.equal(notice.notice, null);
    assert.equal(notice.kind, null);
    db.close();
  });
});
