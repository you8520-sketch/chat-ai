import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ensurePortoneCheckoutTable,
  markPortoneCheckoutPaid,
} from "@/lib/portoneCheckout";
import { getPointBalanceOnDb } from "@/lib/points";

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
  return db;
}

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function productionSources(root: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionSources(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

describe("verified point charge payment boundary", () => {
  it("same PortOne payment finalizes and credits exactly once", () => {
    const db = setupDb();
    db.prepare("INSERT INTO users (id, points) VALUES (1, 0)").run();
    db.prepare(
      `INSERT INTO portone_checkouts
       (user_id, package_id, payment_id, amount, status)
       VALUES (1, 'p5000', 'pay-1', 5000, 'pending')`
    ).run();

    const first = markPortoneCheckoutPaid("pay-1", "tx-first", db);
    const second = markPortoneCheckoutPaid("pay-1", "tx-second", db);

    assert.deepEqual(first, { ok: true, alreadyPaid: false });
    assert.deepEqual(second, { ok: true, alreadyPaid: true });

    const checkout = db
      .prepare("SELECT status, portone_tx_id FROM portone_checkouts WHERE payment_id='pay-1'")
      .get() as { status: string; portone_tx_id: string };
    assert.equal(checkout.status, "paid");
    assert.equal(checkout.portone_tx_id, "tx-first");

    const txCount = db
      .prepare("SELECT COUNT(*) AS c FROM point_transactions WHERE user_id=1")
      .get() as { c: number };
    assert.equal(txCount.c, 1);

    const chargeLogCount = db
      .prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND reason LIKE '포인트 충전%'")
      .get() as { c: number };
    assert.equal(chargeLogCount.c, 1);

    const batchCount = db
      .prepare("SELECT COUNT(*) AS c FROM point_charge_batches WHERE user_id=1")
      .get() as { c: number };
    assert.equal(batchCount.c, 1);

    const notificationCount = db
      .prepare("SELECT COUNT(*) AS c FROM user_notifications WHERE user_id=1 AND type='payment_success'")
      .get() as { c: number };
    assert.equal(notificationCount.c, 1);

    const balance = getPointBalanceOnDb(db, 1);
    assert.equal(balance.total, 5000);
    assert.equal(balance.paid, 5000);
    assert.equal(balance.free, 0);

    db.close();
  });

  it("legacy mock charge API cannot mint points", () => {
    const route = source("src/app/api/points/charge/route.ts");
    assert.match(route, /POINT_CHARGE_REQUIRES_VERIFIED_PAYMENT_MESSAGE/);
    assert.match(route, /status:\s*503/);
    assert.doesNotMatch(route, /creditPointChargePackage/);
    assert.doesNotMatch(route, /POINT_CHARGE_PACKAGES_BY_ID/);
  });

  it("points UI has no mock-charge fallback", () => {
    const client = source("src/app/points/PointsClient.tsx");
    assert.doesNotMatch(client, /chargeMock/);
    assert.doesNotMatch(client, /\/api\/points\/charge/);
    assert.doesNotMatch(client, /모의 결제/);
    assert.match(client, /runPortOnePointCharge/);
  });

  it("checkout enablement requires both browser and server verification configuration", () => {
    const config = source("src/lib/portoneConfig.ts");
    const prepare = source("src/app/api/payments/portone/prepare/route.ts");

    assert.match(config, /isPortOneBrowserConfigured\(\)/);
    assert.match(config, /isPortOneServerVerifyConfigured\(\)/);
    assert.match(prepare, /isPortOneServerVerifyConfigured\(\)/);
    assert.match(prepare, /status:\s*503/);
  });

  it("server completion requires a concrete verified amount match", () => {
    const complete = source("src/app/api/payments/portone/complete/route.ts");
    assert.match(complete, /remote\.totalAmount == null/);
    assert.match(complete, /remote\.totalAmount !== checkout\.amount/);
  });

  it("point credit writer has one production caller", () => {
    const files = productionSources(path.join(process.cwd(), "src"));
    const callers: string[] = [];

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      if (/creditPointChargePackage\s*\(/.test(text)) {
        callers.push(path.relative(process.cwd(), file).replace(/\\/g, "/"));
      }
    }

    assert.deepEqual(callers.sort(), [
      "src/lib/pointCharge.ts",
      "src/lib/portoneCheckout.ts",
    ]);
  });

  it("verified checkout claims paid status before crediting points", () => {
    const checkout = source("src/lib/portoneCheckout.ts");
    const claimIndex = checkout.indexOf("WHERE id=? AND status='pending'");
    const creditIndex = checkout.indexOf("creditPointChargePackage");

    assert.ok(claimIndex >= 0, "conditional paid claim must exist");
    assert.ok(creditIndex > claimIndex, "credit must happen after the conditional claim");
  });
});
