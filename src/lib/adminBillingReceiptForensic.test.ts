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
import {
  locatePrivilegedAssistantMessage,
  parseAdminBillingReceiptLocator,
} from "@/lib/adminBillingMessageLocator";
import { buildAdminBillingForensicMetadata } from "@/lib/adminBillingForensicMetadata";
import {
  loadAdminBillingReceiptV3ForOwnedMessage,
  loadPrivilegedAdminBillingReceiptV3ForMessage,
} from "@/lib/adminBillingReceiptV3Server";
import { assertMessageAccess } from "@/lib/chatAccess";
import type { Usage } from "@/lib/chatUsage";

const ADMIN_USER_ID = 88001;
const OTHER_USER_ID = 88002;
const ADMIN_CHAT_ID = 88010;
const OTHER_CHAT_ID = 88020;
const OTHER_ASSISTANT_ID = 88021;
const REQUEST_ID = "ci_aY8Inwri_KqgwuJx";

function phase2Usage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 4000,
    output: 900,
    model: "deepseek-v4-pro-0813",
    selectedAI: "deepseek-v4-pro-0813",
    provider: "cheaperinference",
    route: "safe",
    cost: 35,
    breakdown: [],
    billingContractDispatch: {
      billingContract: "published_phase2",
      billingContractReason: "phase2_deepseek_live_grade",
      deliveredModelId: "deepseek-v4-pro-0813",
      publishedCandidateStatus: "resolved",
      publishedBlockReason: null,
      pricingVersion: 2,
      publishedFinalPoints: 35,
      legacyFinalPoints: 40,
      settledDeductedPoints: 35,
    },
    shadowPricing: {
      pricingVersion: 2,
      billingReferenceInputUsdPerMillion: 0.66,
      billingReferenceOutputUsdPerMillion: 1.98,
      billingReferenceCostKrw: 10,
      billingReferenceCostUsd: 0.01,
      fxSnapshot: {
        dateKey: "2026-09-04",
        source: "api_daily",
        baseUsdKrw: 1356,
        overseasFeeRate: 0.02,
        effectiveKrwPerUsd: 1383.12,
      },
      providerListCostStatus: "complete",
      reserveStatus: "complete",
      actualProviderCostKrw: 20,
      actualCostSource: "cheaper_inference_billed",
      providerListCostKrw: 25,
      inputCostKrw: 5,
      outputCostKrw: 5,
      reasoningCostKrw: 0,
      cacheReadCostKrw: 0,
      cacheWriteCostKrw: 0,
      targetMargin: 0.5,
      minimumMarginFloor: 0.4,
      standardUserChargeKrw: 35,
      promoPercent: 0,
      finalShadowChargeKrw: 35,
      finalShadowPoints: 35,
      providerSavingsKrw: null,
      providerOverrunKrw: null,
      promoGivebackKrw: 0,
      netPricingBufferDeltaKrw: null,
      actualGrossProfitKrw: 15,
      actualRealizedMargin: 0.5,
      worstCasePromoMargin: null,
      marginFloorViolated: null,
      modelId: "deepseek-v4-pro-0813",
      provider: "cheaperinference",
    },
    ...overrides,
  };
}

function seedForensicHarness() {
  const db = getDb();
  db.prepare("DELETE FROM messages").run();
  db.prepare("DELETE FROM chats").run();
  db.prepare("DELETE FROM users").run();
  db.prepare("DELETE FROM characters").run();

  db.prepare(
    `INSERT INTO users (id, email, nickname, pw_hash, is_admin) VALUES (?, ?, ?, ?, ?)`
  ).run(ADMIN_USER_ID, "admin@test.local", "admin", "x", 1);
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?, ?, ?, ?)`).run(
    OTHER_USER_ID,
    "smoke@test.local",
    "smoke",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (1, 'Char')`).run();
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, ?, 1, 'safe', '{}')`
  ).run(ADMIN_CHAT_ID, ADMIN_USER_ID);
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, ?, 1, 'safe', '{}')`
  ).run(OTHER_CHAT_ID, OTHER_USER_ID);

  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, usage, request_id, deduction_slices, generation_status, alternates, active_variant)
     VALUES (?, ?, 'assistant', 'reply', 'deepseek-v4-pro-0813', ?, ?, ?, 'completed', '[]', 0)`
  ).run(
    OTHER_ASSISTANT_ID,
    OTHER_CHAT_ID,
    JSON.stringify(phase2Usage()),
    REQUEST_ID,
    JSON.stringify([{ pointType: "PAID", amount: 35, transactionId: 1 }])
  );
}

describe("admin billing receipt — owner coupling regression", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  beforeEach(() => seedForensicHarness());

  it("assertMessageAccess denies admin cross-chat access (normal owner semantics unchanged)", () => {
    assert.equal(assertMessageAccess(ADMIN_USER_ID, OTHER_ASSISTANT_ID), null);
    assert.ok(assertMessageAccess(OTHER_USER_ID, OTHER_ASSISTANT_ID));
  });

  it("owned loader requires message ownership even for admin user id", () => {
    const owned = loadAdminBillingReceiptV3ForOwnedMessage({
      userId: ADMIN_USER_ID,
      messageId: OTHER_ASSISTANT_ID,
    });
    assert.equal(owned.ok, false);
    if (!owned.ok) assert.equal(owned.status, 404);
  });

  it("privileged loader allows canonical admin cross-chat forensic lookup", () => {
    const privileged = loadPrivilegedAdminBillingReceiptV3ForMessage({
      kind: "chatRequestId",
      chatId: OTHER_CHAT_ID,
      requestId: REQUEST_ID,
    });
    assert.equal(privileged.ok, true);
    if (privileged.ok) {
      assert.equal(privileged.receipt.forensic?.billingContract, "published_phase2");
      assert.equal(privileged.receipt.forensic?.publishedFinalPoints, 35);
      assert.equal(privileged.receipt.forensic?.usageCost, 35);
      assert.equal(privileged.receipt.forensic?.deductionSliceTotal, 35);
      assert.equal(privileged.receipt.forensic?.finalChargeConsistency?.consistent, true);
    }
  });
});

describe("admin billing receipt locator", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  beforeEach(() => seedForensicHarness());

  it("L1 valid messageId → success", () => {
    const parsed = parseAdminBillingReceiptLocator(
      new URLSearchParams({ messageId: String(OTHER_ASSISTANT_ID) })
    );
    assert.equal(parsed.ok, true);
    const result = loadPrivilegedAdminBillingReceiptV3ForMessage(
      parsed.ok ? parsed.locator : { kind: "messageId", messageId: 0 }
    );
    assert.equal(result.ok, true);
  });

  it("L2 valid chatId + requestId → exact assistant receipt", () => {
    const result = loadPrivilegedAdminBillingReceiptV3ForMessage({
      kind: "chatRequestId",
      chatId: OTHER_CHAT_ID,
      requestId: REQUEST_ID,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.receipt.assistantMessageId, OTHER_ASSISTANT_ID);
      assert.equal(result.receipt.forensic?.requestId, REQUEST_ID);
    }
  });

  it("L3 invalid chatId → 400 on parse", () => {
    const parsed = parseAdminBillingReceiptLocator(
      new URLSearchParams({ chatId: "0", requestId: REQUEST_ID })
    );
    assert.equal(parsed.ok, false);
  });

  it("L4 empty requestId → 400", () => {
    const parsed = parseAdminBillingReceiptLocator(
      new URLSearchParams({ chatId: String(OTHER_CHAT_ID), requestId: "  " })
    );
    assert.equal(parsed.ok, false);
  });

  it("L5 no exact assistant match → 404", () => {
    const located = locatePrivilegedAssistantMessage({
      kind: "chatRequestId",
      chatId: OTHER_CHAT_ID,
      requestId: "missing-request",
    });
    assert.equal(located.ok, false);
    if (!located.ok) assert.equal(located.status, 404);
  });

  it("L6 same requestId but wrong chatId → 404", () => {
    const located = locatePrivilegedAssistantMessage({
      kind: "chatRequestId",
      chatId: ADMIN_CHAT_ID,
      requestId: REQUEST_ID,
    });
    assert.equal(located.ok, false);
  });

  it("L7 matched row role=user only → do not return assistant receipt", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, request_id, generation_status, alternates, active_variant)
       VALUES (88099, ?, 'user', 'hi', 'user', ?, 'completed', '[]', 0)`
    ).run(OTHER_CHAT_ID, REQUEST_ID);
    const located = locatePrivilegedAssistantMessage({
      kind: "chatRequestId",
      chatId: OTHER_CHAT_ID,
      requestId: REQUEST_ID,
    });
    assert.equal(located.ok, true);
    assert.notEqual(located.ok && located.messageId, 88099);
  });

  it("L8 duplicate exact assistant rows → 409 fail closed", () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, usage, request_id, generation_status, alternates, active_variant)
       VALUES (88022, ?, 'assistant', 'dup', 'm', '{}', ?, 'completed', '[]', 0)`
    ).run(OTHER_CHAT_ID, REQUEST_ID);
    const located = locatePrivilegedAssistantMessage({
      kind: "chatRequestId",
      chatId: OTHER_CHAT_ID,
      requestId: REQUEST_ID,
    });
    assert.equal(located.ok, false);
    if (!located.ok) {
      assert.equal(located.status, 409);
      assert.equal(located.error, "ambiguous_billing_message_locator");
    }
  });

  it("L9 messageId + chatId/requestId conflicting locator → 400", () => {
    const parsed = parseAdminBillingReceiptLocator(
      new URLSearchParams({
        messageId: String(OTHER_ASSISTANT_ID),
        chatId: String(OTHER_CHAT_ID),
        requestId: REQUEST_ID,
      })
    );
    assert.equal(parsed.ok, false);
  });
});

describe("admin billing forensic metadata — stored truth only", () => {
  it("returns stored Phase2 dispatch without repricing", () => {
    const usage = phase2Usage();
    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 1,
      chatId: 756,
      requestId: REQUEST_ID,
      usage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 35, transactionId: 1 }]),
    });
    assert.equal(forensic.billingContract, "published_phase2");
    assert.equal(forensic.billingContractReason, "phase2_deepseek_live_grade");
    assert.equal(forensic.pricingVersion, 2);
    assert.equal(forensic.publishedFinalPoints, 35);
    assert.equal(forensic.billingEvidenceStatus, "complete");
    assert.equal(forensic.finalChargeConsistency?.consistent, true);
    assert.equal(forensic.fx.available, true);
    if (forensic.fx.available) {
      assert.equal(forensic.fx.dateKey, "2026-09-04");
    }
  });

  it("missing dispatch reports missing_stored_dispatch without reconstructing contract (C2)", () => {
    const usage = phase2Usage({ billingContractDispatch: undefined, cost: 35 });
    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 2,
      chatId: 756,
      requestId: "req-2",
      usage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 35, transactionId: 2 }]),
    });
    assert.equal(forensic.billingContract, null);
    assert.equal(forensic.billingEvidenceStatus, "missing_stored_dispatch");
    assert.equal(forensic.settledDeductedPoints, null);
    assert.equal(forensic.usageCost, 35);
    assert.equal(forensic.finalChargeConsistency, null);
  });

  it("mismatch surfaces consistency=false without hiding violations", () => {
    const usage = phase2Usage({
      cost: 35,
      billingContractDispatch: {
        billingContract: "published_phase2",
        billingContractReason: "phase2_deepseek_live_grade",
        deliveredModelId: "deepseek-v4-pro-0813",
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 2,
        publishedFinalPoints: 35,
        legacyFinalPoints: 40,
        settledDeductedPoints: 34,
      },
    });
    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 3,
      chatId: 756,
      requestId: "req-3",
      usage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 35, transactionId: 3 }]),
    });
    assert.equal(forensic.finalChargeConsistency?.consistent, false);
    assert.ok((forensic.finalChargeConsistency?.violations.length ?? 0) > 0);
  });

  it("C1 Published decision mismatch: publishedFinalPoints != settledDeductedPoints", () => {
    const usage = phase2Usage({
      cost: 35,
      billingContractDispatch: {
        billingContract: "published_phase2",
        billingContractReason: "phase2_deepseek_live_grade",
        deliveredModelId: "deepseek-v4-pro-0813",
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 2,
        publishedFinalPoints: 34,
        legacyFinalPoints: 40,
        settledDeductedPoints: 35,
      },
    });
    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 4,
      chatId: 756,
      requestId: "req-c1",
      usage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 35, transactionId: 4 }]),
    });
    assert.equal(forensic.finalChargeConsistency?.consistent, false);
    assert.ok(
      forensic.finalChargeConsistency?.violations.includes(
        "final_user_charge!=settled_deduction"
      )
    );
  });

  it("C3 Correct Phase2 consistency", () => {
    const usage = phase2Usage({
      cost: 35,
      billingContractDispatch: {
        billingContract: "published_phase2",
        billingContractReason: "phase2_deepseek_live_grade",
        deliveredModelId: "deepseek-v4-pro-0813",
        publishedCandidateStatus: "resolved",
        publishedBlockReason: null,
        pricingVersion: 2,
        publishedFinalPoints: 35,
        legacyFinalPoints: 40,
        settledDeductedPoints: 35,
      },
    });
    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 5,
      chatId: 756,
      requestId: "req-c3",
      usage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 35, transactionId: 5 }]),
    });
    assert.equal(forensic.finalChargeConsistency?.consistent, true);
    assert.deepEqual(forensic.finalChargeConsistency?.violations, []);
  });

  it("C4 Correct Legacy consistency", () => {
    const usage = phase2Usage({
      cost: 40,
      billingContractDispatch: {
        billingContract: "legacy",
        billingContractReason: "phase2_billing_disabled",
        deliveredModelId: "deepseek-v4-pro-0813",
        publishedCandidateStatus: "not_attempted",
        publishedBlockReason: null,
        pricingVersion: null,
        publishedFinalPoints: null,
        legacyFinalPoints: 40,
        settledDeductedPoints: 40,
      },
    });
    const forensic = buildAdminBillingForensicMetadata({
      assistantMessageId: 6,
      chatId: 756,
      requestId: "req-c4",
      usage,
      deductionSlicesRaw: JSON.stringify([{ pointType: "PAID", amount: 40, transactionId: 6 }]),
    });
    assert.equal(forensic.billingContract, "legacy");
    assert.equal(forensic.finalChargeConsistency?.consistent, true);
    assert.deepEqual(forensic.finalChargeConsistency?.violations, []);
  });
});
