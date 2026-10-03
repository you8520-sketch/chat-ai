import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { getPointBalanceOnDb } from "@/lib/points";
import {
  ensurePortoneCheckoutTable,
  hasClientPortoneCheckoutOverride,
  isReviewerKgTestCheckout,
  markPortoneCheckoutPaid,
} from "@/lib/portoneCheckout";
import { finalizePortoneCheckoutFromProvider } from "@/lib/portonePaidFinalizer";
import { setPortOnePaymentLookupForTests } from "@/lib/portoneServer";
import {
  handlePortoneWebhookEvent,
  PORTONE_WEBHOOK_PAID,
} from "@/lib/portoneWebhook";
import {
  PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME,
  PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
  PORTONE_REVIEWER_KG_TEST_MID,
  PORTONE_REVIEWER_KG_TEST_STORE_ID,
} from "@/lib/portoneReviewerAccount";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
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
      source TEXT,
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
    CREATE TABLE user_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      actor_id INTEGER,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
  `);
  ensurePortoneCheckoutTable(db);
  db.prepare("INSERT INTO users (id, points) VALUES (1, 0)").run();
  return db;
}

function insertCheckout(
  db: Database.Database,
  opts: {
    paymentId: string;
    kind?: string;
    storeId?: string;
    channelKey?: string;
    amount?: number;
    userId?: number;
  }
): void {
  db.prepare(
    `INSERT INTO portone_checkouts
       (user_id, package_id, payment_id, amount, status, checkout_kind, store_id, channel_key)
     VALUES (?, 'p5000', ?, ?, 'pending', ?, ?, ?)`
  ).run(
    opts.userId ?? 1,
    opts.paymentId,
    opts.amount ?? 5000,
    opts.kind ?? PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND,
    opts.storeId ?? PORTONE_REVIEWER_KG_TEST_STORE_ID,
    opts.channelKey ?? PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY
  );
}

function paidRemote(paymentId: string, extra: Record<string, unknown> = {}) {
  return {
    status: "PAID",
    paymentId,
    txId: "tx-kg-test",
    totalAmount: 5000,
    storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID,
    channelKey: PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
    channelName: PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME,
    channelType: "TEST",
    pgMerchantId: PORTONE_REVIEWER_KG_TEST_MID,
    cancellations: [] as Array<{ status: string; id: string }>,
    ...extra,
  };
}

function standardRemote(paymentId: string, extra: Record<string, unknown> = {}) {
  return {
    status: "PAID",
    paymentId,
    txId: "tx-standard",
    totalAmount: 5000,
    storeId: "store-standard-live",
    channelKey: "channel-key-standard-live",
    channelType: "LIVE",
    pgMerchantId: "INIStandard",
    cancellations: [] as Array<{ status: string; id: string }>,
    ...extra,
  };
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

const previousSecret = process.env.PORTONE_API_SECRET;

describe("portone reviewer KG Inicis test checkout", () => {
  afterEach(() => {
    setPortOnePaymentLookupForTests(null);
    if (previousSecret === undefined) delete process.env.PORTONE_API_SECRET;
    else process.env.PORTONE_API_SECRET = previousSecret;
  });

  it("rejects client store, channel, and isTest overrides", () => {
    assert.equal(hasClientPortoneCheckoutOverride({ packageId: "p5000" }), false);
    assert.equal(hasClientPortoneCheckoutOverride({ storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID }), true);
    assert.equal(hasClientPortoneCheckoutOverride({ channelKey: "channel-key-other" }), true);
    assert.equal(hasClientPortoneCheckoutOverride({ isTest: true }), true);
    assert.equal(hasClientPortoneCheckoutOverride({ checkoutKind: "reviewer_kg_test" }), true);
  });

  it("marks a matching reviewer KG test checkout paid without crediting usable points", async () => {
    const db = setupDb();
    insertCheckout(db, { paymentId: "pt-reviewer-kg" });
    setPortOnePaymentLookupForTests(async () => paidRemote("pt-reviewer-kg"));

    const first = await finalizePortoneCheckoutFromProvider("pt-reviewer-kg", { db });
    const second = await finalizePortoneCheckoutFromProvider("pt-reviewer-kg", { db });
    assert.deepEqual(first, { ok: true, status: "paid", alreadyPaid: false });
    assert.deepEqual(second, { ok: true, status: "already_paid" });

    const checkout = db
      .prepare(
        `SELECT status, checkout_kind, store_id, channel_key FROM portone_checkouts WHERE payment_id='pt-reviewer-kg'`
      )
      .get() as {
      status: string;
      checkout_kind: string;
      store_id: string;
      channel_key: string;
    };
    assert.equal(checkout.status, "paid");
    assert.equal(isReviewerKgTestCheckout(checkout), true);
    assert.equal(checkout.store_id, PORTONE_REVIEWER_KG_TEST_STORE_ID);
    assert.equal(checkout.channel_key, PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY);

    const balance = getPointBalanceOnDb(db, 1);
    assert.equal(balance.total, 0);
    assert.equal(balance.paid, 0);
    assert.equal(balance.free, 0);
    const txCount = db.prepare("SELECT COUNT(*) AS c FROM point_transactions WHERE user_id=1").get() as {
      c: number;
    };
    assert.equal(txCount.c, 0);
    db.close();
  });

  it("blocks a live or other channel even when the provider says PAID", async () => {
    const db = setupDb();
    insertCheckout(db, { paymentId: "pt-reviewer-live" });
    setPortOnePaymentLookupForTests(async () =>
      paidRemote("pt-reviewer-live", {
        channelKey: "channel-key-live-or-other",
        pgMerchantId: "INIpayLive",
        channelType: "LIVE",
      })
    );

    const result = await finalizePortoneCheckoutFromProvider("pt-reviewer-live", { db });
    assert.deepEqual(result, { ok: false, status: "channel_mismatch" });
    const checkout = db
      .prepare("SELECT status FROM portone_checkouts WHERE payment_id='pt-reviewer-live'")
      .get() as { status: string };
    assert.equal(checkout.status, "pending");
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("blocks a matching key that the provider labels LIVE", async () => {
    const db = setupDb();
    insertCheckout(db, { paymentId: "pt-reviewer-typed-live" });
    setPortOnePaymentLookupForTests(async () =>
      paidRemote("pt-reviewer-typed-live", { channelType: "LIVE" })
    );
    const result = await finalizePortoneCheckoutFromProvider("pt-reviewer-typed-live", { db });
    assert.deepEqual(result, { ok: false, status: "channel_mismatch" });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("blocks a reviewer checkout whose stored identifiers were swapped", async () => {
    const db = setupDb();
    insertCheckout(db, {
      paymentId: "pt-reviewer-swap",
      storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID,
      channelKey: "channel-key-not-confirmed",
    });
    setPortOnePaymentLookupForTests(async () => paidRemote("pt-reviewer-swap"));
    const result = await finalizePortoneCheckoutFromProvider("pt-reviewer-swap", { db });
    assert.deepEqual(result, { ok: false, status: "channel_mismatch" });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("rejects a reviewer PAID snapshot that omits official channel fields", async () => {
    const db = setupDb();
    insertCheckout(db, { paymentId: "pt-reviewer-omit" });
    for (const extra of [
      { storeId: undefined },
      { channelType: undefined },
      { pgMerchantId: undefined },
    ]) {
      setPortOnePaymentLookupForTests(async () => paidRemote("pt-reviewer-omit", extra));
      const result = await finalizePortoneCheckoutFromProvider("pt-reviewer-omit", { db });
      assert.deepEqual(result, { ok: false, status: "channel_mismatch" });
    }
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("accepts an official reviewer snapshot when optional channel.key is omitted", async () => {
    const db = setupDb();
    insertCheckout(db, { paymentId: "pt-reviewer-no-key" });
    setPortOnePaymentLookupForTests(async () =>
      paidRemote("pt-reviewer-no-key", { channelKey: undefined })
    );
    const result = await finalizePortoneCheckoutFromProvider("pt-reviewer-no-key", { db });
    assert.deepEqual(result, { ok: true, status: "paid", alreadyPaid: false });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("rejects standard provider vs local store or channel mismatch and missing official fields", async () => {
    const db = setupDb();
    insertCheckout(db, {
      paymentId: "pt-standard-mismatch",
      kind: "standard",
      storeId: "store-standard-live",
      channelKey: "channel-key-standard-live",
    });
    setPortOnePaymentLookupForTests(async () =>
      standardRemote("pt-standard-mismatch", { storeId: "store-other-live" })
    );
    assert.deepEqual(await finalizePortoneCheckoutFromProvider("pt-standard-mismatch", { db }), {
      ok: false,
      status: "channel_mismatch",
    });

    setPortOnePaymentLookupForTests(async () =>
      standardRemote("pt-standard-mismatch", { channelKey: "channel-key-other-live" })
    );
    assert.deepEqual(await finalizePortoneCheckoutFromProvider("pt-standard-mismatch", { db }), {
      ok: false,
      status: "channel_mismatch",
    });

    setPortOnePaymentLookupForTests(async () =>
      standardRemote("pt-standard-mismatch", { storeId: undefined, channelType: undefined, pgMerchantId: undefined })
    );
    assert.deepEqual(await finalizePortoneCheckoutFromProvider("pt-standard-mismatch", { db }), {
      ok: false,
      status: "channel_mismatch",
    });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("rejects a standard checkout that only swaps part of the KG test identity", async () => {
    const db = setupDb();
    insertCheckout(db, {
      paymentId: "pt-standard-partial-kg",
      kind: "standard",
      storeId: "store-standard-live",
      channelKey: "channel-key-standard-live",
    });
    setPortOnePaymentLookupForTests(async () =>
      standardRemote("pt-standard-partial-kg", {
        storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID,
        channelType: "TEST",
        pgMerchantId: PORTONE_REVIEWER_KG_TEST_MID,
      })
    );
    assert.deepEqual(await finalizePortoneCheckoutFromProvider("pt-standard-partial-kg", { db }), {
      ok: false,
      status: "channel_mismatch",
    });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("credits a matching standard live-channel checkout once", async () => {
    const db = setupDb();
    insertCheckout(db, {
      paymentId: "pt-standard-ok",
      kind: "standard",
      storeId: "store-standard-live",
      channelKey: "channel-key-standard-live",
    });
    setPortOnePaymentLookupForTests(async () => standardRemote("pt-standard-ok"));
    const first = await finalizePortoneCheckoutFromProvider("pt-standard-ok", { db });
    const second = await finalizePortoneCheckoutFromProvider("pt-standard-ok", { db });
    assert.deepEqual(first, { ok: true, status: "paid", alreadyPaid: false });
    assert.deepEqual(second, { ok: true, status: "already_paid" });
    const balance = getPointBalanceOnDb(db, 1);
    assert.equal(balance.paid, 5000);
    assert.equal(balance.total, 5000);
    db.close();
  });

  it("does not let a standard checkout settle on the reviewer KG test channel", async () => {
    const db = setupDb();
    insertCheckout(db, {
      paymentId: "pt-member-kg",
      kind: "standard",
      storeId: "iamporttest_3",
      channelKey: "channel-key-member",
    });
    setPortOnePaymentLookupForTests(async () => paidRemote("pt-member-kg"));
    const result = await finalizePortoneCheckoutFromProvider("pt-member-kg", { db });
    assert.deepEqual(result, { ok: false, status: "channel_mismatch" });
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    db.close();
  });

  it("ignores webhook and complete retries so reviewer test paid never mints a lot", async () => {
    const db = setupDb();
    insertCheckout(db, { paymentId: "pt-reviewer-wh" });
    process.env.PORTONE_API_SECRET = "test-secret";
    setPortOnePaymentLookupForTests(async () => paidRemote("pt-reviewer-wh"));

    const wake = await handlePortoneWebhookEvent(
      JSON.stringify({
        type: PORTONE_WEBHOOK_PAID,
        data: { paymentId: "pt-reviewer-wh", storeId: PORTONE_REVIEWER_KG_TEST_STORE_ID },
      }),
      db
    );
    const again = await handlePortoneWebhookEvent(
      JSON.stringify({
        type: PORTONE_WEBHOOK_PAID,
        data: { paymentId: "pt-reviewer-wh" },
      }),
      db
    );
    assert.equal(wake.body.ok, true);
    assert.equal(wake.body.status, "paid");
    assert.equal(again.body.status, "already_paid");
    assert.equal(getPointBalanceOnDb(db, 1).total, 0);
    const marked = markPortoneCheckoutPaid("pt-reviewer-wh", "tx-extra", db);
    assert.deepEqual(marked, { ok: true, alreadyPaid: true });
    assert.equal(getPointBalanceOnDb(db, 1).paid, 0);
    db.close();
  });

  it("keeps prepare, complete, browser, and finance on the same checkout context", () => {
    const prepare = source("src/app/api/payments/portone/prepare/route.ts");
    const complete = source("src/app/api/payments/portone/complete/route.ts");
    const browser = source("src/lib/portoneBrowser.ts");
    const finalizer = source("src/lib/portonePaidFinalizer.ts");
    const finance = source("src/lib/adminFinance.ts");
    const example = source(".env.example");

    assert.match(prepare, /hasClientPortoneCheckoutOverride/);
    assert.match(prepare, /getPortoneReviewerKgTestCheckoutContext/);
    assert.match(prepare, /PORTONE_REVIEWER_KG_TEST_CHECKOUT_KIND/);
    assert.match(prepare, /storeId: result\.storeId/);
    assert.match(prepare, /일반 회원은 심사 테스트 채널을 사용할 수 없습니다/);
    assert.match(complete, /hasClientPortoneCheckoutOverride/);
    assert.match(complete, /isReviewerKgTestCheckout/);
    assert.match(complete, /checkout\.user_id !== user\.id/);
    assert.match(complete, /channel_mismatch/);
    assert.match(complete, /checkoutKind: checkout\.checkout_kind/);
    assert.match(complete, /credited: !isReviewerKgTestCheckout\(checkout\)/);
    assert.match(browser, /prepared\.storeId/);
    assert.match(browser, /PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE/);
    const callback = source("src/app/payments/portone/callback/page.tsx");
    const pointsClient = source("src/app/points/PointsClient.tsx");
    assert.match(callback, /reviewerTest=1/);
    assert.match(pointsClient, /reviewerTest=1/);
    assert.match(pointsClient, /PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE/);
    const config = source("src/lib/portoneConfig.ts");
    assert.match(config, /value === "1" \|\| value === "true"/);
    assert.match(browser, /prepared\.channelKey/);
    assert.doesNotMatch(browser, /PORTONE_STORE_ID/);
    assert.doesNotMatch(browser, /isTest/);
    assert.match(finalizer, /channel_mismatch/);
    assert.match(finalizer, /isConfirmedReviewerKgTestChannel/);
    assert.match(finance, /reviewer_kg_test/);
    assert.match(example, /PORTONE_REVIEWER_KG_TEST_CHECKOUT_ENABLED/);
    assert.doesNotMatch(example, /PORTONE_API_SECRET=.+/);
  });
});
