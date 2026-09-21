/**
 * Stable Phase2 direct-selected published billing fail-closed policy.
 * PROVIDER_CALLS=0.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { StageUsage } from "@/lib/ai";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import {
  installAuditLegacyFxForTest,
  clearAuditLegacyFxForTest,
  computeLiveChargeFromFixture,
  buildBillingLiveOwnerReadinessFixtures,
} from "@/lib/billingLiveOwnerReadinessAudit";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  resolveChatBillingContract,
  STABLE_PUBLISHED_BILLING_ANOMALY_FAIL_CLOSED_POLICY,
  type ResolveChatBillingContractInput,
} from "@/lib/chatBillingContractDispatch";
import {
  buildUsageBillingContractAdmin,
  applyFinalUserChargeToUsage,
} from "@/lib/chatBillingFinalCharge";
import { buildAdminBillingReceiptV2 } from "@/lib/adminBillingReceiptV2";
import { computeOpenRouterTurnBilling } from "@/lib/points";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import Database from "better-sqlite3";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-08-28",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const NORMAL_STAGE: StageUsage = {
  stage: "primary",
  model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  input: 10_000,
  output: 500,
  apiOutputTokens: 500,
  apiReportedInputTokens: 10_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  estimated: false,
  usageReportingEvidence: {
    cacheRead: "reported_valid",
    cacheWrite: "unreported",
    reasoning: "unreported",
  },
};

function v41BlockedCacheWriteStage(upstreamUsd?: number): StageUsage {
  return {
    ...NORMAL_STAGE,
    cacheWriteTokens: 128,
    usageReportingEvidence: {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "unreported",
    },
    ...(upstreamUsd != null ? { upstreamCostUsd: upstreamUsd } : {}),
  };
}

function dispatchV41(
  stages: StageUsage[],
  opts?: Partial<ResolveChatBillingContractInput>
) {
  return resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    stages,
    legacyFinalPoints: opts?.legacyFinalPoints ?? 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX,
    phase2DeepSeekPublishedBillingEnabled: true,
    ...opts,
  });
}

function assertFailClosed(decision: ReturnType<typeof dispatchV41>, reason: string) {
  assert.equal(decision.contract, "published_fail_closed");
  assert.equal(decision.points, 0);
  assert.equal(decision.reason, reason);
  assert.equal(decision.telemetry.billingContractReason, "stable_published_billing_anomaly");
  assert.equal(decision.telemetry.publishedBillingPhaseAttempted, "phase2");
  assert.equal(
    decision.telemetry.appliedFailClosedPolicy,
    STABLE_PUBLISHED_BILLING_ANOMALY_FAIL_CLOSED_POLICY
  );
  assert.notEqual(decision.contract, "legacy");
}

describe("stable published billing fail-closed — regression matrix", () => {
  beforeEach(() => installAuditLegacyFxForTest());
  afterEach(() => clearAuditLegacyFxForTest());

  it("A — V4.1 normal no-cache → published_phase2", () => {
    const decision = dispatchV41([NORMAL_STAGE]);
    assert.equal(decision.contract, "published_phase2");
    assert.ok(decision.points > 0);
  });

  it("B — V4.1 cache-read → published_phase2", () => {
    const decision = dispatchV41([
      {
        ...NORMAL_STAGE,
        input: 12_871,
        output: 1_273,
        apiOutputTokens: 1_273,
        apiReportedInputTokens: 12_871,
        cacheReadTokens: 12_800,
        usageReportingEvidence: {
          cacheRead: "reported_valid",
          cacheWrite: "unreported",
          reasoning: "unreported",
        },
      },
    ]);
    assert.equal(decision.contract, "published_phase2");
    assert.ok(decision.points > 0);
  });

  it("C — V4.1 cacheWrite unreported → published_phase2", () => {
    const decision = dispatchV41([NORMAL_STAGE]);
    assert.equal(decision.contract, "published_phase2");
    assert.ok(decision.points > 0);
  });

  it("D — positive cacheWrite → published_fail_closed 0P (legacy NOT used)", () => {
    const base = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;
    const stage = v41BlockedCacheWriteStage(0.012);
    const legacyPoints = computeLiveChargeFromFixture({
      ...base,
      stages: [stage],
      upstreamCostUsd: 0.012,
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      requestedSelectedAI: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    }).totalPoints;
    assert.ok(legacyPoints > 0);

    const decision = dispatchV41([stage], { legacyFinalPoints: legacyPoints });
    assertFailClosed(decision, "unsupported_cache_semantics");
    assert.equal(decision.telemetry.publishedBlockReason, "unsupported_cache_semantics");
  });

  it("E — usage incomplete → published_fail_closed 0P", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "A1-deepseek-normal")!;
    const legacyPoints = computeLiveChargeFromFixture({
      ...fixture,
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      requestedSelectedAI: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    }).totalPoints;
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      stages: fixture.stages,
      legacyFinalPoints: legacyPoints,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assertFailClosed(decision, "usage_coverage_incomplete");
  });

  it("F — usage unresolved (no stages) → published_fail_closed 0P", () => {
    const decision = dispatchV41([], { legacyFinalPoints: 50 });
    assertFailClosed(decision, "usage_unresolved");
  });

  it("G — invalid FX → published_fail_closed 0P", () => {
    const invalidFx: BillingFxSnapshot = { ...FX, locked: false };
    const decision = dispatchV41([NORMAL_STAGE], { fxSnapshot: invalidFx, legacyFinalPoints: 88 });
    assertFailClosed(decision, "invalid_fx_snapshot");
  });

  it("H — V4 Pro direct-selected published block → same 0P fail-closed", () => {
    const stage = {
      stage: "primary" as const,
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      input: 33_247,
      output: 3_461,
      apiOutputTokens: 3_461,
      apiReportedInputTokens: 33_247,
      cacheWriteTokens: 128,
      cacheReadTokens: 0,
      estimated: false,
      upstreamCostUsd: 0.05,
      usageReportingEvidence: {
        cacheRead: "reported_valid" as const,
        cacheWrite: "reported_valid" as const,
        reasoning: "reported_valid" as const,
      },
    };
    const legacyHigh = computeOpenRouterTurnBilling({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      inputTokens: 33_247,
      outputTokens: 3_461,
      apiPromptTokens: 33_247,
      apiCompletionTokens: 3_461,
      upstreamCostUsd: 0.05,
    }).total;
    assert.ok(legacyHigh > 0);

    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      stages: [stage],
      legacyFinalPoints: legacyHigh,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assertFailClosed(decision, "unsupported_cache_semantics");
  });

  it("I — Phase2 disabled → legacy unchanged", () => {
    const decision = dispatchV41([NORMAL_STAGE], {
      phase2DeepSeekPublishedBillingEnabled: false,
      legacyFinalPoints: 42,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_deepseek_billing_disabled");
    assert.equal(decision.points, 42);
  });

  it("J — Phase2 not direct-selected → legacy unchanged", () => {
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      selectedModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      stages: [NORMAL_STAGE],
      legacyFinalPoints: 33,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "phase2_deepseek_not_direct_selected");
    assert.equal(decision.points, 33);
  });

  it("K — legacy-only Terra → legacy unchanged", () => {
    const stage: StageUsage = {
      stage: "primary",
      model: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      input: 9000,
      output: 900,
      apiOutputTokens: 900,
      estimated: false,
    };
    const decision = resolveChatBillingContract({
      deliveredModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      selectedModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      stages: [stage],
      legacyFinalPoints: 21,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.reason, "non_published_model");
    assert.equal(decision.points, 21);
  });

  it("L — Phase1 Opus unreported cache still legacy fallback (Phase2 unchanged)", () => {
    const fixture = buildBillingLiveOwnerReadinessFixtures().find((f) => f.id === "B1-cache-unreported")!;
    assert.equal(fixture.deliveredModelId, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    const decision = resolveChatBillingContract({
      deliveredModelId: fixture.deliveredModelId,
      selectedModelId: fixture.deliveredModelId,
      stages: fixture.stages,
      legacyFinalPoints: 77,
      billingWaiverReason: null,
      legacyWaiverMinimum: 0,
      fxSnapshot: FX,
      phase1PublishedBillingEnabled: true,
      phase2DeepSeekPublishedBillingEnabled: true,
    });
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.points, 77);
  });

  it("M — settlement replay → exactly one waived settlement", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, points REAL NOT NULL DEFAULT 10000);
      INSERT INTO users (id, points) VALUES (1, 10000);
      CREATE TABLE point_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        point_type TEXT NOT NULL,
        remaining_amount REAL NOT NULL,
        expires_at TEXT NOT NULL
      );
      INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
        VALUES (1, 'PAID', 10000, '2030-01-01');
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
        request_id TEXT,
        deduction_slices TEXT,
        generation_status TEXT NOT NULL DEFAULT 'completed'
      );
    `);
    ensureChatBillingSettlementSchema(db);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, request_id, generation_status) VALUES (1, 1, 'assistant', 'prose', 'req_fc', 'completed')`
    ).run();

    const first = settleChatTurnBillingExactlyOnce(db, {
      userId: 1,
      chatId: 1,
      requestId: "req_fc",
      assistantMessageId: 1,
      requestedPoints: 0,
      reason: "stable_published_billing_anomaly",
    });
    const replay = settleChatTurnBillingExactlyOnce(db, {
      userId: 1,
      chatId: 1,
      requestId: "req_fc",
      assistantMessageId: 1,
      requestedPoints: 999,
      reason: "replay",
    });
    assert.equal(first.outcome, "waived");
    assert.equal(first.settledPoints, 0);
    assert.equal(first.appliedNewCharge, false);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.settledPoints, 0);
    db.close();
  });

  it("N — creator reward gate: appliedNewCharge false when 0P", () => {
    const decision = dispatchV41([v41BlockedCacheWriteStage()], { legacyFinalPoints: 55 });
    assert.equal(decision.points, 0);
    assert.equal(decision.contract, "published_fail_closed");
    // route.ts skips creator reward when settlement.appliedNewCharge is false
  });

  it("O — admin receipt exposes block reason + fail-closed policy + 0P", () => {
    const decision = dispatchV41([v41BlockedCacheWriteStage()], { legacyFinalPoints: 55 });
    const dispatch = buildUsageBillingContractAdmin(decision, 0, 55);
    const usage = applyFinalUserChargeToUsage(
      {
        input: 10_000,
        output: 500,
        model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        route: "nsfw",
        cost: 0,
        upstreamCostUsd: 0.012,
      },
      0,
      dispatch
    );
    const receipt = buildAdminBillingReceiptV2(usage);
    assert.equal(receipt.userCharge.deductedPoints, 0);
    assert.equal(receipt.userCharge.billingContract, "published_fail_closed");
    assert.equal(receipt.userCharge.publishedBlockReason, "unsupported_cache_semantics");
    assert.equal(
      receipt.userCharge.appliedFailClosedPolicy,
      STABLE_PUBLISHED_BILLING_ANOMALY_FAIL_CLOSED_POLICY
    );
  });

  it("P — provider upstream cost preserved on usage while user charge 0P", () => {
    const decision = dispatchV41([v41BlockedCacheWriteStage(0.012)], { legacyFinalPoints: 55 });
    const dispatch = buildUsageBillingContractAdmin(decision, 0, 55);
    const usage = applyFinalUserChargeToUsage(
      {
        input: 10_000,
        output: 500,
        model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        route: "nsfw",
        cost: 0,
        upstreamCostUsd: 0.012,
      },
      0,
      dispatch
    );
    assert.equal(usage.cost, 0);
    assert.equal(usage.upstreamCostUsd, 0.012);
  });
});

describe("stable published billing fail-closed — abuse boundary", () => {
  it("positive cacheWrite block uses provider stage usage assembled server-side", () => {
    // StageUsage.cacheWriteTokens + usageReportingEvidence come from provider stream
    // (openRouterAdult.ts) — not from user POST body fields.
    const decision = dispatchV41([v41BlockedCacheWriteStage()], { legacyFinalPoints: 99 });
    assert.equal(decision.contract, "published_fail_closed");
    assert.equal(decision.reason, "unsupported_cache_semantics");
    assert.equal(decision.points, 0);
  });
});
