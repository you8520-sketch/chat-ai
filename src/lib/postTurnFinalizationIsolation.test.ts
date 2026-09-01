import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import Database from "better-sqlite3";
import type { StageUsage } from "@/lib/ai";
import {
  AUDIT_FX_SNAPSHOT,
  buildBillingLiveOwnerReadinessFixtures,
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
} from "@/lib/billingLiveOwnerReadinessAudit";
import { CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL } from "@/lib/chatModels";
import {
  resolveChatBillingContract,
  type ResolveChatBillingContractInput,
} from "@/lib/chatBillingContractDispatch";
import {
  applyFinalUserChargeToUsage,
  buildUsageBillingContractAdmin,
  persistAssistantMessageFinalCharge,
} from "@/lib/chatBillingFinalCharge";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import type { ResolveStatusWidgetTurnValuesInput } from "@/lib/statusWidget/telemetry";
import {
  resolveBillingContractForTurn,
  runStatusWidgetTurnIsolated,
  sanitizeClientDonePayload,
} from "@/lib/postTurnFinalizationIsolation";

function g37PrimaryStage(output: number): StageUsage {
  return {
    stage: "primary",
    model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    input: 9000,
    output,
    apiOutputTokens: output,
    apiReportedInputTokens: 9000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimated: false,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "reported_valid",
    },
  };
}

function g37DispatchInput(
  overrides: Partial<ResolveChatBillingContractInput> = {}
): ResolveChatBillingContractInput {
  return {
    deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    stages: [g37PrimaryStage(2500)],
    legacyFinalPoints: 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: AUDIT_FX_SNAPSHOT,
    phase1PublishedBillingEnabled: true,
    ...overrides,
  };
}

function widgetInput(savedText: string): ResolveStatusWidgetTurnValuesInput {
  return {
    chatId: 1,
    modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
    regenerate: false,
    savedText,
    rawWidgetSourceText: savedText,
    statusWidgetTurn: {
      active: true,
      needsCharacterValues: true,
      needsUserValues: false,
      characterWidget: { fields: [] },
      userWidget: null,
    },
    charName: "Test",
    characterIdentity: "Test",
    personaName: "User",
    userPersona: "User",
    personaDescription: null,
    personaSpeechExamples: null,
    userMessage: "hello",
    userNote: null,
    assistantMessageId: 42,
    requestId: "req-widget-test",
    userId: 7,
    characterId: 3,
    coalesceSuggestedReplies: false,
  };
}

function createSettlementDb(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "post-turn-isolation-"));
  const db = new Database(join(dir, "test.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, points REAL NOT NULL DEFAULT 10000, creator_points REAL NOT NULL DEFAULT 0, creator_exclusive INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE characters (id INTEGER PRIMARY KEY, creator_id INTEGER, official INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE chats (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      deduction_slices TEXT,
      generation_status TEXT,
      usage TEXT
    );
    CREATE TABLE point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO users (id, points) VALUES (1, 10000);
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (1, 'PAID', 10000, '2030-01-01');
    INSERT INTO characters (id, creator_id, official) VALUES (1, NULL, 1);
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1);
    INSERT INTO messages (id, chat_id, role, content, request_id, generation_status) VALUES (10, 1, 'assistant', 'saved prose', 'req-settle', 'completed');
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

describe("postTurnFinalizationIsolation — A widget exception fail-open", () => {
  it("preserves main prose and does not throw when widget resolver throws", async () => {
    const savedText = "Main RP body preserved.";
    const outcome = await runStatusWidgetTurnIsolated(widgetInput(savedText), savedText, {
      resolveStatusWidgetTurnValues: async () => {
        throw new TypeError("widget resolver synthetic failure");
      },
    });
    assert.equal(outcome.prose, savedText);
    assert.equal(outcome.failed, true);
    assert.equal(outcome.values, null);
    assert.match(outcome.errorMessage ?? "", /widget resolver synthetic failure/);
  });
});

describe("postTurnFinalizationIsolation — B published billing normal success", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("G37 published path completes without TypeError and matches settlement", () => {
    const legacyPoints = 999;
    const isolated = resolveBillingContractForTurn({
      deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      stages: [g37PrimaryStage(2500)],
      legacyFinalPoints: legacyPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
      phase1PublishedBillingEnabled: true,
    });
    assert.equal(isolated.isolatedFailure, false);
    assert.equal(isolated.decision.contract, "published_phase1");
    assert.ok(isolated.decision.contract === "published_phase1" && isolated.decision.points > 0);

    const db = createSettlementDb();
    try {
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req-settle",
        assistantMessageId: 10,
        requestedPoints: isolated.decision.points,
        reason: "G37 published test",
      });
      assert.equal(settlement.appliedNewCharge, true);
      assert.equal(settlement.settledPoints, isolated.decision.points);

      const billingAdmin = buildUsageBillingContractAdmin(
        isolated.decision,
        settlement.settledPoints,
        legacyPoints
      );
      const usage = applyFinalUserChargeToUsage(
        { model: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL, cost: 0 },
        settlement.settledPoints,
        billingAdmin
      );
      assert.equal(usage.cost, settlement.settledPoints);

      persistAssistantMessageFinalCharge(db, {
        assistantMessageId: 10,
        chatId: 1,
        requestId: "req-settle",
        settledPoints: settlement.settledPoints,
        slices: settlement.slices,
        billingContractDispatch: billingAdmin,
      });
    } finally {
      db.close();
    }
  });
});

describe("postTurnFinalizationIsolation — C published candidate blocked/incomplete producers", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("undefined resolveTurnBillableUsage → legacy fallback without TypeError", () => {
    const decision = resolveChatBillingContract(g37DispatchInput(), {
      resolveTurnBillableUsage: () => undefined as never,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "usage_unresolved");
    assert.equal(
      decision.telemetry.publishedBlockReason,
      "turn_billable_usage_producer_contract_violation"
    );
  });

  it("undefined computePublishedUserChargeWithSnapshot → legacy fallback without TypeError", () => {
    const decision = resolveChatBillingContract(g37DispatchInput(), {
      computePublishedUserChargeWithSnapshot: () => undefined as never,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "published_blocked");
    assert.equal(
      decision.telemetry.publishedBlockReason,
      "published_charge_producer_contract_violation"
    );
  });

  it("resolveBillingContractForTurn catches dispatch throw and falls back to legacy", () => {
    const outcome = resolveBillingContractForTurn(
      {
        deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        stages: [g37PrimaryStage(2500)],
        legacyFinalPoints: 120,
        billingWaiverReason: null,
        legacyWaiverMinimum: 0,
        fxSnapshot: AUDIT_FX_SNAPSHOT,
        phase1PublishedBillingEnabled: true,
      },
      {
        resolveChatBillingContract: () => {
          throw new TypeError("Cannot read properties of undefined (reading 'status')");
        },
      }
    );
    assert.equal(outcome.isolatedFailure, true);
    assert.equal(outcome.decision.contract, "legacy");
    assert.equal(outcome.decision.points, 120);
    assert.match(outcome.failureReason ?? "", /reading 'status'/);
  });

  it("FLAG=0 vs FLAG=1: complete G37 usage — flag off legacy, flag on published", () => {
    const legacyPoints = 888;
    const completeInput = {
      deliveredModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      stages: [g37PrimaryStage(2500)],
      legacyFinalPoints: legacyPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
    };
    const legacyOff = resolveBillingContractForTurn({
      ...completeInput,
      phase1PublishedBillingEnabled: false,
    });
    const publishedOn = resolveBillingContractForTurn({
      ...completeInput,
      phase1PublishedBillingEnabled: true,
    });
    assert.equal(legacyOff.decision.contract, "legacy");
    assert.equal(legacyOff.decision.points, legacyPoints);
    assert.equal(publishedOn.decision.contract, "published_phase1");
    assert.notEqual(publishedOn.decision.points, legacyPoints);
  });

  it("A1-g37-normal incomplete fixture stays legacy even when flag=1", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-g37-normal")!;
    const decision = resolveBillingContractForTurn({
      deliveredModelId: fixture.deliveredModelId,
      stages: fixture.stages,
      legacyFinalPoints: 777,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: AUDIT_FX_SNAPSHOT,
      phase1PublishedBillingEnabled: true,
    });
    assert.equal(decision.decision.contract, "legacy");
    assert.equal(decision.decision.points, 777);
  });
});

describe("postTurnFinalizationIsolation — D malformed client done payload", () => {
  it("tolerates missing optional usage/variants without throwing", () => {
    const payload = sanitizeClientDonePayload({
      type: "done",
      chatId: 1,
      messageId: 2,
      finalContent: "ok",
      usage: undefined,
      variants: undefined,
      statusWidgetValues: undefined,
    });
    assert.equal(payload.type, "done");
    assert.equal("usage" in payload, false);
    assert.equal("variants" in payload, false);
    assert.equal(payload.statusWidgetValues, null);
  });
});

describe("postTurnFinalizationIsolation — E settlement replay", () => {
  it("duplicate finalization keeps SETTLEMENT_COUNT=1", () => {
    const db = createSettlementDb();
    try {
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req-settle",
        assistantMessageId: 10,
        requestedPoints: 55,
        reason: "first",
      });
      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req-settle",
        assistantMessageId: 10,
        requestedPoints: 55,
        reason: "replay",
      });
      assert.equal(first.appliedNewCharge, true);
      assert.equal(second.appliedNewCharge, false);
      assert.equal(second.duplicate, true);
      assert.equal(first.settledPoints, 55);
      assert.equal(second.settledPoints, 55);
      const logCount = (
        db.prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND delta < 0").get() as {
          c: number;
        }
      ).c;
      assert.equal(logCount, 1);
    } finally {
      db.close();
    }
  });
});
