import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  DEFAULT_SELECTED_AI,
  SELECTED_AI_OPTIONS,
  USER_SELECTABLE_AI_OPTIONS,
  isCheaperInferenceClaudeOpus5Model,
  isOpus5UserEnabled,
  isValidSelectedAI,
  resolveSelectedAI,
  resolveUserChatSelectedAI,
  selectedAILabel,
} from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import { resolveOpenRouterReasoningPointRates } from "@/lib/points";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHED_INPUT_USD_PER_MILLION,
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHE_WRITE_USD_PER_MILLION,
} from "@/lib/pointsReasoningMargins";
import {
  consumeSelectedAiEntryNotice,
  ensureUserSelectedAI,
  getUserChatSelectedAI,
  getUserSelectedAI,
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
const CHEAPER_INFERENCE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/cheaperInferenceConfig.ts"),
  "utf8"
);

function memoryDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      selected_ai TEXT NOT NULL DEFAULT '',
      ai_model_ux_json TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

describe("Opus 5 temporary user-chat disable", () => {
  it("defaults OPUS5_USER_ENABLED to false", () => {
    assert.notEqual(process.env.OPUS5_USER_ENABLED?.trim(), "1");
    assert.equal(isOpus5UserEnabled(), false);
  });

  it("hides Claude Opus 5 from the picker and keeps sibling models", () => {
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
      ),
      false
    );
    assert.match(CHAT_CLIENT_SOURCE, /userSelectableAIOptionsForUser\(isAdmin\)/);
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
      ),
      true
    );
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_GPT_56_TERRA_MODEL
      ),
      false
    );
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
      true
    );
    assert.equal(
      USER_SELECTABLE_AI_OPTIONS.some(
        (o) => o.id === CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
      ),
      true
    );
  });

  it("keeps Opus registration, pricing, and cache code", () => {
    assert.ok(
      SELECTED_AI_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL)
    );
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), true);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), "Claude Opus 5");
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    );
    const pricing = resolveOpenRouterReasoningPointRates(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      1530
    );
    assert.ok(pricing);
    assert.equal(pricing.grossMargin, 0.45);
    assert.equal(CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHED_INPUT_USD_PER_MILLION, 0.35);
    assert.equal(CHEAPER_INFERENCE_CLAUDE_OPUS_5_CACHE_WRITE_USD_PER_MILLION, 4.375);
    assert.match(CHEAPER_INFERENCE_SOURCE, /isCheaperInferenceClaudeOpus5Model/);
    assert.match(CHEAPER_INFERENCE_SOURCE, /output_config/);
  });

  it("rejects new Opus 5 selection on /api/user/selected-ai", () => {
    assert.match(SELECTED_AI_ROUTE_SOURCE, /isUserSelectableAI\(requested, isAdmin\)/);
    const allowed = new Set(USER_SELECTABLE_AI_OPTIONS.map((o) => o.id));
    assert.equal(allowed.has(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL), false);
  });

  it("does not overwrite stored Opus 5, but chat fallback uses DEFAULT", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
    );

    const storedBefore = ensureUserSelectedAI(db, 1);
    assert.equal(storedBefore.selectedAI, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(storedBefore.remappedFromRetired, false);
    assert.equal(getUserSelectedAI(db, 1), CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);

    const chatAI = getUserChatSelectedAI(db, 1);
    assert.equal(chatAI, DEFAULT_SELECTED_AI);
    assert.equal(chatAI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(isCheaperInferenceClaudeOpus5Model(chatAI), false);
    assert.equal(
      resolveUserChatSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      DEFAULT_SELECTED_AI
    );

    const storedAfter = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(storedAfter.selected_ai, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);

    const notice = consumeSelectedAiEntryNotice(db, 1);
    assert.equal(notice.selectedAI, DEFAULT_SELECTED_AI);
    assert.equal(notice.kind, null);
    const storedAfterNotice = db
      .prepare("SELECT selected_ai FROM users WHERE id=1")
      .get() as { selected_ai: string };
    assert.equal(storedAfterNotice.selected_ai, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    db.close();
  });

  it("routes an existing Opus-selected user to DeepSeek with 0 Opus provider calls", () => {
    assert.match(CHAT_ROUTE_SOURCE, /getUserChatSelectedAI\(db, user\.id, \{ isAdmin: isAdminForChat \}\)/);
    assert.doesNotMatch(
      CHAT_ROUTE_SOURCE,
      /const selectedAI = getUserSelectedAI\(db, user\.id\)/
    );

    const outbound = adaptCheaperInferenceChatBody({
      model: resolveUserChatSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
      messages: [{ role: "user", content: "hello" }],
    });
    assert.equal(outbound.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(isCheaperInferenceClaudeOpus5Model(String(outbound.model)), false);
    assert.notEqual(outbound.model, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
  });

  it("keeps DeepSeek / Gemini 3.1 / Gemini 3.7 as live user-chat models", () => {
    for (const id of [
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    ] as const) {
      assert.equal(resolveUserChatSelectedAI(id), id);
      assert.equal(resolveSelectedAI(id), id);
    }
    assert.equal(
      resolveSelectedAI(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
  });

  it("restores Opus 5 for user chat when OPUS5_USER_ENABLED=1", () => {
    const prev = process.env.OPUS5_USER_ENABLED;
    process.env.OPUS5_USER_ENABLED = "1";
    try {
      assert.equal(isOpus5UserEnabled(), true);
      assert.equal(
        resolveUserChatSelectedAI(CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL),
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL
      );
    } finally {
      if (prev === undefined) delete process.env.OPUS5_USER_ENABLED;
      else process.env.OPUS5_USER_ENABLED = prev;
    }
    assert.equal(isOpus5UserEnabled(), false);
  });
});
