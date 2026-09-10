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
  estimateGiftBreakdown,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
  resolveGiftMutationKey,
} from "./pointGiftsShared";
import { refundMessageDeduction, processReportRefund } from "./refund";

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

function isIdempotencyConflict(err: unknown): boolean {
  return err instanceof PointGiftError && (err as { code?: unknown }).code === "IDEMPOTENCY_CONFLICT";
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
    // PRESERVED (not removed): generic gift recipient가 fresh PAID credit을
    // 받는 기존 semantics를 의도적으로 유지. REMOVED는 attendance gift
    // launderingのみ. "gift laundering 전체 해결"로 표현하지 않는다.
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

  it("REFUND-2 refund of an expired attendance spend restores the same expired row (EXACT REVERSAL)", () => {
    // PRODUCT DECISION B: 환불은 compensation이 아니라 counterfactual
    // 복원이다. 만료된 원본 row에 remaining만 복원하고, 새 30d lot을
    // 만들지 않으며, 만료 상태이므로 spendable/giftable 잔액은 늘지 않는다.
    const user = createTestUser("refund_att");
    const claimed = claimDailyAttendance(user.id);
    assert.equal(claimed.alreadyClaimed, false);
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 100, "pptest spend");
    assert.equal(deducted.slices.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','-1 day') WHERE id=?")
      .run(before[0]!.id);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 100, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1, "no new attendance lot created");
    assert.equal(after[0]!.id, before[0]!.id, "same transaction row");
    assert.equal(after[0]!.remaining_amount, claimed.reward, "consumed amount restored");
    const sourceRow = getDb()
      .prepare("SELECT COALESCE(source,'') AS source FROM point_transactions WHERE id=?")
      .get(before[0]!.id) as { source: string };
    assert.equal(sourceRow.source, "attendance", "provenance preserved, not re-projected");
    assert.equal(getPointBalance(user.id).total, 0, "expired restore adds no spendable balance");
    const giftRecipient = createTestUser("refund_att_r");
    assert.throws(
      () =>
        giftPoints(user.id, {
          recipientNickname: giftRecipient.nickname,
          amount: Math.min(100, MIN_POINT_GIFT_AMOUNT),
        }),
      PointGiftError,
      "nothing giftable after expired-attendance reversal"
    );
  });
});

describe("point policy unification — legacy attendance cutover (NO BACKFILL / NULL=GENERIC)", () => {
  it("LEGACY-1 cutover boundary: NULL-source lots are generic FREE and are never reclassified as attendance", () => {
    // PRODUCT DECISION A: legacy attendance NULL-source lot을 백필하지
    // 않고 DB reset도 하지 않는다. provenance가 없는 NULL-source lot은
    // generic FREE로 취급하며 attendance로 추정 재분류하지 않는다.
    // 이 fixture는 열린 결함이 아니라 cutover-boundary regression이다.
    const sender = createTestUser("legacy_s");
    const recipient = createTestUser("legacy_r");
    const db = getDb();
    db.prepare(
      "INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at) VALUES (?, 'FREE', 250, datetime('now','+30 days'))"
    ).run(sender.id);
    db.prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      sender.id,
      250,
      "주간 출석 1일차 보상 (+250P)"
    );
    db.prepare(
      "INSERT OR IGNORE INTO attendance_checkins (user_id, attendance_date, streak, reward_points) VALUES (?,?,?,?)"
    ).run(sender.id, new Date().toISOString().slice(0, 10), 1, 250);

    const result = giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 250 });
    assert.equal(result.breakdown.gross, 250);
    assert.equal(result.breakdown.net, 200);
    assert.equal(getPointBalance(sender.id).total, 0);
    assert.equal(getPointBalance(recipient.id).total, 200);
    const sourceRow = db
      .prepare(
        "SELECT COALESCE(source,'') AS source FROM point_transactions WHERE user_id=? ORDER BY id DESC LIMIT 1"
      )
      .get(sender.id) as { source: string };
    assert.equal(sourceRow.source, "", "no reclassification: source stays NULL (generic FREE)");
  });
});

describe("point policy unification — sender-scoped gift idempotency", () => {
  it("IDEM-X1 cross-sender same key stays independent (no global UNIQUE)", () => {
    const a = createTestUser("xsidemp_a");
    const b = createTestUser("xsidemp_b");
    const r = createTestUser("xsidemp_r");
    creditPoints(a.id, 500, "PAID", "pptest paid");
    creditPoints(b.id, 500, "PAID", "pptest paid");
    const key = `pptest_${TAG}_xsend`;
    const first = giftPoints(a.id, {
      recipientNickname: r.nickname,
      amount: 100,
      clientMutationId: key,
    });
    const second = giftPoints(b.id, {
      recipientNickname: r.nickname,
      amount: 100,
      clientMutationId: key,
    });
    assert.notEqual(second.giftId, first.giftId);
    assert.equal(getPointBalance(a.id).total, 400);
    assert.equal(getPointBalance(b.id).total, 400);
    assert.equal(getPointBalance(r.id).total, 180);
  });

  it("IDEM-X2 same sender same key same payload replays across identifier forms", () => {
    const sender = createTestUser("idemform_s");
    const recipient = createTestUser("idemform_r");
    creditPoints(sender.id, 1000, "PAID", "pptest paid");
    const key = `pptest_${TAG}_idemform`;
    const first = giftPoints(sender.id, {
      recipientNickname: recipient.nickname,
      amount: 100,
      clientMutationId: key,
    });
    const second = giftPoints(sender.id, {
      recipientId: recipient.id,
      amount: 100,
      clientMutationId: key,
    });
    assert.equal(second.giftId, first.giftId);
    assert.equal(getPointBalance(sender.id).total, 900);
    assert.equal(getPointBalance(recipient.id).total, 90);
  });

  it("IDEM-X3 same sender same key different amount is a conflict, not a silent replay", () => {
    const sender = createTestUser("idemamt_s");
    const recipient = createTestUser("idemamt_r");
    creditPoints(sender.id, 1000, "PAID", "pptest paid");
    const key = `pptest_${TAG}_idemamt`;
    const first = giftPoints(sender.id, {
      recipientNickname: recipient.nickname,
      amount: 100,
      clientMutationId: key,
    });
    assert.throws(
      () =>
        giftPoints(sender.id, {
          recipientNickname: recipient.nickname,
          amount: 200,
          clientMutationId: key,
        }),
      isIdempotencyConflict
    );
    assert.equal(getPointBalance(sender.id).total, 900);
    assert.equal(getPointBalance(recipient.id).total, 90);
    const giftRows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM point_gifts WHERE sender_id=? AND recipient_id=?")
      .get(sender.id, recipient.id) as { c: number };
    assert.equal(giftRows.c, 1);
    assert.equal(first.breakdown.gross, 100);
  });

  it("IDEM-X4 same sender same key different recipient is a conflict with zero debit", () => {
    const sender = createTestUser("idemrcp_s");
    const r1 = createTestUser("idemrcp_r1");
    const r2 = createTestUser("idemrcp_r2");
    creditPoints(sender.id, 1000, "PAID", "pptest paid");
    const key = `pptest_${TAG}_idemrcp`;
    giftPoints(sender.id, {
      recipientNickname: r1.nickname,
      amount: 100,
      clientMutationId: key,
    });
    assert.throws(
      () =>
        giftPoints(sender.id, {
          recipientNickname: r2.nickname,
          amount: 100,
          clientMutationId: key,
        }),
      isIdempotencyConflict
    );
    assert.equal(getPointBalance(sender.id).total, 900);
    assert.equal(getPointBalance(r1.id).total, 90);
    assert.equal(getPointBalance(r2.id).total, 0);
  });

  it("IDEM-X5 sequential over-balance attempts with keys leave exact balances", () => {
    const sender = createTestUser("overkey_s");
    const recipient = createTestUser("overkey_r");
    creditPoints(sender.id, 300, "PAID", "pptest paid");
    giftPoints(sender.id, {
      recipientNickname: recipient.nickname,
      amount: 200,
      clientMutationId: `pptest_${TAG}_over1`,
    });
    assert.throws(
      () =>
        giftPoints(sender.id, {
          recipientNickname: recipient.nickname,
          amount: 200,
          clientMutationId: `pptest_${TAG}_over2`,
        }),
      PointGiftError
    );
    assert.equal(getPointBalance(sender.id).total, 100);
    assert.equal(getPointBalance(recipient.id).total, 180);
    const lots = userLots(sender.id);
    assert.ok(lots.every((lot) => lot.remaining_amount >= -0.001));
    const giftRows = getDb()
      .prepare("SELECT COUNT(*) AS c FROM point_gifts WHERE sender_id=?")
      .get(sender.id) as { c: number };
    assert.equal(giftRows.c, 1);
  });
});

describe("point policy unification — mutation-intent key lifecycle", () => {
  it("KEY-1 identical payload reuses the in-flight key (double-click/retry safe)", () => {
    let n = 0;
    const gen = () => `k${(n += 1)}`;
    const first = resolveGiftMutationKey(null, "id:7", 100, gen);
    assert.equal(first.key, "k1");
    const second = resolveGiftMutationKey(first, "id:7", 100, gen);
    assert.equal(second.key, "k1");
    assert.equal(n, 1);
  });

  it("KEY-2 changed amount or recipient rotates the intent key", () => {
    let n = 0;
    const gen = () => `k${(n += 1)}`;
    const first = resolveGiftMutationKey(null, "id:7", 100, gen);
    const changedAmount = resolveGiftMutationKey(first, "id:7", 200, gen);
    assert.equal(changedAmount.key, "k2");
    const changedRecipient = resolveGiftMutationKey(first, "id:8", 100, gen);
    assert.equal(changedRecipient.key, "k3");
  });
});

describe("point policy unification — refund expiry boundary (EXACT REVERSAL)", () => {
  it("REFUND-X1 expired generic FREE spend restores the same expired row — no fresh 1y lot", () => {
    // PRODUCT DECISION B: BEFORE의 fresh-validity 재생성은 laundering
    // (만료 자산의 fresh 부활)이므로 제거. 원본 lifetime 연장은 없다.
    const user = createTestUser("refund_free");
    creditPoints(user.id, 500, "FREE", "pptest generic free");
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 200, "pptest spend");
    assert.equal(deducted.slices.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','-1 day') WHERE id=?")
      .run(before[0]!.id);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 200, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1, "new point transaction count +0");
    assert.equal(after[0]!.id, before[0]!.id, "same transaction row");
    assert.equal(after[0]!.point_type, "FREE");
    assert.equal(after[0]!.remaining_amount, 500, "exact consumed amount restored");
    assert.equal(getPointBalance(user.id).total, 0, "no fresh spendable balance");
  });
});

describe("point policy unification — schema owner and request-path purity", () => {
  it("SCHEMA-1 central migration owns all gift columns and the sender-scoped idempotency index", () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(point_gifts)").all() as { name: string }[];
    const names = new Set(cols.map((c) => c.name));
    for (const col of [
      "client_mutation_id",
      "paid_gross_amount",
      "free_gross_amount",
      "paid_fee_amount",
      "free_fee_amount",
    ]) {
      assert.ok(names.has(col), `point_gifts.${col} owned by central migration`);
    }
    const indexes = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='point_gifts'")
      .all() as { name: string; sql: string }[];
    const byName = new Map(indexes.map((i) => [i.name, i.sql]));
    assert.ok(byName.has("idx_point_gifts_sender_mutation"), "sender-scoped idempotency index exists");
    assert.ok(
      !byName.has("idx_point_gifts_client_mutation"),
      "legacy global UNIQUE(client_mutation_id) is gone"
    );
  });

  it("SCHEMA-2 normal gift performs no runtime ALTER (no request-path schema mutation)", () => {
    const sender = createTestUser("noalter_s");
    const recipient = createTestUser("noalter_r");
    creditPoints(sender.id, 500, "PAID", "pptest paid");
    const db = getDb();
    const originalExec = db.exec;
    const seen: string[] = [];
    (db as unknown as { exec: (sql: string) => unknown }).exec = (sql: string) => {
      seen.push(sql);
      return (originalExec as (sql: string) => unknown).call(db, sql);
    };
    try {
      giftPoints(sender.id, {
        recipientNickname: recipient.nickname,
        amount: 100,
        clientMutationId: `pptest_${TAG}_noalter`,
      });
    } finally {
      (db as unknown as { exec: (sql: string) => unknown }).exec = originalExec as (
        sql: string
      ) => unknown;
    }
    assert.equal(
      seen.filter((sql) => /alter\s+table/i.test(sql)).length,
      0,
      `unexpected runtime DDL: ${JSON.stringify(seen)}`
    );
  });
});

describe("point policy unification — server-authoritative commit over stale preview", () => {
  it("PREVIEW-1 stale client preview (total FREE) cannot move attendance; commit uses the giftable split", () => {
    const sender = createTestUser("stale_s");
    const recipient = createTestUser("stale_r");
    const claimed = claimDailyAttendance(sender.id);
    assert.equal(claimed.alreadyClaimed, false);
    creditPoints(sender.id, 500, "FREE", "pptest generic free");
    const lotsBefore = userLots(sender.id);
    const attendanceLot = lotsBefore[0]!;

    // Stale client math built on total FREE (attendance included).
    const stalePreview = estimateGiftBreakdown(
      400,
      getPointBalance(sender.id).free,
      getPointBalance(sender.id).paid
    );
    assert.equal(stalePreview.freeGross, 400);

    const result = giftPoints(sender.id, { recipientNickname: recipient.nickname, amount: 400 });
    assert.equal(result.breakdown.freeGross, 400);
    assert.equal(result.breakdown.paidGross, 0);
    assert.equal(result.breakdown.fee, 80);
    assert.equal(result.breakdown.net, 320);

    const lotsAfter = userLots(sender.id);
    assert.equal(
      lotsAfter.find((lot) => lot.id === attendanceLot.id)!.remaining_amount,
      attendanceLot.remaining_amount,
      "attendance lot untouched by server commit"
    );
    assert.equal(getPointBalance(recipient.id).total, 320);
  });
});

describe("refund exact reversal — canonical semantics (EXACT REVERSAL / ORIGINAL EXPIRY PRESERVED)", () => {
  it("REFUND-REV-1 refund before expiry restores the same row in place", () => {
    const user = createTestUser("rev_ok");
    creditPoints(user.id, 500, "FREE", "pptest generic free");
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 200, "pptest spend");
    assert.equal(deducted.slices.length, 1);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 200, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1, "no new transaction row");
    assert.equal(after[0]!.id, before[0]!.id, "same transaction row");
    assert.equal(after[0]!.remaining_amount, 500, "exact consumed amount restored");
    assert.equal(after[0]!.expires_at, before[0]!.expires_at, "expiry untouched");
    assert.equal(getPointBalance(user.id).total, 500, "spendable balance restored");
  });

  it("REFUND-REV-2 refund after expiry restores the SAME expired row — no fresh lot, no new expiry", () => {
    const user = createTestUser("rev_exp");
    creditPoints(user.id, 500, "FREE", "pptest generic free");
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 200, "pptest spend");
    assert.equal(deducted.slices.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','-1 day') WHERE id=?")
      .run(before[0]!.id);
    const expiredAt = (
      getDb().prepare("SELECT expires_at FROM point_transactions WHERE id=?").get(before[0]!.id) as {
        expires_at: string;
      }
    ).expires_at;

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 200, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1, "new point transaction count +0");
    assert.equal(after[0]!.id, before[0]!.id, "same transaction row");
    assert.equal(after[0]!.remaining_amount, 500, "exact consumed amount restored to the row");
    assert.equal(after[0]!.expires_at, expiredAt, "original (past) expiry preserved, not renewed");
    assert.equal(
      getPointBalance(user.id).total,
      0,
      "restored amount stays expired: spendable balance does not increase"
    );
  });

  it("REFUND-REV-3 expired attendance refund restores the same row — no new 30d lot, no generic conversion", () => {
    const user = createTestUser("rev_att");
    const claimed = claimDailyAttendance(user.id);
    assert.equal(claimed.alreadyClaimed, false);
    const before = userLots(user.id);
    assert.equal(before.length, 1);
    const deducted = deductPoints(user.id, 100, "pptest spend");
    assert.equal(deducted.slices.length, 1);
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','-1 day') WHERE id=?")
      .run(before[0]!.id);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 100, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1, "no new attendance lot created");
    assert.equal(after[0]!.id, before[0]!.id, "same transaction row");
    assert.equal(after[0]!.remaining_amount, claimed.reward, "consumed amount restored");
    const sourceRow = getDb()
      .prepare("SELECT COALESCE(source,'') AS source FROM point_transactions WHERE id=?")
      .get(before[0]!.id) as { source: string };
    assert.equal(sourceRow.source, "attendance", "provenance untouched, not re-projected");
    assert.equal(getPointBalance(user.id).total, 0, "no giftable balance increase");
  });

  it("REFUND-REV-4 expired PAID refund restores the same row — no fresh 1y lot", () => {
    const user = createTestUser("rev_paid");
    creditPoints(user.id, 500, "PAID", "pptest paid");
    const before = userLots(user.id);
    const deducted = deductPoints(user.id, 200, "pptest spend");
    getDb()
      .prepare("UPDATE point_transactions SET expires_at=datetime('now','-1 day') WHERE id=?")
      .run(before[0]!.id);

    refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 200, "pptest refund");
    const after = userLots(user.id);
    assert.equal(after.length, 1, "new point transaction count +0");
    assert.equal(after[0]!.id, before[0]!.id);
    assert.equal(after[0]!.point_type, "PAID");
    assert.equal(after[0]!.remaining_amount, 500);
    assert.equal(getPointBalance(user.id).total, 0);
  });

  it("REFUND-NOSLICE-1 empty slices never mint fresh FREE — integrity failure, fail-closed", () => {
    const user = createTestUser("rev_noslice");
    assert.equal(userLots(user.id).length, 0);
    assert.throws(
      () => refundMessageDeduction(user.id, FAKE_MESSAGE_ID, [], 200, "pptest refund"),
      /slices/,
      "no silent fresh-credit mint without source slices"
    );
    assert.equal(userLots(user.id).length, 0, "no new lot minted");
    assert.equal(getPointBalance(user.id).total, 0);
  });

  it("REFUND-MISSING-1 slice pointing at a deleted row never mints — integrity failure", () => {
    const user = createTestUser("rev_missing");
    creditPoints(user.id, 500, "FREE", "pptest generic free");
    const before = userLots(user.id);
    const deducted = deductPoints(user.id, 200, "pptest spend");
    getDb().prepare("DELETE FROM point_transactions WHERE id=?").run(before[0]!.id);

    assert.throws(
      () => refundMessageDeduction(user.id, FAKE_MESSAGE_ID, deducted.slices, 200, "pptest refund"),
      /slices|transaction|integrity/i,
      "missing original row is a data-integrity failure, not a fresh-credit fallback"
    );
    assert.equal(userLots(user.id).length, 0, "no replacement lot minted");
  });
});

describe("refund report-path boundaries — fail-closed, no silent mint", () => {
  function createRefundMessageGraph(suffix: string, opts: { slices: string | null; cost: number }) {
    const db = getDb();
    const user = createTestUser(`rpt_${suffix}`);
    const charName = `${TAG}_char_${suffix}`;
    const charRow = db
      .prepare("INSERT INTO characters (name) VALUES (?)")
      .run(charName);
    const characterId = Number(charRow.lastInsertRowid);
    const chatRow = db
      .prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)")
      .run(user.id, characterId);
    const chatId = Number(chatRow.lastInsertRowid);
    const msgRow = db
      .prepare(
        "INSERT INTO messages (chat_id, role, content, status, usage, deduction_slices) VALUES (?, 'assistant', ?, 'error', ?, ?)"
      )
      .run(chatId, "x", JSON.stringify({ cost: opts.cost }), opts.slices);
    const messageId = Number(msgRow.lastInsertRowid);
    return { user, chatId, messageId, characterId };
  }

  function deleteRefundMessageGraph(graph: { chatId: number; messageId: number; characterId: number }) {
    const db = getDb();
    db.prepare("DELETE FROM report_refunds WHERE message_id=?").run(graph.messageId);
    db.prepare("DELETE FROM reports WHERE message_id=?").run(graph.messageId);
    db.prepare("DELETE FROM messages WHERE id=?").run(graph.messageId);
    db.prepare("DELETE FROM chats WHERE id=?").run(graph.chatId);
    db.prepare("DELETE FROM characters WHERE id=?").run(graph.characterId);
  }

  it("REFUND-E2E-NOSLICE error-status message without slices goes pending — never auto-minted", () => {
    const graph = createRefundMessageGraph("noslice", { slices: null, cost: 200 });
    try {
      const txBefore = userLots(graph.user.id).length;
      const result = processReportRefund(graph.user.id, graph.messageId, graph.chatId);
      assert.equal(result.status, "pending", "fail-closed to manual review, not auto-approved");
      assert.equal(userLots(graph.user.id).length, txBefore, "no lot minted by the report path");
      assert.equal(getPointBalance(graph.user.id).total, 0);
    } finally {
      deleteRefundMessageGraph(graph);
    }
  });

  it("REFUND-E2E-DOUBLE error-status message with valid slices approves once, then rejects", () => {
    const graphUser = createTestUser("dbl");
    const db = getDb();
    creditPoints(graphUser.id, 500, "FREE", "pptest generic free");
    const deducted = deductPoints(graphUser.id, 200, "pptest spend");
    const charRow = db.prepare("INSERT INTO characters (name) VALUES (?)").run(`${TAG}_char_dbl`);
    const characterId = Number(charRow.lastInsertRowid);
    const chatRow = db
      .prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)")
      .run(graphUser.id, characterId);
    const chatId = Number(chatRow.lastInsertRowid);
    const msgRow = db
      .prepare(
        "INSERT INTO messages (chat_id, role, content, status, usage, deduction_slices) VALUES (?, 'assistant', ?, 'error', ?, ?)"
      )
      .run(chatId, "x", JSON.stringify({ cost: 200 }), JSON.stringify(deducted.slices));
    const messageId = Number(msgRow.lastInsertRowid);
    try {
      const first = processReportRefund(graphUser.id, messageId, chatId);
      assert.equal(first.status, "approved", "first error report auto-approves with intact slices");
      const txAfterFirst = userLots(graphUser.id).length;
      const balanceAfterFirst = getPointBalance(graphUser.id).total;

      const second = processReportRefund(graphUser.id, messageId, chatId);
      assert.equal(second.status, "rejected", "double refund rejected by existing guards");
      assert.equal(userLots(graphUser.id).length, txAfterFirst, "no lots created by the second call");
      assert.equal(getPointBalance(graphUser.id).total, balanceAfterFirst, "balance unchanged");
      const flag = (
        db.prepare("SELECT is_refunded FROM messages WHERE id=?").get(messageId) as {
          is_refunded: number;
        }
      ).is_refunded;
      assert.equal(flag, 1, "is_refunded invariant set by the first refund");
    } finally {
      deleteRefundMessageGraph({ chatId, messageId, characterId });
    }
  });
});
