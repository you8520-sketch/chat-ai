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
import Database from "better-sqlite3";
import {
  persistAssistantMessageFinalCharge,
  resolveVariantIndicesForFinalChargePatch,
} from "@/lib/chatBillingFinalCharge";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { getDb } from "@/lib/db";
import { loadPrivilegedAdminBillingReceiptV3ForMessage } from "@/lib/adminBillingReceiptV3Server";
import { normalizeMessageVariants, type MessageVariant } from "@/lib/messageAlternates";
import type { Usage } from "@/lib/chatUsage";

const CHAT_ID = 99001;
const MESSAGE_ID = 99010;

function preSettlementUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 13573,
    output: 1459,
    model: "deepseek-v4-pro-0813",
    selectedAI: "deepseek-v4-pro-0813",
    provider: "cheaperinference",
    route: "safe",
    cost: 14,
    baseCost: 14,
    breakdown: [],
    apiInputTokens: 18427,
    apiOutputTokens: 1708,
    ...overrides,
  };
}

function openMemoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      usage TEXT,
      deduction_slices TEXT,
      alternates TEXT,
      active_variant INTEGER,
      generation_status TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function phase2Dispatch(settled: number) {
  return {
    billingContract: "published_phase2" as const,
    billingContractReason: "phase2_deepseek_live_grade",
    deliveredModelId: "deepseek-v4-pro-0813",
    publishedCandidateStatus: "resolved" as const,
    publishedBlockReason: null,
    pricingVersion: 2,
    publishedFinalPoints: settled,
    legacyFinalPoints: 14,
    settledDeductedPoints: settled,
  };
}

function phase1Dispatch(settled: number) {
  return {
    billingContract: "published_phase1" as const,
    billingContractReason: "phase1_live_grade",
    deliveredModelId: "gemini-3.7-flash",
    publishedCandidateStatus: "resolved" as const,
    publishedBlockReason: null,
    pricingVersion: 2,
    publishedFinalPoints: settled,
    legacyFinalPoints: 50,
    settledDeductedPoints: settled,
  };
}

function legacyDispatch(settled: number) {
  return {
    billingContract: "legacy" as const,
    billingContractReason: "phase2_deepseek_billing_disabled",
    deliveredModelId: "deepseek-v4-pro-0813",
    publishedCandidateStatus: "not_attempted" as const,
    publishedBlockReason: null,
    pricingVersion: null,
    publishedFinalPoints: null,
    legacyFinalPoints: settled,
    settledDeductedPoints: settled,
  };
}

function insertAssistantRow(
  db: Database.Database,
  input: {
    id: number;
    chatId: number;
    requestId: string;
    usage: Usage;
    variants: MessageVariant[];
    activeVariant: number;
    deductionSlices?: string;
  }
) {
  const active = input.variants[input.activeVariant];
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, request_id, usage, alternates, active_variant, deduction_slices, generation_status)
     VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, 'completed')`
  ).run(
    input.id,
    input.chatId,
    active?.content ?? "assistant reply",
    active?.model ?? input.usage.model,
    input.requestId,
    JSON.stringify(input.usage),
    JSON.stringify(input.variants),
    input.activeVariant,
    input.deductionSlices ?? JSON.stringify([{ pointType: "FREE", amount: 33, transactionId: 1 }])
  );
}

function readRow(db: Database.Database, id: number) {
  return db
    .prepare("SELECT usage, alternates, active_variant FROM messages WHERE id=?")
    .get(id) as { usage: string; alternates: string; active_variant: number };
}

describe("resolveVariantIndicesForFinalChargePatch", () => {
  it("matches by requestId for fresh generation", () => {
    const result = resolveVariantIndicesForFinalChargePatch({
      variants: [
        {
          content: "a",
          model: "m",
          usage: null,
          created_at: "",
          requestId: "cr_new",
        },
      ],
      requestId: "cr_new",
      activeVariant: 0,
    });
    assert.deepEqual(result, {
      patchedVariantIndices: [0],
      mode: "request_id",
      skippedCrossGeneration: false,
    });
  });

  it("does not patch when requestId matches no variant", () => {
    const result = resolveVariantIndicesForFinalChargePatch({
      variants: [
        {
          content: "old",
          model: "m",
          usage: preSettlementUsage({ cost: 10 }),
          created_at: "",
          requestId: "req-old",
        },
        {
          content: "new",
          model: "m",
          usage: preSettlementUsage({ cost: 20 }),
          created_at: "",
          requestId: "req-new",
        },
      ],
      requestId: "req-missing",
      activeVariant: 1,
    });
    assert.deepEqual(result.patchedVariantIndices, []);
    assert.equal(result.skippedCrossGeneration, true);
  });

  it("does not patch inactive generation even when requestId matches uniquely", () => {
    const result = resolveVariantIndicesForFinalChargePatch({
      variants: [
        {
          content: "old",
          model: "m",
          usage: preSettlementUsage({ cost: 10 }),
          created_at: "",
          requestId: "req-target",
        },
        {
          content: "new",
          model: "m",
          usage: preSettlementUsage({ cost: 20 }),
          created_at: "",
          requestId: "req-active",
        },
      ],
      requestId: "req-target",
      activeVariant: 1,
    });
    assert.deepEqual(result.patchedVariantIndices, []);
    assert.equal(result.mode, "none");
    assert.equal(result.skippedCrossGeneration, true);
  });
});

describe("persistAssistantMessageFinalCharge — variant parity matrix", () => {

  it("A. fresh published Phase2 parity", () => {
    const db = openMemoryDb();
    const requestId = "cr_smoke_a_parity";
    const preUsage = preSettlementUsage();
    const variants: MessageVariant[] = [
      {
        content: "reply",
        model: "deepseek-v4-pro-0813",
        usage: { ...preUsage },
        created_at: new Date().toISOString(),
        requestId,
        generationSequence: 0,
      },
    ];
    insertAssistantRow(db, {
      id: 1,
      chatId: 10,
      requestId,
      usage: { ...preUsage },
      variants,
      activeVariant: 0,
    });

    const settled = 33;
    const dispatch = phase2Dispatch(settled);
    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId,
      settledPoints: settled,
      slices: [{ pointType: "FREE", amount: settled, transactionId: 1 }],
      billingContractDispatch: dispatch,
    });

    const row = readRow(db, 1);
    const topUsage = JSON.parse(row.usage) as Usage;
    const { variants: stored, activeVariant } = normalizeMessageVariants({
      content: "reply",
      model: "deepseek-v4-pro-0813",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    const activeUsage = stored[activeVariant]?.usage;
    assert.equal(topUsage.cost, settled);
    assert.equal(activeUsage?.cost, settled);
    assert.equal(topUsage.billingContractDispatch?.billingContract, "published_phase2");
    assert.equal(activeUsage?.billingContractDispatch?.billingContract, "published_phase2");
    assert.equal(topUsage.billingContractDispatch?.pricingVersion, 2);
    assert.equal(topUsage.billingContractDispatch?.publishedFinalPoints, settled);
    assert.equal(topUsage.billingContractDispatch?.settledDeductedPoints, settled);
  });

  it("B. fresh published Phase1 parity", () => {
    const db = openMemoryDb();
    const requestId = "cr_phase1_parity";
    const preUsage = preSettlementUsage({ model: "gemini-3.7-flash", selectedAI: "gemini-3.7-flash" });
    const variants: MessageVariant[] = [
      {
        content: "reply",
        model: "gemini-3.7-flash",
        usage: { ...preUsage },
        created_at: new Date().toISOString(),
        requestId,
      },
    ];
    insertAssistantRow(db, {
      id: 1,
      chatId: 10,
      requestId,
      usage: { ...preUsage },
      variants,
      activeVariant: 0,
    });

    const settled = 90;
    const dispatch = phase1Dispatch(settled);
    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId,
      settledPoints: settled,
      slices: [{ pointType: "PAID", amount: settled, transactionId: 1 }],
      billingContractDispatch: dispatch,
    });

    const row = readRow(db, 1);
    const topUsage = JSON.parse(row.usage) as Usage;
    const { variants: stored, activeVariant } = normalizeMessageVariants({
      content: "reply",
      model: "gemini-3.7-flash",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    });
    assert.equal(topUsage.billingContractDispatch?.billingContract, "published_phase1");
    assert.equal(stored[activeVariant]?.usage?.billingContractDispatch?.billingContract, "published_phase1");
    assert.equal(topUsage.cost, settled);
    assert.equal(stored[activeVariant]?.usage?.cost, settled);
  });

  it("C. legacy contract parity", () => {
    const db = openMemoryDb();
    const requestId = "cr_legacy_parity";
    const preUsage = preSettlementUsage();
    const variants: MessageVariant[] = [
      {
        content: "reply",
        model: "deepseek-v4-pro-0813",
        usage: { ...preUsage },
        created_at: new Date().toISOString(),
        requestId,
      },
    ];
    insertAssistantRow(db, {
      id: 1,
      chatId: 10,
      requestId,
      usage: { ...preUsage },
      variants,
      activeVariant: 0,
    });

    const settled = 33;
    const dispatch = legacyDispatch(settled);
    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId,
      settledPoints: settled,
      slices: [{ pointType: "FREE", amount: settled, transactionId: 1 }],
      billingContractDispatch: dispatch,
    });

    const row = readRow(db, 1);
    const topUsage = JSON.parse(row.usage) as Usage;
    const activeUsage = normalizeMessageVariants({
      content: "reply",
      model: "deepseek-v4-pro-0813",
      usage: row.usage,
      alternates: row.alternates,
      active_variant: row.active_variant,
    }).variants[0]?.usage;
    assert.equal(topUsage.billingContractDispatch?.billingContract, "legacy");
    assert.equal(activeUsage?.billingContractDispatch?.billingContract, "legacy");
    assert.equal(topUsage.billingContractDispatch?.legacyFinalPoints, settled);
    assert.equal(topUsage.billingContractDispatch?.settledDeductedPoints, settled);
    assert.equal(topUsage.cost, settled);
    assert.equal(activeUsage?.cost, settled);
  });

  it("D. regeneration isolation preserves old variant", () => {
    const db = openMemoryDb();
    const oldUsage = preSettlementUsage({ cost: 10 });
    oldUsage.billingContractDispatch = legacyDispatch(10);
    const newPreUsage = preSettlementUsage({ cost: 20 });
    const variants: MessageVariant[] = [
      {
        content: "old",
        model: "deepseek-v4-pro-0813",
        usage: oldUsage,
        created_at: "2026-09-04T08:00:00.000Z",
        requestId: "req-old",
        generationSequence: 0,
      },
      {
        content: "new",
        model: "deepseek-v4-pro-0813",
        usage: { ...newPreUsage },
        created_at: "2026-09-04T08:01:00.000Z",
        requestId: "req-new",
        generationSequence: 1,
      },
    ];
    insertAssistantRow(db, {
      id: 1,
      chatId: 10,
      requestId: "req-new",
      usage: { ...newPreUsage },
      variants,
      activeVariant: 1,
    });

    const settled = 33;
    const dispatch = phase2Dispatch(settled);
    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId: "req-new",
      settledPoints: settled,
      slices: [{ pointType: "FREE", amount: settled, transactionId: 1 }],
      billingContractDispatch: dispatch,
    });

    const row = readRow(db, 1);
    const stored = JSON.parse(row.alternates) as MessageVariant[];
    assert.equal(stored[0]?.usage?.cost, 10);
    assert.equal(stored[0]?.usage?.billingContractDispatch?.billingContract, "legacy");
    assert.equal(stored[1]?.usage?.cost, settled);
    assert.equal(stored[1]?.usage?.billingContractDispatch?.billingContract, "published_phase2");
    const topUsage = JSON.parse(row.usage) as Usage;
    assert.equal(topUsage.cost, settled);
    assert.equal(row.active_variant, 1);
  });

  it("E. wrong-generation protection leaves non-matching variants untouched", () => {
    const db = openMemoryDb();
    const variants: MessageVariant[] = [
      {
        content: "old",
        model: "deepseek-v4-pro-0813",
        usage: preSettlementUsage({ cost: 10 }),
        created_at: "",
        requestId: "req-old",
      },
      {
        content: "new",
        model: "deepseek-v4-pro-0813",
        usage: preSettlementUsage({ cost: 20 }),
        created_at: "",
        requestId: "req-new",
      },
    ];
    insertAssistantRow(db, {
      id: 1,
      chatId: 10,
      requestId: "req-row",
      usage: preSettlementUsage({ cost: 20 }),
      variants,
      activeVariant: 1,
    });

    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId: "req-row",
      settledPoints: 33,
      slices: [{ pointType: "FREE", amount: 33, transactionId: 1 }],
      billingContractDispatch: phase2Dispatch(33),
    });

    const row = readRow(db, 1);
    const stored = JSON.parse(row.alternates) as MessageVariant[];
    assert.equal(stored[0]?.usage?.cost, 10);
    assert.equal(stored[1]?.usage?.cost, 20);
    assert.equal(JSON.parse(row.usage).cost, 33);
  });

  it("E2. inactive unique requestId match never patches any variant", () => {
    const db = openMemoryDb();
    const oldUsage = preSettlementUsage({ cost: 10 });
    oldUsage.billingContractDispatch = legacyDispatch(10);
    const variants: MessageVariant[] = [
      {
        content: "inactive matched generation",
        model: "deepseek-v4-pro-0813",
        usage: oldUsage,
        created_at: "2026-09-04T08:00:00.000Z",
        requestId: "req-target",
        generationSequence: 0,
      },
      {
        content: "active generation",
        model: "deepseek-v4-pro-0813",
        usage: preSettlementUsage({ cost: 20 }),
        created_at: "2026-09-04T08:01:00.000Z",
        requestId: "req-active",
        generationSequence: 1,
      },
    ];
    insertAssistantRow(db, {
      id: 1,
      chatId: 10,
      requestId: "req-target",
      usage: preSettlementUsage({ cost: 20 }),
      variants,
      activeVariant: 1,
    });

    const patchPlan = resolveVariantIndicesForFinalChargePatch({
      variants,
      requestId: "req-target",
      activeVariant: 1,
    });
    assert.deepEqual(patchPlan.patchedVariantIndices, []);
    assert.equal(patchPlan.skippedCrossGeneration, true);

    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId: "req-target",
      settledPoints: 33,
      slices: [{ pointType: "FREE", amount: 33, transactionId: 1 }],
      billingContractDispatch: phase2Dispatch(33),
    });

    const row = readRow(db, 1);
    const stored = JSON.parse(row.alternates) as MessageVariant[];
    assert.equal(stored[0]?.usage?.cost, 10);
    assert.equal(stored[0]?.usage?.billingContractDispatch?.billingContract, "legacy");
    assert.equal(stored[1]?.usage?.cost, 20);
    assert.equal(stored[1]?.usage?.billingContractDispatch, undefined);
    assert.equal(JSON.parse(row.usage).cost, 33);
  });

  it("F. no-variant legacy row keeps top-level patch only", () => {
    const db = openMemoryDb();
    const requestId = "req-legacy-row";
    const preUsage = preSettlementUsage();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, request_id, usage, alternates, active_variant, deduction_slices, generation_status)
       VALUES (1, 10, 'assistant', 'reply', 'deepseek-v4-pro-0813', ?, ?, NULL, NULL, ?, 'completed')`
    ).run(requestId, JSON.stringify(preUsage), JSON.stringify([{ pointType: "FREE", amount: 33, transactionId: 1 }]));

    persistAssistantMessageFinalCharge(db, {
      assistantMessageId: 1,
      chatId: 10,
      requestId,
      settledPoints: 33,
      slices: [{ pointType: "FREE", amount: 33, transactionId: 1 }],
      billingContractDispatch: phase2Dispatch(33),
    });

    const row = db
      .prepare("SELECT usage, alternates FROM messages WHERE id=1")
      .get() as { usage: string; alternates: string | null };
    const usage = JSON.parse(row.usage) as Usage;
    assert.equal(usage.cost, 33);
    assert.equal(usage.billingContractDispatch?.billingContract, "published_phase2");
    assert.equal(row.alternates, null);
  });
});

describe("admin forensic integration — Smoke A divergence regression", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    const db = getDb();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM chats").run();
    db.prepare("DELETE FROM users").run();
    db.prepare("DELETE FROM characters").run();

    db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (1, 'smoke@test.local', 'smoke', 'x')`).run();
    db.prepare(`INSERT INTO characters (id, name) VALUES (1, 'Char')`).run();
    db.prepare(
      `INSERT INTO chats (id, user_id, character_id, mode, memory_meta) VALUES (?, 1, 1, 'safe', '{}')`
    ).run(CHAT_ID);
  });

  function seedSmokeADivergenceFixture() {
    const requestId = "cr_mtmoqmcg_99vupwrw";
    const preUsage = preSettlementUsage();
    const variants: MessageVariant[] = [
      {
        content: "Smoke A assistant reply",
        model: "deepseek-v4-pro-0813",
        usage: { ...preUsage },
        created_at: "2026-09-04T08:21:48.000Z",
        requestId,
        generationSequence: 0,
        sourceMessageId: MESSAGE_ID,
      },
    ];
    const db = getDb();
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, usage, request_id, deduction_slices, generation_status, alternates, active_variant)
       VALUES (?, ?, 'assistant', ?, 'deepseek-v4-pro-0813', ?, ?, ?, 'completed', ?, 0)`
    ).run(
      MESSAGE_ID,
      CHAT_ID,
      variants[0]!.content,
      JSON.stringify(preUsage),
      requestId,
      JSON.stringify([{ pointType: "FREE", amount: 33, transactionId: 1 }]),
      JSON.stringify(variants)
    );
    return { requestId, settled: 33 };
  }

  it("reproduces missing_stored_dispatch before final-charge variant parity patch", () => {
    seedSmokeADivergenceFixture();
    const receipt = loadPrivilegedAdminBillingReceiptV3ForMessage({
      kind: "messageId",
      messageId: MESSAGE_ID,
    });
    assert.equal(receipt.ok, true);
    if (!receipt.ok) return;
    assert.equal(receipt.receipt.forensic?.billingEvidenceStatus, "missing_stored_dispatch");
    assert.equal(receipt.receipt.forensic?.billingContract, null);
  });

  it("passes admin forensic stored truth after final-charge variant parity patch", () => {
    const { requestId, settled } = seedSmokeADivergenceFixture();
    persistAssistantMessageFinalCharge(getDb(), {
      assistantMessageId: MESSAGE_ID,
      chatId: CHAT_ID,
      requestId,
      settledPoints: settled,
      slices: [{ pointType: "FREE", amount: settled, transactionId: 1 }],
      billingContractDispatch: phase2Dispatch(settled),
    });

    for (const locator of [
      { kind: "messageId" as const, messageId: MESSAGE_ID },
      { kind: "chatRequestId" as const, chatId: CHAT_ID, requestId },
    ]) {
      const loaded = loadPrivilegedAdminBillingReceiptV3ForMessage(locator);
      assert.equal(loaded.ok, true);
      if (!loaded.ok) return;
      const forensic = loaded.receipt.forensic!;
      assert.equal(forensic.billingEvidenceStatus, "complete");
      assert.equal(forensic.billingContract, "published_phase2");
      assert.equal(forensic.billingContractReason, "phase2_deepseek_live_grade");
      assert.equal(forensic.pricingVersion, 2);
      assert.equal(forensic.publishedFinalPoints, settled);
      assert.equal(forensic.settledDeductedPoints, settled);
      assert.equal(forensic.usageCost, settled);
      assert.equal(forensic.deductionSliceTotal, settled);
      assert.equal(forensic.finalChargeConsistency?.consistent, true);
      assert.deepEqual(forensic.finalChargeConsistency?.violations ?? [], []);
    }
  });
});
