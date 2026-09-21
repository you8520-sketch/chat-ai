import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import type { BillingFxSnapshot } from "@/lib/billingFxSnapshot";
import type { StageUsage } from "@/lib/ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import { resolveChatBillingContract } from "@/lib/chatBillingContractDispatch";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import { getModelPublishedPricingPolicy } from "@/lib/modelPublishedPricingPolicy";
import {
  determineRecoveryMergeRejectReason,
  traceRecoveryMerge,
} from "@/lib/recoveryMergeDiagnostic";
import {
  bootstrapStreamingTurn,
  finalizeAssistantMessage,
} from "@/lib/streamingPersistence";
import { resolveTurnBillableUsage } from "@/lib/turnBillableUsage";
import type { UsageReportingEvidence } from "@/lib/usageReportingEvidence";

const FX: BillingFxSnapshot = {
  mode: "daily_kst",
  dateKey: "2026-09-21",
  usdToKrw: 1530,
  effectiveKrwPerUsd: 1560.6,
  source: "api_daily",
  overseasFeeRate: 0.02,
  locked: true,
};

const EVIDENCE_DIR = join(
  process.cwd(),
  "docs/audits/deepseek-v41-integration-2026-09-21/evidence-correction"
);

type EvidenceOperationalRow = {
  fixtureId: string;
  requestedModelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    reasoningTokens: number | null;
  };
  usageReportingEvidence: UsageReportingEvidence | null;
};

type EvidenceOperationalFile = {
  operational: EvidenceOperationalRow[];
  production3500Recovery: {
    primary: {
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number | null; cacheWriteTokens: number | null };
      usageReportingEvidence: UsageReportingEvidence | null;
    };
    recovery: { stage: StageUsage | null };
    routeLifecycleVerified: {
      classification: string;
      assistantRowCountVerified: boolean;
      settlementCountVerified: boolean;
    };
  };
};

function loadEvidenceOperational(): EvidenceOperationalFile {
  return JSON.parse(
    readFileSync(join(EVIDENCE_DIR, "operational.json"), "utf8")
  ) as EvidenceOperationalFile;
}

function findV41Row(fixtureId: string): EvidenceOperationalRow {
  const row = loadEvidenceOperational().operational.find(
    (r) => r.fixtureId === fixtureId && r.requestedModelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
  );
  assert.ok(row, `missing V4.1 row for ${fixtureId}`);
  return row!;
}

/** Production StageUsage mapping from captured live artifact row. */
function stageFromEvidenceRow(row: EvidenceOperationalRow, stageLabel = "primary"): StageUsage {
  assert.ok(row.usageReportingEvidence, "artifact must include usageReportingEvidence");
  const stage: StageUsage = {
    stage: stageLabel,
    model: row.requestedModelId,
    input: row.usage.inputTokens,
    output: row.usage.outputTokens,
    apiOutputTokens: row.usage.outputTokens,
    apiReportedInputTokens: row.usage.inputTokens,
    estimated: false,
    usageReportingEvidence: row.usageReportingEvidence,
  };
  if (row.usage.cacheReadTokens != null && row.usage.cacheReadTokens > 0) {
    stage.cacheReadTokens = row.usage.cacheReadTokens;
  }
  if (row.usage.cacheWriteTokens != null && row.usage.cacheWriteTokens > 0) {
    stage.cacheWriteTokens = row.usage.cacheWriteTokens;
  }
  return stage;
}

function dispatchV41(stages: StageUsage[]) {
  return resolveChatBillingContract({
    deliveredModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    selectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    stages,
    legacyFinalPoints: 999,
    billingWaiverReason: null,
    legacyWaiverMinimum: 0,
    fxSnapshot: FX,
    phase1PublishedBillingEnabled: false,
    phase2DeepSeekPublishedBillingEnabled: true,
  });
}

function createRecoveryLifecycleDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE chats (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, character_id INTEGER NOT NULL);
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1);
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
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      generation_status TEXT NOT NULL DEFAULT 'completed',
      user_message_id INTEGER,
      alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      deduction_slices TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      usage TEXT,
      status_meta TEXT,
      status_widget_values_json TEXT NOT NULL DEFAULT '',
      status_widget_turn_active INTEGER NOT NULL DEFAULT 0,
      memory_relationship_task_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

describe("deepseekV41EvidenceCorrection — exact live-evidence billing replay", () => {
  it("TRUE_speech_lock V4.1 artifact → published_phase2 complete v1", () => {
    const row = findV41Row("TRUE_speech_lock");
    const stage = stageFromEvidenceRow(row);
    assert.deepEqual(row.usageReportingEvidence, {
      cacheRead: "reported_valid",
      cacheWrite: "unreported",
      reasoning: "unreported",
    });
    const usage = resolveTurnBillableUsage({
      stages: [stage],
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
    });
    assert.equal(usage.status, "resolved");
    if (usage.status === "resolved") {
      assert.equal(usage.usageCoverage, "complete");
      assert.equal(usage.diagnostics.fieldSources.cacheWrite, "MISSING_BUT_PROVEN_ZERO");
    }
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.reason, "phase2_deepseek_live_grade");
    assert.equal(decision.telemetry.pricingVersion, 1);
    assert.equal(decision.telemetry.publishedBlockReason, null);
  });

  it("TRUE_memory_recall V4.1 artifact (cache read 1664) → published_phase2 complete v1", () => {
    const row = findV41Row("TRUE_memory_recall");
    assert.equal(row.usage.cacheReadTokens, 1664);
    assert.deepEqual(row.usageReportingEvidence, {
      cacheRead: "reported_valid",
      cacheWrite: "unreported",
      reasoning: "unreported",
    });
    const stage = stageFromEvidenceRow(row);
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.reason, "phase2_deepseek_live_grade");
    assert.equal(decision.telemetry.pricingVersion, 1);
    assert.equal(decision.telemetry.publishedBlockReason, null);
  });

  it("production 3500 recovery primary+recovery stages from artifact → published_phase2", () => {
    const file = loadEvidenceOperational();
    const primary: StageUsage = {
      stage: "primary",
      model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      input: file.production3500Recovery.primary.usage.inputTokens,
      output: file.production3500Recovery.primary.usage.outputTokens,
      apiOutputTokens: file.production3500Recovery.primary.usage.outputTokens,
      apiReportedInputTokens: file.production3500Recovery.primary.usage.inputTokens,
      estimated: false,
      usageReportingEvidence: file.production3500Recovery.primary.usageReportingEvidence!,
      cacheReadTokens: file.production3500Recovery.primary.usage.cacheReadTokens ?? undefined,
    };
    const recovery = file.production3500Recovery.recovery.stage;
    assert.ok(recovery);
    const decision = dispatchV41([primary, recovery]);
    assert.equal(decision.contract, "published_phase2");
    assert.equal(decision.telemetry.publishedBlockReason, null);
  });
});

describe("deepseekV41EvidenceCorrection — synthetic blind-smoke replay reclassification", () => {
  it("old D_lore/G values are production-equivalent synthetic replay only", () => {
    const blind = JSON.parse(
      readFileSync(
        join(process.cwd(), "docs/audits/deepseek-v41-integration-2026-09-21/rp-ab/operational.json"),
        "utf8"
      )
    ) as { operational: Array<{ usageReportingEvidence?: unknown }> };
    const v41Rows = blind.operational.filter(
      (r) => (r as { requestedModelId?: string }).requestedModelId === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    );
    assert.ok(v41Rows.length > 0);
    for (const row of v41Rows) {
      assert.equal(row.usageReportingEvidence, undefined);
    }
  });
});

describe("deepseekV41EvidenceCorrection — cache write boundary", () => {
  it("unreported cacheWrite from live artifacts → MISSING_BUT_PROVEN_ZERO (billing bucket B)", () => {
    const policy = getModelPublishedPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(policy?.cacheWriteAbsentSemantics, "proven_zero");
    for (const fixtureId of ["TRUE_speech_lock", "TRUE_memory_recall"] as const) {
      const row = findV41Row(fixtureId);
      assert.equal(row.usageReportingEvidence?.cacheWrite, "unreported");
      const usage = resolveTurnBillableUsage({
        stages: [stageFromEvidenceRow(row)],
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      });
      assert.equal(usage.status, "resolved");
      if (usage.status === "resolved") {
        assert.equal(usage.diagnostics.fieldSources.cacheWrite, "MISSING_BUT_PROVEN_ZERO");
        assert.equal(usage.usageCoverage, "complete");
      }
    }
  });

  it("unexpected positive cacheWrite → unsupported_cache_semantics blocked", () => {
    const row = findV41Row("TRUE_speech_lock");
    const stage = stageFromEvidenceRow(row);
    stage.cacheWriteTokens = 128;
    stage.usageReportingEvidence = {
      cacheRead: "reported_valid",
      cacheWrite: "reported_valid",
      reasoning: "unreported",
    };
    const decision = dispatchV41([stage]);
    assert.equal(decision.contract, "legacy");
    assert.equal(decision.telemetry.publishedBlockReason, "unsupported_cache_semantics");
  });
});

describe("deepseekV41EvidenceCorrection — recovery exactly-once (provider call 0)", () => {
  it("live recovery harness does NOT verify route persistence/settlement counts", () => {
    const file = loadEvidenceOperational();
    const verified = file.production3500Recovery.routeLifecycleVerified;
    assert.equal(verified.classification, "NOT_VERIFIED_BY_LIVE_RECOVERY_HARNESS");
    assert.equal(verified.assistantRowCountVerified, false);
    assert.equal(verified.settlementCountVerified, false);
  });

  it("production merge owner — reuses recoveryMergeDiagnostic canonical fixture", () => {
    const prior = "가".repeat(500);
    const tail = "나".repeat(400);
    const merged = prior + tail;
    const reason = determineRecoveryMergeRejectReason({
      prior,
      recoveryRaw: tail,
      dedupedTail: tail,
      cappedTail: tail,
      mergedAfterFinalize: merged,
      clean: merged,
      finalProse: merged,
    });
    assert.equal(reason, null);
  });

  it("deterministic route lifecycle — one assistant finalize + one settlement (in-memory DB)", () => {
    const db = createRecoveryLifecycleDb();
    const prior = "에쉬는 렌의 허리를 감쌌다. " + "가".repeat(800);
    const recoveryRaw = "나".repeat(600);
    const merged = traceRecoveryMerge({
      prior,
      recoveryRaw,
      targetResponseChars: 3500,
      mergeOpts: { claudeRecovery: false },
    }).finalProse;

    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "v41_recovery_lifecycle",
      userContent: "유저",
      skipUserInsert: false,
    });
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE role='assistant'`).get() as { c: number }).c,
      1
    );

    const finalized = finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: merged,
      model: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      usageJson: JSON.stringify({ cost: 55 }),
      alternatesJson: "[]",
      activeVariant: 0,
      generationStatus: "completed",
    });
    assert.equal(finalized.wrote, true);

    const settlement = settleChatTurnBillingExactlyOnce(db, {
      userId: 1,
      chatId: 1,
      requestId: "v41_recovery_lifecycle",
      assistantMessageId: boot.assistantMessageId,
      requestedPoints: 55,
      reason: "v41 recovery lifecycle",
    });
    assert.equal(settlement.appliedNewCharge, true);
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM chat_billing_settlements`).get() as { c: number }).c,
      1
    );
    assert.equal(
      (db.prepare(`SELECT COUNT(*) AS c FROM messages WHERE role='assistant'`).get() as { c: number }).c,
      1
    );

    const replay = settleChatTurnBillingExactlyOnce(db, {
      userId: 1,
      chatId: 1,
      requestId: "v41_recovery_lifecycle",
      assistantMessageId: boot.assistantMessageId,
      requestedPoints: 55,
      reason: "replay",
    });
    assert.equal(replay.duplicate, true);
    db.close();
  });
});

describe("deepseekV41EvidenceCorrection — regression gates", () => {
  it("picker still excludes V4.1", () => {
    assert.equal(
      MAIN_RP_USER_SELECTABLE_OPTIONS.some((o) => o.id === CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL),
      false
    );
  });

  it("smoke fixture taxonomy documents F/G reclassification", () => {
    const taxonomy = JSON.parse(
      readFileSync(
        join(
          process.cwd(),
          "docs/audits/deepseek-v41-integration-2026-09-21/smoke-fixture-taxonomy.json"
        ),
        "utf8"
      )
    ) as {
      fixtures: Record<string, { evidenceClass: string; doNotUseAs?: string[] }>;
      historicalOperationalJsonGap: { issue: string };
    };
    assert.equal(taxonomy.fixtures.F_speech_lock.evidenceClass, "LENGTH_FREE_CONTINUATION");
    assert.deepEqual(taxonomy.fixtures.F_speech_lock.doNotUseAs, ["SPEECH_LOCK_PASS"]);
    assert.equal(
      taxonomy.fixtures.G_long_memory.evidenceClass,
      "AMBIGUOUS_SHARED_MEMORY_HANDLING"
    );
    assert.ok(taxonomy.historicalOperationalJsonGap.issue.includes("?? 0"));
  });
});
