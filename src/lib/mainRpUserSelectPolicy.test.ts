/**
 * Main RP user selection policy — DeepSeek retirement, no operator default.
 *
 * Generation allowlist is the live picker. Historical receipt/label helpers
 * stay separate and must not start a paid call as a different live model.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
  MAIN_RP_MODEL_IDS,
  MAIN_RP_QUALITY_BENCHMARK_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  isMainRpModel,
  isMainRpQualityBenchmarkModel,
  isUserSelectableAI,
  isValidSelectedAI,
  resolveSelectedAI,
  resolveUserSelectableMainRpAI,
  selectedAILabel,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  MODEL_SELECTION_REQUIRED_CODE,
  MODEL_SELECTION_REQUIRED_MESSAGE,
  consumeSelectedAiEntryNotice,
  ensureUserSelectedAI,
  getUserChatSelectedAI,
  isMainRpGenerationAllowed,
  setUserSelectedAI,
} from "@/lib/userSelectedAI";

const REPO_ROOT = resolve(process.cwd());

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

describe("Main RP user-select policy after DeepSeek retirement", () => {
  it("picker is four live models with no recommended badge and DeepSeek excluded", () => {
    assert.deepEqual(
      MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => option.id),
      [
        GEMINI_38_FLASH_MODEL,
        CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
        CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
        GEMINI_4_ARGON_MODEL,
      ]
    );
    assert.equal(MAIN_RP_MODEL_IDS.length, 4);
    assert.equal(MAIN_RP_USER_SELECTABLE_OPTIONS.length, 4);
    for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
      assert.notEqual(option.recommended, true, option.id);
      assert.equal("recommended" in option ? option.recommended : undefined, undefined);
    }
    assert.equal(isValidSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), false);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, false), false);
    assert.equal(isUserSelectableAI(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL, true), false);
    assert.equal(isMainRpModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), false);
    assert.equal(resolveUserSelectableMainRpAI(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), null);
    assert.equal(resolveUserSelectableMainRpAI(""), null);
    assert.equal(resolveUserSelectableMainRpAI(undefined), null);
    assert.equal(resolveUserSelectableMainRpAI("kimi"), null);
    assert.equal(resolveUserSelectableMainRpAI(GEMINI_38_FLASH_MODEL), GEMINI_38_FLASH_MODEL);
  });

  it("frozen quality roster still includes historical DeepSeek for seals/receipts", () => {
    assert.deepEqual([...MAIN_RP_QUALITY_BENCHMARK_MODEL_IDS], [
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
    ]);
    assert.equal(isMainRpQualityBenchmarkModel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), true);
    assert.equal(isMainRpQualityBenchmarkModel(GEMINI_4_ARGON_MODEL), false);
    assert.equal(isMainRpModel(GEMINI_4_ARGON_MODEL), true);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), "DeepSeek V4.1 Flash");
    assert.equal(selectedAIProvider(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL), "cheaperinference");
    assert.equal(
      resolveSelectedAI("deepseek-v4-pro"),
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    );
  });

  it("empty stored selection stays empty and does not write a default", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    db.prepare("INSERT INTO chats (id, user_id, gemini_model) VALUES (1, 1, ?)").run(
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    );
    const ensured = ensureUserSelectedAI(db, 1);
    assert.equal(ensured.selectedAI, null);
    assert.equal(ensured.seeded, false);
    assert.equal(ensured.remappedFromRetired, false);
    assert.equal(getUserChatSelectedAI(db, 1), null);
    assert.equal(isMainRpGenerationAllowed(getUserChatSelectedAI(db, 1)), false);
    const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
      selected_ai: string;
    };
    assert.equal(stored.selected_ai, "");
    const chat = db.prepare("SELECT gemini_model FROM chats WHERE id=1").get() as {
      gemini_model: string;
    };
    assert.equal(chat.gemini_model, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    db.close();
  });

  it("keeps live Gemini / Sol / Opus / Argon selections without rewrite", () => {
    const db = memoryDb();
    const live = [
      GEMINI_38_FLASH_MODEL,
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      GEMINI_4_ARGON_MODEL,
    ] as const;
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(live[0]);
    for (const modelId of live) {
      db.prepare("UPDATE users SET selected_ai=? WHERE id=1").run(modelId);
      assert.equal(getUserChatSelectedAI(db, 1), modelId);
      const stored = db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
        selected_ai: string;
      };
      assert.equal(stored.selected_ai, modelId);
      assert.equal(isMainRpGenerationAllowed(modelId), true);
    }
    db.close();
  });

  it("stored DeepSeek / unknown retired / empty require reselect and are not rewritten", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id, selected_ai) VALUES (1, ?)").run(
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    );
    assert.equal(getUserChatSelectedAI(db, 1), null);
    assert.equal(
      (
        db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
          selected_ai: string;
        }
      ).selected_ai,
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    );

    db.prepare("UPDATE users SET selected_ai=? WHERE id=1").run("kimi-k3");
    assert.equal(getUserChatSelectedAI(db, 1), null);
    assert.equal(
      (
        db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
          selected_ai: string;
        }
      ).selected_ai,
      "kimi-k3"
    );

    db.prepare("UPDATE users SET selected_ai=? WHERE id=1").run("");
    const notice = consumeSelectedAiEntryNotice(db, 1, { isFirstChatVisitEver: true });
    assert.equal(notice.selectedAI, null);
    assert.equal(notice.notice, null);
    assert.equal(notice.kind, null);
    db.close();
  });

  it("explicit setUserSelectedAI persists a live model for later chat entry", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    const saved = setUserSelectedAI(db, 1, GEMINI_4_ARGON_MODEL);
    assert.equal(saved.selectedAI, GEMINI_4_ARGON_MODEL);
    assert.equal(getUserChatSelectedAI(db, 1), GEMINI_4_ARGON_MODEL);
    const again = consumeSelectedAiEntryNotice(db, 1);
    assert.equal(again.selectedAI, GEMINI_4_ARGON_MODEL);
    db.close();
  });

  it("rejects DeepSeek as a new saved selection", () => {
    const db = memoryDb();
    db.prepare("INSERT INTO users (id) VALUES (1)").run();
    assert.throws(() =>
      setUserSelectedAI(db, 1, CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL as never)
    );
    assert.equal(
      (
        db.prepare("SELECT selected_ai FROM users WHERE id=1").get() as {
          selected_ai: string;
        }
      ).selected_ai,
      ""
    );
    db.close();
  });

  it("chat API and UI require an explicit live selection before paid generation", () => {
    const routeSrc = readFileSync(resolve(REPO_ROOT, "src/app/api/chat/route.ts"), "utf8");
    const selectedAiIdx = routeSrc.indexOf("const selectedAI = getUserChatSelectedAI(");
    const requiredIdx = routeSrc.indexOf("MODEL_SELECTION_REQUIRED_CODE", selectedAiIdx);
    const createIdx = routeSrc.indexOf("createChatSession(", selectedAiIdx);
    const leaseIdx = routeSrc.indexOf("acquireMainRpGenerationLease(", selectedAiIdx);
    const geminiMirrorIdx = routeSrc.indexOf("UPDATE chats SET gemini_model=?", selectedAiIdx);
    assert.ok(selectedAiIdx >= 0);
    assert.ok(requiredIdx > selectedAiIdx);
    assert.ok(createIdx > requiredIdx);
    assert.ok(leaseIdx > requiredIdx);
    assert.ok(geminiMirrorIdx > requiredIdx);
    assert.match(routeSrc, /code:\s*MODEL_SELECTION_REQUIRED_CODE/);

    const clientSrc = readFileSync(
      resolve(REPO_ROOT, "src/app/chat/[id]/ChatClient.tsx"),
      "utf8"
    );
    assert.match(clientSrc, /MODEL_SELECTION_REQUIRED_MESSAGE/);
    assert.match(clientSrc, /needsModelSelection/);
    assert.match(clientSrc, /<option value="" disabled>/);
    assert.doesNotMatch(clientSrc, /useState<SelectedAI>\(initialSelectedAI\)/);

    assert.equal(MODEL_SELECTION_REQUIRED_CODE, "MODEL_SELECTION_REQUIRED");
    assert.equal(MODEL_SELECTION_REQUIRED_MESSAGE, "채팅에 사용할 AI 모델을 선택해 주세요.");
  });
});
