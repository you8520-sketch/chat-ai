import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isValidSelectedAI,
  type SelectedAI,
} from "@/lib/chatModels";
import { setUserSelectedAI } from "@/lib/userSelectedAI";

const ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/user/selected-ai/route.ts"),
  "utf8"
);
const CHAT_CLIENT_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
  "utf8"
);

const USER_SELECTABLE_IDS = new Set<string>(USER_SELECTABLE_AI_OPTIONS.map((o) => o.id));

function isPatchAllowed(requested: string): boolean {
  return Boolean(requested && isValidSelectedAI(requested) && USER_SELECTABLE_IDS.has(requested));
}

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      selected_ai TEXT NOT NULL DEFAULT '',
      ai_model_ux_json TEXT NOT NULL DEFAULT ''
    );
  `);
  db.prepare("INSERT INTO users (id) VALUES (1)").run();
  return db;
}

describe("/api/user/selected-ai Gemini 3.7 Flash allow-list", () => {
  it("PATCH uses USER_SELECTABLE_AI_OPTIONS as the server allow-list", () => {
    assert.match(ROUTE_SOURCE, /USER_SELECTABLE_AI_OPTIONS/);
    assert.match(ROUTE_SOURCE, /USER_SELECTABLE_IDS\.has\(requested\)/);
    assert.match(CHAT_CLIENT_SOURCE, /USER_SELECTABLE_AI_OPTIONS\.map/);
  });

  it("allows Gemini 3.7 Flash select/save and keeps sibling picker models", () => {
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), true);
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL), true);
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), true);
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);

    const db = memoryDb();
    const saved = setUserSelectedAI(
      db,
      1,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL as SelectedAI
    );
    assert.equal(saved.selectedAI, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL);
    db.close();
  });

  it("rejects hidden picker models", () => {
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), false);
    assert.equal(isPatchAllowed(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL), false);
    assert.equal(isPatchAllowed(OPENROUTER_GEMINI_36_FLASH_MODEL), false);
  });
});
