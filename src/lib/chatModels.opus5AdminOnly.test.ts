import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  USER_SELECTABLE_AI_OPTIONS,
  isUserSelectableAI,
  resolveUserChatSelectedAI,
  userSelectableAIOptionsForUser,
} from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import {
  getUserChatSelectedAI,
  setUserSelectedAI,
} from "@/lib/userSelectedAI";

const CHAT_ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);
const SELECTED_AI_ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/user/selected-ai/route.ts"),
  "utf8"
);
const CHAT_CLIENT_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"),
  "utf8"
);

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      selected_ai TEXT NOT NULL DEFAULT '',
      ai_model_ux_json TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

describe("Opus 5 admin-only chat access", () => {
  it("hides Opus 5 from regular user picker while global disable is on", () => {
    assert.equal(process.env.OPUS5_USER_ENABLED?.trim(), undefined);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      false
    );
    assert.equal(
      userSelectableAIOptionsForUser(false).some(
        (o) => o.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
      ),
      false
    );
  });

  it("shows Opus 5 in admin picker and allow-list", () => {
    const adminOptions = userSelectableAIOptionsForUser(true);
    assert.equal(
      adminOptions.some((o) => o.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      true
    );
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, true), true);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, false), false);
    assert.match(CHAT_CLIENT_SOURCE, /userSelectableAIOptionsForUser\(isAdmin\)/);
    assert.match(SELECTED_AI_ROUTE_SOURCE, /isUserSelectableAI\(requested, isAdmin\)/);
    assert.match(CHAT_ROUTE_SOURCE, /getUserChatSelectedAI\(db, user\.id, \{ isAdmin: isAdminForChat \}\)/);
  });

  it("routes admin Opus 5 selection to Cheaper Inference without remap", () => {
    assert.equal(
      resolveUserChatSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, { isAdmin: true }),
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    );
    const outbound = adaptCheaperInferenceChatBody({
      model: resolveUserChatSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, {
        isAdmin: true,
      }),
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(outbound.model, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
  });

  it("still remaps non-admin stored Opus 5 to default", () => {
    assert.equal(
      resolveUserChatSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, { isAdmin: false }),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    );
    assert.equal(getUserChatSelectedAI(db, 1, { isAdmin: false }), CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(getUserChatSelectedAI(db, 1, { isAdmin: true }), CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    db.close();
  });

  it("allows admin to persist Opus 5 selection", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    const saved = setUserSelectedAI(db, 1, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(saved.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(getUserChatSelectedAI(db, 1, { isAdmin: true }), CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    db.close();
  });
});
