import crypto from "crypto";
import fs from "fs";
import { getDb } from "@/lib/db";
import { creditPointsWithIds, POINT_SOURCE_ATTENDANCE } from "@/lib/points";
import { ensurePointChargeBatchTable, recordPointChargeBatch } from "@/lib/chargeCancellation";
import { ensurePointChargeRefundAttemptsSchema } from "@/lib/pointChargeRefundAttempts";
import { PORTONE_REVIEWER_ACCOUNT_KIND } from "@/lib/portoneReviewerAccount";

/** Isolated E4-3K points fixtures. Every account, amount and payment id is fictional. */
const db = getDb();
ensurePointChargeBatchTable(db);
ensurePointChargeRefundAttemptsSchema(db);

const KEYS = ["new", "empty", "low", "big", "full", "gifter", "recip", "recipLong", "attonly", "reviewer"];
const EMAILS = KEYS.map((k) => `${k.toLowerCase()}@e43k.local`);
const old = db
  .prepare(`SELECT id FROM users WHERE email IN (${EMAILS.map(() => "?").join(",")})`)
  .all(...EMAILS) as { id: number }[];
for (const { id } of old) {
  db.prepare("DELETE FROM point_logs WHERE user_id=?").run(id);
  db.prepare("DELETE FROM point_transactions WHERE user_id=?").run(id);
  const batches = db.prepare("SELECT id FROM point_charge_batches WHERE user_id=?").all(id) as { id: number }[];
  for (const b of batches) db.prepare("DELETE FROM point_charge_refund_attempts WHERE charge_batch_id=?").run(b.id);
  db.prepare("DELETE FROM point_charge_batches WHERE user_id=?").run(id);
  db.prepare("DELETE FROM portone_checkouts WHERE user_id=?").run(id);
  db.prepare("DELETE FROM attendance_checkins WHERE user_id=?").run(id);
  db.prepare("DELETE FROM point_gifts WHERE sender_id=? OR recipient_id=?").run(id, id);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
}

function user(key: string, nick: string, o: { kind?: string } = {}): number {
  const email = `${key.toLowerCase()}@e43k.local`;
  const ex = db.prepare("SELECT id FROM users WHERE email=?").get(email) as { id: number } | undefined;
  const id =
    ex?.id ??
    Number(db.prepare("INSERT INTO users (email,nickname,pw_hash,points) VALUES (?,?,?,?)").run(email, nick, "x", 0).lastInsertRowid);
  db.prepare("UPDATE users SET nickname=?, is_adult=1, points=0, account_kind=? WHERE id=?").run(nick, o.kind ?? "standard", id);
  return id;
}

const U: Record<string, number> = {
  new: user("new", "새로온사용자"),
  empty: user("empty", "빈포인트"),
  low: user("low", "소액보유"),
  big: user("big", "큰금액보유"),
  full: user("full", "내역많은사용자"),
  gifter: user("gifter", "선물하는사람"),
  recip: user("recip", "받는사람"),
  recipLong: user("recipLong", "받는사람닉네임이정말정말길어서줄바꿈이필요한경우"),
  attonly: user("attonly", "출석포인트만"),
  reviewer: user("reviewer", "포트원 심사", { kind: PORTONE_REVIEWER_ACCOUNT_KIND }),
};

function ago(days: number, minutes = 0): string {
  return new Date(Date.now() - days * 864e5 - minutes * 6e4).toISOString().slice(0, 19).replace("T", " ");
}

function credit(uid: number, amount: number, type: "PAID" | "FREE", reason: string, o: { days?: number; source?: string; at?: string } = {}) {
  const r = creditPointsWithIds(db, uid, amount, type, reason, o.days ? { days: o.days } : undefined, o.source);
  if (!r) throw new Error("credit failed");
  if (o.at) {
    db.prepare("UPDATE point_logs SET created_at=? WHERE id=?").run(o.at, r.logId);
    db.prepare("UPDATE point_transactions SET created_at=? WHERE id=?").run(o.at, r.transactionId);
  }
  return r;
}

function usage(uid: number, delta: number, reason: string, at: string) {
  db.prepare("INSERT INTO point_logs (user_id, delta, reason, created_at) VALUES (?,?,?,?)").run(uid, -Math.abs(delta), reason, at);
}

// new: signup bonus only
credit(U.new, 2000, "FREE", "신규 가입 보너스", { at: ago(0, 5) });

// low
credit(U.low, 120, "PAID", "포인트 충전 5,000P (₩5,000)", { at: ago(40) });
credit(U.low, 30, "FREE", "캐릭터 제작·이식 이벤트 보상", { at: ago(12) });
usage(U.low, 4880, "대화 · 로코 (Gemini 3 Flash)", ago(11));

// big
credit(U.big, 1234567, "PAID", "포인트 충전 1,234,567P (₩1,234,567)", { at: ago(3) });
credit(U.big, 98765, "FREE", "충전 보너스 98,765P", { at: ago(3) });
credit(U.big, 12300, "FREE", "주간 출석 6일차 보상 (+500P)", { source: POINT_SOURCE_ATTENDANCE, days: 21, at: ago(1) });
usage(U.big, 12345, "대화 · 이혁 (DeepSeek V4 Flash)", ago(2));

// gifter / attonly / reviewer / recips
credit(U.gifter, 5000, "PAID", "포인트 충전 5,000P (₩5,000)", { at: ago(20) });
credit(U.gifter, 3000, "FREE", "캐릭터 제작·이식 이벤트 보상", { at: ago(10) });
credit(U.gifter, 2000, "FREE", "주간 출석 5일차 보상 (+450P)", { source: POINT_SOURCE_ATTENDANCE, days: 21, at: ago(2) });
credit(U.attonly, 3000, "FREE", "주간 출석 7일차 보상 (+600P)", { source: POINT_SOURCE_ATTENDANCE, days: 21, at: ago(2) });
credit(U.reviewer, 2000, "FREE", "신규 가입 보너스", { at: ago(30) });
credit(U.recip, 10, "FREE", "신규 가입 보너스", { at: ago(30) });
credit(U.recipLong, 10, "FREE", "신규 가입 보너스", { at: ago(30) });

// full: many logs of every kind, and every charge-cancel state
const F = U.full;
credit(F, 30000, "PAID", "포인트 충전 30,000P (₩30,000)", { at: ago(0, 30) });
credit(F, 3500, "FREE", "캐릭터 제작·이식 이벤트 보상", { at: ago(6) });
credit(F, 1550, "FREE", "주간 출석 3일차 보상 (+350P)", { source: POINT_SOURCE_ATTENDANCE, days: 21, at: ago(2) });

const MODELS = [
  "Gemini 3 Flash",
  "DeepSeek V4 Flash",
  "Claude Opus 5",
  "Gemini 4 Argon Preview Extended Reasoning High Throughput",
];
const NAMES = ["로코", "이혁", "에녹", "권태현", "아주 긴 이름의 캐릭터 이름이 한 줄을 넘어 두 줄 세 줄로 이어지는 경우"];
for (let i = 0; i < 34; i++) {
  usage(F, 18 + ((i * 37) % 260), `대화 · ${NAMES[i % NAMES.length]} (${MODELS[i % MODELS.length]})`, ago(i * 0.4, i * 13));
}
usage(F, 250, "캐릭터 이미지 생성 — 매우 긴 사유 텍스트가 모바일 폭에서 줄바꿈되어야 하며 가로 스크롤이 생기면 안 됩니다 ".repeat(2) + "x".repeat(70), ago(1, 20));
usage(F, 500, "VeryLongUnbrokenReasonTokenWithoutAnySpacesThatCouldOverflowTheRowOnNarrowMobileViewports_0123456789_abcdefghijklmnopqrstuvwxyz", ago(1, 40));

type Batch = { price: number; bonus: number; at: string; kind: "ok" | "unlinked" | "old" | "used" | "cancelled" | "failed" | "pending" | "succeeded" };
const batches: Batch[] = [
  { price: 10000, bonus: 0, at: ago(0, 10), kind: "ok" },
  { price: 50000, bonus: 2500, at: ago(0, 50), kind: "ok" },
  { price: 5000, bonus: 0, at: ago(0, 70), kind: "unlinked" },
  { price: 30000, bonus: 900, at: ago(9), kind: "old" },
  { price: 10000, bonus: 0, at: ago(2), kind: "used" },
  { price: 5000, bonus: 0, at: ago(3), kind: "cancelled" },
  { price: 100000, bonus: 7000, at: ago(1), kind: "failed" },
  { price: 30000, bonus: 900, at: ago(1, 90), kind: "pending" },
  { price: 10000, bonus: 0, at: ago(1, 120), kind: "succeeded" },
];
let n = 0;
for (const b of batches) {
  n++;
  const reason = `포인트 충전 ${b.price.toLocaleString()}P (₩${b.price.toLocaleString()})`;
  const paid = credit(F, b.price, "PAID", reason, { at: b.at });
  const bonus = b.bonus ? credit(F, b.bonus, "FREE", `충전 보너스 ${b.bonus.toLocaleString()}P`, { at: b.at }) : null;
  let checkoutId: number | null = null;
  if (b.kind !== "unlinked") {
    const paymentId = `e43k-pay-${n}`;
    checkoutId = Number(
      db
        .prepare("INSERT INTO portone_checkouts (user_id, package_id, payment_id, amount, status, paid_at) VALUES (?,?,?,?, 'paid', ?)")
        .run(F, `p${b.price}`, paymentId, b.price, b.at).lastInsertRowid,
    );
  }
  const batchId = recordPointChargeBatch(db, {
    userId: F,
    portoneCheckoutId: checkoutId,
    mainPointLogId: paid.logId,
    paidAmount: b.price,
    freeAmount: b.bonus,
    paidTransactionId: paid.transactionId,
    freeTransactionId: bonus?.transactionId ?? null,
    priceKrw: b.price,
    createdAt: b.at,
  });
  if (b.kind === "used") db.prepare("UPDATE point_transactions SET remaining_amount = remaining_amount - 2300 WHERE id=?").run(paid.transactionId);
  if (b.kind === "cancelled") db.prepare("UPDATE point_charge_batches SET cancelled_at=datetime('now') WHERE id=?").run(batchId);
  if (b.kind === "failed" || b.kind === "pending" || b.kind === "succeeded") {
    const state = b.kind === "failed" ? "FAILED" : b.kind === "pending" ? "REQUESTED" : "SUCCEEDED";
    db.prepare(
      `INSERT INTO point_charge_refund_attempts (charge_batch_id, portone_checkout_id, payment_id, refund_request_id, state, failure_message)
       VALUES (?,?,?,?,?,?)`,
    ).run(batchId, checkoutId, `e43k-pay-${n}`, `refund-${batchId}`, state, b.kind === "failed" ? "카드사 응답 오류로 환불이 실패했습니다. 관리자 확인이 필요합니다." : "");
  }
}
for (let i = 0; i < 12; i++) {
  const p = [5000, 10000, 30000][i % 3];
  const paid = credit(F, p, "PAID", `포인트 충전 ${p.toLocaleString()}P (₩${p.toLocaleString()})`, { at: ago(20 + i * 2) });
  recordPointChargeBatch(db, {
    userId: F,
    portoneCheckoutId: null,
    mainPointLogId: paid.logId,
    paidAmount: p,
    freeAmount: 0,
    paidTransactionId: paid.transactionId,
    priceKrw: p,
    createdAt: ago(20 + i * 2),
  });
}
credit(F, 400, "PAID", "포인트 선물 수령 · 선물하는사람님이 보낸 선물", { at: ago(5) });
for (let i = 0; i < 24; i++) {
  credit(F, 100 + i * 25, "FREE", i % 3 === 0 ? `주간 출석 ${(i % 7) + 1}일차 보상 (+${100 + i * 25}P)` : i % 3 === 1 ? "캐릭터 제작·이식 이벤트 보상 — 아주 긴 이벤트 이름이 카드 안에서 줄바꿈되는지 확인하는 사유" : "충전 보너스", {
    at: ago(14 + i * 0.7),
    source: i % 3 === 0 ? POINT_SOURCE_ATTENDANCE : undefined,
    days: i % 3 === 0 ? 21 : undefined,
  });
}

const tokens: Record<string, string> = {};
for (const [k, uid] of Object.entries(U)) {
  const tok = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)").run(tok, uid, new Date(Date.now() + 30 * 864e5).toISOString());
  tokens[k] = tok;
}
fs.writeFileSync("/tmp/e43k-fixtures.json", JSON.stringify({ tokens, users: U }, null, 1));
console.log(JSON.stringify({ U }));
