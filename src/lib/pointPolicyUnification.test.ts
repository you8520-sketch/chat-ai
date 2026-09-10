import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { getDb } from "./db";
import {
  creditPoints,
  deductPoints,
  getPointBalance,
  InsufficientPointsError,
  PAID_POINTS_VALID_YEARS,
} from "./points";
import { FREE_POINTS_VALID_YEARS } from "./plans";
import { claimDailyAttendance } from "./attendance";
import { giftPoints, PointGiftError } from "./pointGifts";
import {
  computeGiftBreakdown,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
} from "./pointGiftsShared";
import { refundMessageDeduction } from "./refund";

const TAG = `pptest_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
const FAKE_MESSAGE_ID = -987654321;

function createTestUser(suffix: string): { id: number; nickname: string } {
  const db = getDb();
  const nickname = `${TAG}_${suffix}`;
  const email = `${nickname}@pptest.local`;
  db.prepare("DELETE FROM user_notifications WHERE user_id IN (SELECT id FROM users WHERE email=?)").run(email);
  db.prepare(
    "DELETE FROM point_gifts WHERE sender_id IN (SELECT id FROM users WHERE email=?) OR recipient_id IN (SELECT id FROM users WHERE email=?)"
  ).run(email, email);
  db.prepare("DELETE FROM point_transactions WHERE user_id IN (SELECT id FROM users WHERE email=?)").run(email);
  db.prepare("DELETE FROM point_logs WHERE user_id IN (SELECT id FROM users WHERE email=?)").run(email);
  db.prepare("DELETE FROM attendance_checkins WHERE user_id IN (SELECT id FROM users WHERE email=?)").run(email);
  db.prepare("DELETE FROM users WHERE email=?").run(email);
  const row = db
    .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
    .run(email, nickname, "x");
  return { id: Number(row.lastInsertRowid), nickname };
}

after(() => {
  const db = getDb();
  const ids = (
    db.prepare("SELECT id FROM users WHERE email LIKE '%@pptest.local'").all() as { id: number }[]
  ).map((row) => row.id);
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`DELETE FROM user_notifications WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(
    `DELETE FROM point_gifts WHERE sender_id IN (${placeholders}) OR recipient_id IN (${placeholders})`
  ).run(...ids, ...ids);
  db.prepare(`DELETE FROM point_transactions WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM point_logs WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM attendance_checkins WHERE user_id IN (${placeholders})`).run(...ids);
  db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`).run(...ids);
});

function userLots(userId: number) {
  const db = getDb();
  return db
    .prepare(
      "SELECT id, point_type, remaining_amount, expires_at, created_at FROM point_transactions WHERE user_id=? ORDER BY id"
    )
    .all(userId) as {
    id: number;
    point_type: string;
    remaining_amount: number;
    expires_at: string;
    created_at: string;
  }[];
}

function daysBetween(fromText: string, toText: string): number {
  const from = new Date(fromText.replace(" ", "T") + "Z").getTime();
  const to = new Date(toText.replace(" ", "T") + "Z").getTime();
  return (to - from) / 86400000;
}

function daysUntilExpiry(expiresAt: string): number {
  return (new Date(expiresAt.replace(" ", "T") + "Z").getTime() - Date.now()) / 86400000;
}

function isAttendanceError(err: unknown): boolean {
  return err instanceof PointGiftError && (err as { code?: unknown }).code === "ATTENDANCE_NOT_GIFTABLE";
}

describe("point policy unification — canonical durations", () => {
  it("POLICY-1 canonical duration and fee constants match the confirmed product policy", () => {
    assert.equal(FREE_POINTS_VALID_YEARS, 1);
    assert.equal(PAID_POINTS_VALID_YEARS, 1);
    assert.equal(POINT_GIFT_FEE_RATE_FREE, 0.2);
    assert.equal(POINT_GIFT_FEE_RATE_PAID, 0.1);
    assert.equal(MIN_POINT_GIFT_AMOUNT, 10);
  });

  it("POLICY-2 attendance grant expires 30 days from accrual", () => {
    const user = createTestUser("att30");
    const claimed = claimDailyAttendance(user.id);
    assert.equal(claimed.ok, true);
    assert.equal(claimed.alreadyClaimed, false);
    const lots = userLots(user.id);
    assert.equal(lots.length, 1);
    const validityDays = daysBetween(lots[0]!.created_at, lots[0]!.expires_at);
    assert.ok(
      Math.abs(validityDays - 30) < 1,
      `attendance validity=${validityDays.toFixed(2)}d, expected 30d`
    );
  });

  it("POLICY-3 generic free grant expires in 1 year", () => {
    const user = createTestUser("free1y");
    creditPoints(user.id, 100, "FREE", "pptest generic free");
    const lots = userLots(user.id);
    assert.equal(lots.length, 1);
    const validityDays = daysBetween(lots[0]!.created_at, lots[0]!.expires_at);
    assert.ok(
      Math.abs(validityDays - 365) < 4,
      `free validity=${validityDays.toFixed(1)}d, expected ~365d`
    );
  });

  it("POLICY-4 paid grant expires in 1 year", () => {
    const user = createTestUser("paid1y");
    creditPoints(user.id, 100, "PAID", "pptest paid");
    const lots = userLots(user.id);
    assert.equal(lots.length, 1);
    const validityDays = daysBetween(lots[0]!.created_at, lots[0]!.expires_at);
    assert.ok(
      Math.abs(validityDays - 365) < 4,
      `paid validity=${validityDays.toFixed(1)}d, expected ~365d`
    );
  });

  it("POLICY-5 expired lots are excluded from balance and spend", () => {
    const user = createTestUser("exp excl");
    const db = getDb();
    db.prepare(
      "INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (?, 'FREE', 100, datetime('now','-1 day'))"
    ).run(user.id);
    assert.equal(getPointBalance(user.id).total, 0);
    assert.throws(() => deductPoints(user.id, 10, "pptest"), InsufficientPointsError);
  });

  it("POLICY-6 expiry boundary: +60s lot is available, -60s lot is not", () => {
    const user = createTestUser("expbnd");
    const db = getDb();
    db.prepare(
      "INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (?, 'FREE', 100, datetime('now','+60 seconds'))"
    ).run(user.id);
    db.prepare(
      "INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (?, 'FREE', 50, datetime('now','-60 seconds'))"
    ).run(user.id);
    assert.equal(getPointBalance(user.id).total, 100);
  });
});

describe("point policy unification — gift fee economics (semantics B)", () => {
  it("FEE-1 free gift fee is exactly 20% (gross debit, net credit)", () => {
    const breakdown = computeGiftBreakdown(1000, "FREE");
    assert.deepEqual(
      { gross: breakdown.gross, fee: breakdown.fee, net: breakdown.net },
      { gross: 1000, fee: 200, net: 800 }
    );
    assert.equal(breakdown.freeGross, 1000);
    assert.equal(breakdown.paidGross, 0);
  });

  it("FEE-2 paid gift fee stays 10%", () => {
    const breakdown = computeGiftBreakdown(1000, "PAID");
    assert.deepEqual(
      { gross: breakdown.gross, fee: breakdown.fee, net: breakdown.net },
      { gross: 1000, fee: 100, net: 900 }
    );
  });

  it("FEE-3 fee rounding on odd amounts", () => {
    const breakdown = computeGiftBreakdown(333, "FREE");
    assert.equal(breakdown.fee, 66.6);
    assert.equal(breakdown.net, 266.4);
  });
});

describe("point policy unification — attendance gift ban (server authority)", () => {
  it("GIFT-1 attendance-only sender gift is rejected by the server", () => {
    const sender = createTestUser("attban_s");
    const recipient = createTestUser("attban_r");
    const claimed = claimDailyAttendance(sender.id);
    assert.equal(claimed.alreadyClaimed, false);
    assert.ok(claimed.reward >= MIN_POINT_GIFT_AMOUNT);

    assert.throws(
      () => giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 100 }),
      isAttendanceError
    );
    assert.equal(getPointBalance(sender.id).total, claimed.reward);
    assert.equal(getPointBalance(recipient.id).total, 0);
  });

  it("GIFT-2 expiring attendance cannot be laundered into fresh credit", () => {
    const sender = createTestUser("attlaun_s");
    const recipient = createTestUser("attlaun_r");
    claimDailyAttendance(sender.id);
    const lots = userLots(sender.id);
    assert.equal(lots.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','+1 hour') WHERE id=?")
      .run(lots[0]!.id);

    assert.throws(
      () => giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 100 }),
      isAttendanceError
    );
    assert.equal(getPointBalance(recipient.id).total, 0);
    const after = userLots(sender.id);
    assert.equal(after[0]!.remaining_amount, lots[0]!.remaining_amount);
  });

  it("GIFT-3 mixed sender gifts generic free first and leaves attendance untouched", () => {
    const sender = createTestUser("mixgift_s");
    const recipient = createTestUser("mixgift_r");
    claimDailyAttendance(sender.id);
    creditPoints(sender.id, 500, "FREE", "pptest generic free");
    const before = userLots(sender.id);
    assert.equal(before.length, 2);
    const attendanceLot = before[0]!;
    const genericLot = before[1]!;
    assert.ok(attendanceLot.expires_at < genericLot.expires_at);

    const result = giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 200 });
    assert.equal(result.breakdown.freeGross, 200);
    assert.equal(result.breakdown.paidGross, 0);
    assert.equal(result.breakdown.fee, 40);
    assert.equal(result.breakdown.net, 160);

    const after = userLots(sender.id);
    const attendanceAfter = after.find((lot) => lot.id === attendanceLot.id)!;
    const genericAfter = after.find((lot) => lot.id === genericLot.id)!;
    assert.equal(attendanceAfter.remaining_amount, attendanceLot.remaining_amount);
    assert.equal(genericAfter.remaining_amount, 300);
    assert.equal(getPointBalance(recipient.id).total, 160);
  });

  it("GIFT-4 server ignores client-supplied fee and recomputes authoritatively", () => {
    const sender = createTestUser("srvfee_s");
    const recipient = createTestUser("srvfee_r");
    creditPoints(sender.id, 1000, "FREE", "pptest generic free");
    const result = giftPoints(sender.id, {
      recipientNickname: recipient.nickname,
      amount: 500,
      feeAmount: 1,
    } as { recipientNickname: string; amount: number; feeAmount?: number });
    assert.equal(result.breakdown.fee, 100);
    assert.equal(result.breakdown.net, 400);
    assert.equal(getPointBalance(sender.id).total, 500);
    assert.equal(getPointBalance(recipient.id).total, 400);
  });

  it("GIFT-5 paid-only gift preserves gross-debit net-credit economics", () => {
    const sender = createTestUser("paidgift_s");
    const recipient = createTestUser("paidgift_r");
    creditPoints(sender.id, 1000, "PAID", "pptest paid");
    const result = giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 500 });
    assert.deepEqual(
      { gross: result.breakdown.gross, fee: result.breakdown.fee, net: result.breakdown.net },
      { gross: 500, fee: 50, net: 450 }
    );
    assert.equal(getPointBalance(sender.id).total, 500);
    assert.equal(getPointBalance(recipient.id).total, 450);
  });

  it("GIFT-6 failed gift leaves zero partial state", () => {
    const sender = createTestUser("failgift_s");
    creditPoints(sender.id, 500, "PAID", "pptest paid");
    const db = getDb();
    const logsBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id=?").get(sender.id) as { c: number }
    ).c;
    const giftsBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM point_gifts WHERE sender_id=?").get(sender.id) as { c: number }
    ).c;
    assert.throws(
      () => giftPoints(sender.id, { recipientNickname: "no_such_nick_pptest_xyz", amount: 100 }),
      PointGiftError
    );
    assert.equal(getPointBalance(sender.id).total, 500);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM point_logs WHERE user_id=?").get(sender.id) as { c: number }).c,
      logsBefore
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS c FROM point_gifts WHERE sender_id=?").get(sender.id) as { c: number }).c,
      giftsBefore
    );
  });
});

describe("point policy unification — gift idempotency and serialization", () => {
  it("IDEM-1 duplicate clientMutationId replays without double debit", () => {
    const sender = createTestUser("idem_s");
    const recipient = createTestUser("idem_r");
    creditPoints(sender.id, 1000, "PAID", "pptest paid");
    const key = `pptest_${TAG}_idem1`;
    const opts = {
      recipientNickname: recipient.nickname,
      amount: 100,
      clientMutationId: key,
    } as { recipientNickname: string; amount: number; clientMutationId?: string };
    const first = giftPoints(sender.id, opts);
    const second = giftPoints(sender.id, opts);
    assert.equal(second.giftId, first.giftId);
    assert.equal(getPointBalance(sender.id).total, 900);
    assert.equal(getPointBalance(recipient.id).total, 90);
    const giftRows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM point_gifts WHERE sender_id=? AND recipient_id=?")
      .get(sender.id, recipient.id) as { c: number };
    assert.equal(giftRows.c, 1);
  });

  it("IDEM-2 over-balance sequential gifts serialize without partial state", () => {
    const sender = createTestUser("ser_s");
    const recipient = createTestUser("ser_r");
    creditPoints(sender.id, 300, "PAID", "pptest paid");
    giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 200 });
    assert.throws(
      () => giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 200 }),
      PointGiftError
    );
    assert.equal(getPointBalance(sender.id).total, 100);
    assert.equal(getPointBalance(recipient.id).total, 180);
    const lots = userLots(sender.id);
    assert.ok(lots.every((lot) => lot.remaining_amount >= -0.001));
  });
});

describe("point policy unification — expiry laundering boundary", () => {
  it("LAUND-1 nearly-expired free gift yields fresh 1y PAID for recipient; sender lot consumed", () => {
    const sender = createTestUser("laund_s");
    const recipient = createTestUser("laund_r");
    creditPoints(sender.id, 500, "FREE", "pptest generic free");
    const lots = userLots(sender.id);
    assert.equal(lots.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','+1 hour') WHERE id=?")
      .run(lots[0]!.id);

    const result = giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 200 });
    assert.equal(result.breakdown.net, 160);

    const senderAfter = userLots(sender.id);
    assert.equal(senderAfter[0]!.remaining_amount, 300);

    const recipientLots = userLots(recipient.id);
    assert.equal(recipientLots.length, 1);
    assert.equal(recipientLots[0]!.point_type, "PAID");
    assert.equal(recipientLots[0]!.remaining_amount, 160);
    assert.ok(
      Math.abs(daysUntilExpiry(recipientLots[0]!.expires_at) - 365) < 4,
      `recipient expiry=${recipientLots[0]!.expires_at}, expected fresh ~1y`
    );
  });
});

describe("point policy unification — spend order preserved", () => {
  it("SPEND-1 earliest-expiry first, FREE before PAID on tie, expired skipped", () => {
    const user = createTestUser("spendord");
    claimDailyAttendance(user.id);
    creditPoints(user.id, 500, "FREE", "pptest generic free");
    creditPoints(user.id, 500, "PAID", "pptest paid");
    const db = getDb();
    db.prepare(
      "INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (?, 'FREE', 999, datetime('now','-1 day'))"
    ).run(user.id);
    const before = userLots(user.id);
    const attendanceLot = before.find((lot) => lot.remaining_amount === 250)!;
    const genericLot = before.find((lot) => lot.remaining_amount === 500 && lot.point_type === "FREE")!;
    const paidLot = before.find((lot) => lot.point_type === "PAID")!;
    const expiredLot = before.find((lot) => lot.remaining_amount === 999)!;

    deductPoints(user.id, 100, "pptest spend 1");
    let after = userLots(user.id);
    assert.equal(after.find((lot) => lot.id === attendanceLot.id)!.remaining_amount, 150);
    assert.equal(after.find((lot) => lot.id === genericLot.id)!.remaining_amount, 500);
    assert.equal(after.find((lot) => lot.id === paidLot.id)!.remaining_amount, 500);
    assert.equal(after.find((lot) => lot.id === expiredLot.id)!.remaining_amount, 999);

    deductPoints(user.id, 200, "pptest spend 2");
    after = userLots(user.id);
    assert.equal(after.find((lot) => lot.id === attendanceLot.id)!.remaining_amount, 0);
    assert.equal(after.find((lot) => lot.id === genericLot.id)!.remaining_amount, 450);
    assert.equal(after.find((lot) => lot.id === paidLot.id)!.remaining_amount, 500);
  });
});

describe("point policy unification — refund provenance", () => {
  it("REFUND-1 refund restores the unexpired original lot in place", () => {
    const user = createTestUser("refund_ok");
    creditPoints(user.id, 500, "PAID", "pptest paid");
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 200, "pptest spend");
    assert.equal(deducted.slices.length, 1);
    const mid = userLots(user.id);
    assert.equal(mid[0]!.remaining_amount, 300);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 200, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1);
    assert.equal(after[0]!.id, before[0]!.id);
    assert.equal(after[0]!.remaining_amount, 500);
    assert.equal(after[0]!.expires_at, before[0]!.expires_at);
  });

  it("REFUND-2 refund of an expired attendance spend restores attendance 30d, not generic", () => {
    const user = createTestUser("refund_att");
    claimDailyAttendance(user.id);
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 100, "pptest spend");
    assert.equal(deducted.slices.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','-1 day') WHERE id=?")
      .run(before[0]!.id);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 100, "pptest refund");
    const after = userLots(user.id).filter((lot) => lot.remaining_amount > 0);
    const restored = after.find((lot) => lot.remaining_amount === 100);
    assert.ok(restored, "restored 100 lot exists alongside the expired original");
    assert.ok(
      Math.abs(daysUntilExpiry(restored.expires_at) - 30) < 2,
      `restored expires_at=${restored.expires_at}, expected ~30d attendance policy`
    );
    const giftRecipient = createTestUser("refund_att_r");
    assert.throws(
      () =>
        giftPoints(user.id, {
          recipientNickname: giftRecipient.nickname,
          amount: Math.min(100, MIN_POINT_GIFT_AMOUNT),
        }),
      isAttendanceError
    );
  });
});
