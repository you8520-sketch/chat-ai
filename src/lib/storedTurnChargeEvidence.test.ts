import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { assertMessageAccess } from "@/lib/chatAccess";
import {
  loadAdminBillingReceiptV3ForOwnedMessage,
  loadPrivilegedAdminBillingReceiptV3ForMessage,
} from "@/lib/adminBillingReceiptV3Server";
import { settleChatTurnBillingExactlyOnce } from "@/lib/chatBillingSettlement";
import { loadUserMessageBillingSummaryForOwnedMessage } from "@/lib/messageBillingSummaryServer";
import { resolveStoredTurnChargeEvidence } from "@/lib/storedTurnChargeEvidence";
import { finalizeAssistantMessage } from "@/lib/streamingPersistence";
import type { Usage } from "@/lib/chatUsage";

const USER_ID = 91001;
const OTHER_USER_ID = 91002;
const CHAT_ID = 91010;
const OTHER_CHAT_ID = 91020;
const ASSISTANT_ID = 91011;
const OTHER_ASSISTANT_ID = 91021;

function seedHarness() {
  const db = getDb();
  db.prepare("DELETE FROM chat_billing_settlements").run();
  db.prepare("DELETE FROM point_logs").run();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM users").run();
  db.prepare("DELETE FROM characters").run();

  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_admin, points) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(USER_ID, "owner@test.local", "owner", "x", 0, 50000);
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash, points) VALUES (?, ?, ?, ?, ?)`).run(
    OTHER_USER_ID,
    "other@test.local",
    "other",
    "x",
    50000
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (1, 'Char')`).run();
  db.prepare(`INSERT INTO chats (id, user_id, character_id) VALUES (?, ?, 1)`).run(
    CHAT_ID,
    USER_ID
  );
  db.prepare(`INSERT INTO chats (id, user_id, character_id) VALUES (?, ?, 1)`).run(
    OTHER_CHAT_ID,
    OTHER_USER_ID
  );
  db.prepare(
    `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
     VALUES (?, 'PAID', 50000, '2030-01-01')`
  ).run(USER_ID);
  db.prepare(
    `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
     VALUES (?, 'PAID', 50000, '2030-01-01')`
  ).run(OTHER_USER_ID);
}

function completedUsage(cost: number, overrides: Partial<Usage> = {}): Usage {
  return {
    input: 4000,
    output: 900,
    model: "deepseek-v4-pro-0813",
    selectedAI: "deepseek-v4-pro-0813",
    provider: "cheaperinference",
    route: "safe",
    cost,
    breakdown: [],
    billingContractDispatch: {
      billingContract: "published_phase2",
      billingContractReason: "phase2_deepseek_live_grade",
      deliveredModelId: "deepseek-v4-pro-0813",
      publishedCandidateStatus: "resolved",
      publishedBlockReason: null,
      pricingVersion: 2,
      publishedFinalPoints: cost,
      legacyFinalPoints: cost + 5,
      settledDeductedPoints: cost,
    },
    ...overrides,
  };
}

function insertAssistant(input: {
  id: number;
  chatId?: number;
  requestId: string;
  generationStatus: string;
  usage?: Usage | null;
  deductionSlices?: string | null;
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, usage, request_id, deduction_slices, generation_status, alternates, active_variant)
     VALUES (?, ?, 'assistant', 'reply', 'deepseek-v4-pro-0813', ?, ?, ?, ?, '[]', 0)`
  ).run(
    input.id,
    input.chatId ?? CHAT_ID,
    input.usage ? JSON.stringify(input.usage) : null,
    input.requestId,
    input.deductionSlices ?? null,
    input.generationStatus
  );
}

function settleAssistant(input: {
  assistantMessageId: number;
  requestId: string;
  points: number;
  chatId?: number;
}) {
  const db = getDb();
  const settlement = settleChatTurnBillingExactlyOnce(db, {
    userId: USER_ID,
    chatId: input.chatId ?? CHAT_ID,
    requestId: input.requestId,
    assistantMessageId: input.assistantMessageId,
    requestedPoints: input.points,
    reason: "test settlement",
  });
  db.prepare(`UPDATE messages SET deduction_slices=? WHERE id=?`).run(
    JSON.stringify(settlement.slices),
    input.assistantMessageId
  );
  return settlement;
}

function resolveEvidenceForAssistant(assistantMessageId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, chat_id, request_id, generation_status, deduction_slices, usage, model
       FROM messages WHERE id=?`
    )
    .get(assistantMessageId) as {
    id: number;
    chat_id: number;
    request_id: string | null;
    generation_status: string | null;
    deduction_slices: string | null;
    usage: string | null;
    model: string;
  };
  const usage = row.usage ? (JSON.parse(row.usage) as Usage) : null;
  return resolveStoredTurnChargeEvidence(db, {
    userId: USER_ID,
    chatId: row.chat_id,
    assistantMessageId: row.id,
    requestId: row.request_id,
    generationStatus: row.generation_status,
    deductionSlicesRaw: row.deduction_slices,
    usage,
    model: row.model,
  });
}

describe("storedTurnChargeEvidence regression matrix", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  beforeEach(() => seedHarness());

  it("A completed + charged keeps existing receipt behavior", () => {
    const cost = 37;
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_completed_a",
      generationStatus: "completed",
      usage: completedUsage(cost),
      deductionSlices: JSON.stringify([{ pointType: "PAID", amount: cost, transactionId: 1 }]),
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_completed_a", points: cost });

    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "charged");
    assert.equal(evidence.settledPoints, cost);

    const receipt = loadPrivilegedAdminBillingReceiptV3ForMessage({
      kind: "messageId",
      messageId: ASSISTANT_ID,
    });
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.syncReceipt.userCharge.deductedPoints, cost);
      assert.equal(receipt.receipt.forensic?.usageSnapshotAvailable, true);
    }
  });

  it("B interrupted before settlement → not_charged", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_interrupt_pre_settle",
      generationStatus: "interrupted",
      usage: null,
    });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "not_charged");
    assert.equal(evidence.settledPoints, 0);
  });

  it("C interrupted after debit before usage persistence → charged", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_interrupt_post_debit",
      generationStatus: "interrupted",
      usage: null,
    });
    const points = 37;
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_interrupt_post_debit", points });

    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "charged");
    assert.equal(evidence.settledPoints, points);

    const receipt = loadPrivilegedAdminBillingReceiptV3ForMessage({
      kind: "messageId",
      messageId: ASSISTANT_ID,
    });
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      // STORED TRUTH ONLY: no synthetic Usage — syncReceipt is null.
      assert.equal(receipt.receipt.syncReceipt, null);
      assert.equal(receipt.receipt.forensic?.usageSnapshotAvailable, false);
      assert.equal(receipt.receipt.forensic?.usageCost, null);
      assert.equal(receipt.receipt.forensic?.billingInputTokens, null);
      assert.equal(receipt.receipt.forensic?.billingOutputTokens, null);
      assert.equal(receipt.receipt.forensic?.chargeStatus, "charged");
      assert.equal(receipt.receipt.forensic?.chargeEvidenceSettledPoints, points);
    }
  });

  it("D failed with insufficient evidence → unknown (never false 0P)", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_failed_unknown",
      generationStatus: "failed",
      usage: null,
    });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "unknown");
    assert.equal(evidence.settledPoints, null);
  });

  it("E failed_partial + charged", () => {
    const points = 29;
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_failed_partial",
      generationStatus: "failed_partial",
      usage: null,
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_failed_partial", points });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "charged");
    assert.equal(evidence.settledPoints, points);
  });

  it("F completed_with_postprocess_error + charged keeps receipt", () => {
    const points = 41;
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_postprocess_error",
      generationStatus: "completed_with_postprocess_error",
      usage: completedUsage(points),
      deductionSlices: JSON.stringify([{ pointType: "PAID", amount: points, transactionId: 2 }]),
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_postprocess_error", points });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "charged");
    assert.equal(evidence.settledPoints, points);
  });

  it("G submitted/generating → pending (not early not_charged)", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_generating",
      generationStatus: "generating",
      usage: null,
    });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "pending");
  });

  it("I failed regen scope isolation — B receipt must not inherit A settlement", () => {
    const requestA = "req_regen_a";
    const requestB = "req_regen_b";
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: requestA,
      generationStatus: "completed",
      usage: completedUsage(49),
      deductionSlices: JSON.stringify([{ pointType: "PAID", amount: 49, transactionId: 10 }]),
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: requestA, points: 49 });

    getDb()
      .prepare(
        `UPDATE messages SET request_id=?, generation_status='interrupted', usage=NULL, deduction_slices=NULL WHERE id=?`
      )
      .run(requestB, ASSISTANT_ID);

    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "not_charged");
    assert.equal(evidence.settledPoints, 0);
  });

  it("K user ownership isolation", () => {
    insertAssistant({
      id: OTHER_ASSISTANT_ID,
      chatId: OTHER_CHAT_ID,
      requestId: "req_other",
      generationStatus: "interrupted",
      usage: null,
    });
    assert.equal(assertMessageAccess(USER_ID, OTHER_ASSISTANT_ID), null);
    const owned = loadUserMessageBillingSummaryForOwnedMessage({
      userId: USER_ID,
      messageId: OTHER_ASSISTANT_ID,
    });
    assert.equal(owned.ok, false);
    if (!owned.ok) assert.equal(owned.status, 404);
  });

  it("M usage missing but settlement exists returns structured admin receipt (not 404)", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_missing_usage_settled",
      generationStatus: "interrupted",
      usage: null,
    });
    const points = 37;
    settleAssistant({
      assistantMessageId: ASSISTANT_ID,
      requestId: "req_missing_usage_settled",
      points,
    });

    const beforeOwned = loadAdminBillingReceiptV3ForOwnedMessage({
      userId: USER_ID,
      messageId: ASSISTANT_ID,
    });
    assert.equal(beforeOwned.ok, true);
    if (beforeOwned.ok) {
      assert.equal(beforeOwned.receipt.syncReceipt, null);
      assert.equal(beforeOwned.receipt.forensic?.chargeStatus, "charged");
      assert.equal(beforeOwned.receipt.forensic?.usageSnapshotAvailable, false);
      assert.equal(beforeOwned.receipt.forensic?.usageCost, null);
      assert.equal(beforeOwned.receipt.forensic?.chargeEvidenceSettledPoints, points);
    }

    const userSummary = loadUserMessageBillingSummaryForOwnedMessage({
      userId: USER_ID,
      messageId: ASSISTANT_ID,
    });
    assert.equal(userSummary.ok, true);
    if (userSummary.ok) {
      assert.equal(userSummary.summary.chargeStatus, "charged");
      assert.equal(userSummary.summary.settledPoints, points);
    }
  });

  it("N completed receipt regression remains unchanged", () => {
    const points = 35;
    const usage = completedUsage(points);
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_completed_regression",
      generationStatus: "completed",
      usage,
      deductionSlices: JSON.stringify([{ pointType: "PAID", amount: points, transactionId: 99 }]),
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_completed_regression", points });

    const receipt = loadPrivilegedAdminBillingReceiptV3ForMessage({
      kind: "messageId",
      messageId: ASSISTANT_ID,
    });
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.syncReceipt?.userCharge.deductedPoints, points);
      assert.equal(receipt.receipt.forensic?.finalChargeConsistency?.consistent, true);
      assert.equal(receipt.receipt.forensic?.usageSnapshotAvailable, true);
    }
  });

  it("O legacy_malformed → unknown, NEVER confirmed 0P", () => {
    const db = getDb();
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_legacy_malformed",
      generationStatus: "failed",
      usage: null,
      deductionSlices: "not-json",
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_legacy_malformed", points: 10 });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "unknown");
    assert.equal(evidence.settledPoints, null);
    assert.ok(evidence.violations.includes("legacy_malformed_unprovable"));
    void db;
  });

  it("P no usage + charged settlement → usage nulls, charge evidence separate", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_p_charged",
      generationStatus: "interrupted",
      usage: null,
    });
    const points = 22;
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_p_charged", points });
    const receipt = loadAdminBillingReceiptV3ForOwnedMessage({
      userId: USER_ID,
      messageId: ASSISTANT_ID,
    });
    assert.equal(receipt.ok, true);
    if (receipt.ok) {
      assert.equal(receipt.receipt.syncReceipt, null);
      assert.equal(receipt.receipt.forensic?.usageSnapshotAvailable, false);
      assert.equal(receipt.receipt.forensic?.usageCost, null);
      assert.equal(receipt.receipt.forensic?.billingInputTokens, null);
      assert.equal(receipt.receipt.forensic?.billingOutputTokens, null);
      assert.equal(receipt.receipt.forensic?.chargeStatus, "charged");
      assert.equal(receipt.receipt.forensic?.chargeEvidenceSettledPoints, points);
    }
  });

  it("Q no usage + interrupted + canonical no-debit proof → not_charged 0P", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_q_no_debit",
      generationStatus: "interrupted",
      usage: null,
    });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "not_charged");
    assert.equal(evidence.settledPoints, 0);
  });

  it("R no usage + ambiguous historical evidence → unknown", () => {
    insertAssistant({
      id: ASSISTANT_ID,
      requestId: "req_r_ambiguous",
      generationStatus: "failed",
      usage: null,
    });
    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "unknown");
    assert.equal(evidence.settledPoints, null);
  });
});

describe("storedTurnChargeEvidence — finalize path parity", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  beforeEach(() => seedHarness());

  it("completed interrupted finalize with usage still resolves charged from settlement", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, request_id, generation_status, alternates, active_variant)
       VALUES (?, ?, 'assistant', 'partial', 'deepseek-v4-pro-0813', ?, 'generating', '[]', 0)`
    ).run(ASSISTANT_ID, CHAT_ID, "req_finalize_interrupt");

    const usage = completedUsage(12);
    finalizeAssistantMessage(db, {
      assistantMessageId: ASSISTANT_ID,
      chatId: CHAT_ID,
      content: "partial but billable response",
      model: usage.model!,
      usageJson: JSON.stringify(usage),
      alternatesJson: "[]",
      activeVariant: 0,
      generationStatus: "interrupted",
    });
    settleAssistant({ assistantMessageId: ASSISTANT_ID, requestId: "req_finalize_interrupt", points: 12 });

    const evidence = resolveEvidenceForAssistant(ASSISTANT_ID);
    assert.equal(evidence.status, "charged");
    assert.equal(evidence.settledPoints, 12);
  });
});
