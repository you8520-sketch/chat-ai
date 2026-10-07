import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
} from "@/lib/chatModels";
import {
  UNDER_RECOVERED_OUTCOME,
  settleChatTurnBillingExactlyOnce,
} from "@/lib/chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { ensureChatGenerationLeaseSchema } from "@/lib/chatGenerationLeaseSchema";
import {
  acquireMainRpGenerationLease,
  bindMainRpGenerationLeaseAssistant,
} from "@/lib/mainRpGenerationAdmission";
import { computeMainRpNextTurnEstimates } from "@/lib/mainRpNextTurnEstimate";
import {
  MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER,
  admitMainRpProviderByRequiredPoints,
  resolveMainRpProviderAdmissionRequiredPoints,
} from "@/lib/mainRpProviderAdmission";
import { MIN_POINTS_TO_CHAT, creditPointsWithIds } from "@/lib/points";
import { bootstrapStreamingTurn, findTurnByRequestId } from "@/lib/streamingPersistence";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";

const ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);
const SETTLEMENT_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/chatBillingSettlement.ts"),
  "utf8"
);
const POLICY_SOURCE = fs.readFileSync(
  path.join(process.cwd(), "src/lib/mainRpProviderAdmission.ts"),
  "utf8"
);

const FX = 1560.6;
const EXPENSIVE_ESTIMATE = 220;
const EXPENSIVE_REQUIRED = resolveMainRpProviderAdmissionRequiredPoints(EXPENSIVE_ESTIMATE);

function createAdmissionDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      deduction_slices TEXT,
      generation_status TEXT,
      user_message_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      usage TEXT,
      alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL
    );
    INSERT INTO users (id, points) VALUES (1, 100), (2, 100);
    INSERT INTO chats (id, user_id) VALUES (1, 1), (2, 2);
  `);
  ensureChatBillingSettlementSchema(db);
  ensureChatGenerationLeaseSchema(db);
  return db;
}

function withDb(run: (db: Database.Database) => void): void {
  const dir = mkdtempSync(joinTmp());
  const dbPath = path.join(dir, "test.db");
  const db = createAdmissionDb(dbPath);
  try {
    run(db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function joinTmp(): string {
  return mkdtempSync(path.join(tmpdir(), "main-rp-point-admit-"));
}

type ProviderSeam = { calls: number };

type EnterInput = {
  userId: number;
  chatId: number;
  requestId: string;
  userContent: string;
  balancePoints: number;
  publishedEstimatePoints?: number | null;
  alreadyCompleted?: boolean;
};

function enterWith80POnlyFloor(
  db: Database.Database,
  input: EnterInput,
  provider: ProviderSeam
): "insufficient" | "replay" | "in_progress" | "provider" {
  if (input.balancePoints < MIN_POINTS_TO_CHAT) return "insufficient";
  const existing = findTurnByRequestId(db, input.chatId, input.requestId);
  if (isSuccessfulDurableGenerationStatus(existing.assistantStatus)) return "replay";
  const acquired = acquireMainRpGenerationLease(db, {
    userId: input.userId,
    chatId: input.chatId,
    requestId: input.requestId,
  });
  if (!acquired.ok) return "in_progress";
  const boot = bootstrapStreamingTurn(db, {
    chatId: input.chatId,
    requestId: input.requestId,
    userContent: input.userContent,
    skipUserInsert: false,
  });
  bindMainRpGenerationLeaseAssistant(db, acquired.lease, boot.assistantMessageId);
  provider.calls += 1;
  return "provider";
}

function enterWithEstimateAdmission(
  db: Database.Database,
  input: EnterInput,
  provider: ProviderSeam
): "insufficient" | "replay" | "in_progress" | "provider" {
  const floor = admitMainRpProviderByRequiredPoints({
    balancePoints: input.balancePoints,
    publishedNextTurnEstimatePoints: null,
  });
  if (!floor.ok) return "insufficient";
  const existing = findTurnByRequestId(db, input.chatId, input.requestId);
  if (isSuccessfulDurableGenerationStatus(existing.assistantStatus) || input.alreadyCompleted) {
    return "replay";
  }
  const admit = admitMainRpProviderByRequiredPoints({
    balancePoints: input.balancePoints,
    publishedNextTurnEstimatePoints: input.publishedEstimatePoints,
  });
  if (!admit.ok) return "insufficient";
  const acquired = acquireMainRpGenerationLease(db, {
    userId: input.userId,
    chatId: input.chatId,
    requestId: input.requestId,
  });
  if (!acquired.ok) return "in_progress";
  const boot = bootstrapStreamingTurn(db, {
    chatId: input.chatId,
    requestId: input.requestId,
    userContent: input.userContent,
    skipUserInsert: false,
  });
  bindMainRpGenerationLeaseAssistant(db, acquired.lease, boot.assistantMessageId);
  provider.calls += 1;
  return "provider";
}

function insertCompletedAssistant(
  db: Database.Database,
  chatId: number,
  requestId: string
): void {
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, request_id, generation_status)
     VALUES (?, 'assistant', 'saved reply', ?, 'completed')`
  ).run(chatId, requestId);
}

describe("PRE-FIX 80P-only Main RP admission gap", () => {
  it("C 80P+ but below expensive estimate still reaches the provider", () => {
    withDb((db) => {
      const provider: ProviderSeam = { calls: 0 };
      const result = enterWith80POnlyFloor(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_gap",
          userContent: "불을 켠다.",
          balancePoints: 150,
          publishedEstimatePoints: EXPENSIVE_ESTIMATE,
        },
        provider
      );
      assert.equal(result, "provider");
      assert.equal(provider.calls, 1);
      assert.ok(150 >= MIN_POINTS_TO_CHAT);
      assert.ok(150 < EXPENSIVE_REQUIRED);
    });
  });
});

describe("main RP provider point admission", () => {
  it("named multiplier is the single policy owner", () => {
    assert.equal(MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER, 3);
    assert.match(POLICY_SOURCE, /MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER/);
    assert.doesNotMatch(ROUTE_SOURCE, /\* 3\b/);
    assert.doesNotMatch(ROUTE_SOURCE, /MIN_POINTS_TO_CHAT/);
    assert.match(ROUTE_SOURCE, /resolveMainRpProviderAdmissionRequiredPoints/);
    assert.match(ROUTE_SOURCE, /resolveMainRpNextTurnPublishedEstimateForModel/);
  });

  it("A 79P is blocked before any provider call", () => {
    withDb((db) => {
      const provider: ProviderSeam = { calls: 0 };
      const result = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_a",
          userContent: "문을 두드린다.",
          balancePoints: 79,
          publishedEstimatePoints: 10,
        },
        provider
      );
      assert.equal(result, "insufficient");
      assert.equal(provider.calls, 0);
      assert.equal(resolveMainRpProviderAdmissionRequiredPoints(10), MIN_POINTS_TO_CHAT);
    });
  });

  it("B sufficient balance is admitted", () => {
    withDb((db) => {
      const provider: ProviderSeam = { calls: 0 };
      const result = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_b",
          userContent: "불을 켠다.",
          balancePoints: EXPENSIVE_REQUIRED + 50,
          publishedEstimatePoints: EXPENSIVE_ESTIMATE,
        },
        provider
      );
      assert.equal(result, "provider");
      assert.equal(provider.calls, 1);
    });
  });

  it("C 80P+ below expensive required blocks with provider call 0", () => {
    withDb((db) => {
      const provider: ProviderSeam = { calls: 0 };
      const result = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_c",
          userContent: "고가 모델",
          balancePoints: 150,
          publishedEstimatePoints: EXPENSIVE_ESTIMATE,
        },
        provider
      );
      assert.equal(result, "insufficient");
      assert.equal(provider.calls, 0);
      assert.equal(EXPENSIVE_REQUIRED, EXPENSIVE_ESTIMATE * 3);
    });
  });

  it("D/E settlement charges actual points, never the admission reserve", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 900, "PAID", "seed");
      const required = resolveMainRpProviderAdmissionRequiredPoints(200);
      const smallerBoot = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "req_de",
        userContent: "actual charge",
        skipUserInsert: false,
      });
      db.prepare(`UPDATE messages SET generation_status='completed', content=? WHERE id=?`).run(
        "정상 응답 본문",
        smallerBoot.assistantMessageId
      );
      const actualSmaller = 90;
      const smaller = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_de",
        assistantMessageId: smallerBoot.assistantMessageId,
        requestedPoints: actualSmaller,
        reason: "actual smaller than estimate",
      });
      assert.equal(smaller.settledPoints, actualSmaller);
      assert.notEqual(smaller.settledPoints, required);
      assert.doesNotMatch(SETTLEMENT_SOURCE, /resolveMainRpProviderAdmissionRequiredPoints/);
      assert.doesNotMatch(SETTLEMENT_SOURCE, /MAIN_RP_PROVIDER_ADMISSION_ESTIMATE_MULTIPLIER/);

      const largerBoot = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "req_de_large",
        userContent: "actual larger",
        skipUserInsert: false,
      });
      db.prepare(`UPDATE messages SET generation_status='completed', content=? WHERE id=?`).run(
        "정상 응답 본문",
        largerBoot.assistantMessageId
      );
      const actualLarger = 240;
      const larger = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_de_large",
        assistantMessageId: largerBoot.assistantMessageId,
        requestedPoints: actualLarger,
        reason: "actual larger than estimate",
      });
      assert.equal(larger.settledPoints, actualLarger);
      assert.ok(larger.settledPoints < required);
      assert.notEqual(larger.outcome, UNDER_RECOVERED_OUTCOME);
    });
  });

  it("F extreme overrun still uses under_recovered, not admission charge", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "PAID", "seed");
      const boot = bootstrapStreamingTurn(db, {
        chatId: 1,
        requestId: "req_f",
        userContent: "overrun",
        skipUserInsert: false,
      });
      db.prepare(`UPDATE messages SET generation_status='completed', content=? WHERE id=?`).run(
        "정상 응답 본문",
        boot.assistantMessageId
      );
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_f",
        assistantMessageId: boot.assistantMessageId,
        requestedPoints: 800,
        reason: "extreme overrun",
      });
      assert.equal(settlement.outcome, UNDER_RECOVERED_OUTCOME);
      assert.equal(settlement.settledPoints, 0);
    });
  });

  it("G concurrent second request stays generation_in_progress after admit", () => {
    withDb((db) => {
      const provider: ProviderSeam = { calls: 0 };
      const first = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_g1",
          userContent: "first",
          balancePoints: 900,
          publishedEstimatePoints: 20,
        },
        provider
      );
      const second = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_g2",
          userContent: "second",
          balancePoints: 900,
          publishedEstimatePoints: 20,
        },
        provider
      );
      assert.equal(first, "provider");
      assert.equal(second, "in_progress");
      assert.equal(provider.calls, 1);
    });
  });

  it("H completed request replay is not admission-blocked", () => {
    withDb((db) => {
      insertCompletedAssistant(db, 1, "req_h");
      const provider: ProviderSeam = { calls: 0 };
      const result = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_h",
          userContent: "replay",
          balancePoints: 80,
          publishedEstimatePoints: EXPENSIVE_ESTIMATE,
        },
        provider
      );
      assert.equal(result, "replay");
      assert.equal(provider.calls, 0);
    });
  });

  it("I regeneration and continuation are new generations and use admission", () => {
    withDb((db) => {
      insertCompletedAssistant(db, 1, "req_original");
      const provider: ProviderSeam = { calls: 0 };
      const regenBlocked = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_regen",
          userContent: "regen",
          balancePoints: 90,
          publishedEstimatePoints: EXPENSIVE_ESTIMATE,
        },
        provider
      );
      const continueBlocked = enterWithEstimateAdmission(
        db,
        {
          userId: 2,
          chatId: 2,
          requestId: "req_continue",
          userContent: "continue",
          balancePoints: 90,
          publishedEstimatePoints: EXPENSIVE_ESTIMATE,
        },
        provider
      );
      assert.equal(regenBlocked, "insufficient");
      assert.equal(continueBlocked, "insufficient");
      assert.equal(provider.calls, 0);
    });
  });

  it("H picker and admission consume the same next-turn forecast owner", () => {
    const serviceSource = fs.readFileSync(
      path.join(process.cwd(), "src/services/mainRpNextTurnEstimate.ts"),
      "utf8"
    );
    assert.match(serviceSource, /function estimatesFromRoomRows/);
    assert.match(serviceSource, /providerInputCalibrationByModel/);
    assert.match(serviceSource, /resolveMainRpNextTurnPickerEstimates/);
    assert.match(serviceSource, /resolveMainRpNextTurnPublishedEstimateForModel/);
    assert.match(ROUTE_SOURCE, /resolveMainRpNextTurnPublishedEstimateForModel/);
    assert.match(ROUTE_SOURCE, /resolveMainRpProviderAdmissionRequiredPoints/);
  });

  it("I calibrated Sol 160P still blocks 200P before any provider call", () => {
    const sol = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: 34_816 },
      lastVisibleAssistantChars: 4_213,
      observedCharsPerTokenByModel: {
        [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: 4_213 / 2_780,
      },
      providerInputCalibrationByModel: {
        [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: {
          actualProviderInputTokens: 14_312,
          assembledInputTokens: 34_816,
        },
      },
      effectiveKrwPerUsd: FX,
    })[CHEAPER_INFERENCE_GPT_61_SOL_MODEL];
    assert.ok(sol);
    assert.equal(sol!.displayPoints, 160);
    const required = resolveMainRpProviderAdmissionRequiredPoints(sol!.displayPoints);
    assert.equal(required, 480);
    withDb((db) => {
      const provider: ProviderSeam = { calls: 0 };
      const result = enterWithEstimateAdmission(
        db,
        {
          userId: 1,
          chatId: 1,
          requestId: "req_calibrated_insufficient",
          userContent: "다음 장면",
          balancePoints: 200,
          publishedEstimatePoints: sol!.displayPoints,
        },
        provider
      );
      assert.equal(result, "insufficient");
      assert.equal(provider.calls, 0);
    });
  });

  it("J cheap model 3x stays at the 80P floor; Sol and Opus rise", () => {
    const flash = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL]: 7000 },
      effectiveKrwPerUsd: FX,
    })[CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL];
    const sol = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_GPT_61_SOL_MODEL]: 7000 },
      effectiveKrwPerUsd: FX,
    })[CHEAPER_INFERENCE_GPT_61_SOL_MODEL];
    const opus = computeMainRpNextTurnEstimates({
      promptTokensByModel: { [CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL]: 7000 },
      effectiveKrwPerUsd: FX,
    })[CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL];
    assert.ok(flash && sol && opus);
    const flashRequired = resolveMainRpProviderAdmissionRequiredPoints(flash.displayPoints);
    const solRequired = resolveMainRpProviderAdmissionRequiredPoints(sol.displayPoints);
    const opusRequired = resolveMainRpProviderAdmissionRequiredPoints(opus.displayPoints);
    assert.equal(flashRequired, MIN_POINTS_TO_CHAT);
    assert.ok(solRequired > MIN_POINTS_TO_CHAT);
    assert.ok(opusRequired > solRequired);
    assert.ok(admitMainRpProviderByRequiredPoints({
      balancePoints: 80,
      publishedNextTurnEstimatePoints: flash.displayPoints,
    }).ok);
    assert.equal(
      admitMainRpProviderByRequiredPoints({
        balancePoints: 80,
        publishedNextTurnEstimatePoints: opus.displayPoints,
      }).ok,
      false
    );
  });

  it("route admits after completed-replay check and before lease/provider", () => {
    const replayAt = ROUTE_SOURCE.indexOf("const alreadyCompletedTurn");
    const afterReplay = ROUTE_SOURCE.slice(replayAt);
    const requiredAt = afterReplay.indexOf("resolveMainRpProviderAdmissionRequiredPoints");
    const leaseAt = afterReplay.indexOf("acquireMainRpGenerationLease(");
    const providerAt = afterReplay.indexOf("streamOpenRouterAdultToClient(");
    assert.ok(replayAt > 0);
    assert.ok(requiredAt > 0);
    assert.ok(leaseAt > requiredAt);
    assert.ok(providerAt > leaseAt);
  });
});
