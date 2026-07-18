import { getDb } from "./db";
import { getPointBalance, PAID_POINTS_VALID_YEARS, type PointBalance } from "./points";
import {
  notifyGiftReceived,
  notifyGiftSent,
} from "./userNotifications";
import {
  estimateGiftBreakdown,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
  type GiftBreakdown,
} from "./pointGiftsShared";

export {
  computeGiftBreakdown,
  estimateGiftBreakdown,
  giftFeeRateForType,
  MIN_POINT_GIFT_AMOUNT,
  POINT_GIFT_FEE_RATE,
  POINT_GIFT_FEE_RATE_FREE,
  POINT_GIFT_FEE_RATE_PAID,
  type GiftBreakdown,
} from "./pointGiftsShared";

/**
 * 선물 UX: 보내는 사람이 입력한 금액(gross)이 그대로 차감되고,
 * 차감 롯은 만료 임박 → 무료 우선. 유료 수수료 10% / 무료(출석 포함) 25%.
 * 받는 사람은 net만큼 PAID로 적립. 수수료는 플랫폼 귀속(소각).
 */

export type GiftResult = {
  giftId: number;
  recipientId: number;
  recipientNickname: string;
  breakdown: GiftBreakdown;
  senderBalance: PointBalance;
};

export class PointGiftError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_AMOUNT"
      | "SELF_GIFT"
      | "RECIPIENT_NOT_FOUND"
      | "INSUFFICIENT_PAID_POINTS"
      | "INSUFFICIENT_POINTS"
      | "RECIPIENT_REQUIRED"
  ) {
    super(message);
    this.name = "PointGiftError";
  }
}

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

function readBalance(db: ReturnType<typeof getDb>, userId: number): PointBalance {
  const rows = db
    .prepare(
      `SELECT point_type, COALESCE(SUM(remaining_amount), 0) AS amt
       FROM point_transactions
       WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')
       GROUP BY point_type`
    )
    .all(userId) as { point_type: "PAID" | "FREE"; amt: number }[];

  let paid = 0;
  let free = 0;
  for (const row of rows) {
    const amt = roundAmount(Number(row.amt));
    if (row.point_type === "PAID") paid = amt;
    else if (row.point_type === "FREE") free = amt;
  }
  return { total: roundAmount(paid + free), paid, free };
}

function syncUserPointsColumn(db: ReturnType<typeof getDb>, userId: number) {
  const { total } = readBalance(db, userId);
  db.prepare("UPDATE users SET points = ? WHERE id = ?").run(total, userId);
}

function resolveRecipient(
  db: ReturnType<typeof getDb>,
  opts: { recipientId?: number; recipientNickname?: string }
): { id: number; nickname: string } | null {
  if (opts.recipientId != null && Number.isFinite(opts.recipientId)) {
    const row = db
      .prepare("SELECT id, nickname FROM users WHERE id = ?")
      .get(Math.trunc(opts.recipientId)) as { id: number; nickname: string } | undefined;
    return row ?? null;
  }
  const nick = opts.recipientNickname?.trim();
  if (nick) {
    const row = db
      .prepare("SELECT id, nickname FROM users WHERE nickname = ?")
      .get(nick) as { id: number; nickname: string } | undefined;
    return row ?? null;
  }
  return null;
}

/** 만료 임박 → 무료 우선으로 gross 차감 후 종류별 수수료 산출 */
function deductGiftPointsInTx(
  db: ReturnType<typeof getDb>,
  userId: number,
  amount: number,
  recipientNickname: string
): GiftBreakdown {
  const need = roundAmount(amount);
  let remaining = need;
  let paidGross = 0;
  let freeGross = 0;

  const rows = db
    .prepare(
      `SELECT id, point_type, remaining_amount FROM point_transactions
       WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')
       ORDER BY expires_at ASC,
         CASE point_type WHEN 'FREE' THEN 0 ELSE 1 END ASC,
         id ASC`
    )
    .all(userId) as {
    id: number;
    point_type: "PAID" | "FREE";
    remaining_amount: number;
  }[];

  const update = db.prepare("UPDATE point_transactions SET remaining_amount = ? WHERE id = ?");

  for (const row of rows) {
    if (remaining <= 0) break;
    const available = roundAmount(row.remaining_amount);
    if (available <= 0) continue;
    const take = roundAmount(Math.min(available, remaining));
    update.run(roundAmount(available - take), row.id);
    if (row.point_type === "PAID") paidGross = roundAmount(paidGross + take);
    else freeGross = roundAmount(freeGross + take);
    remaining = roundAmount(remaining - take);
  }

  if (remaining > 0.001) {
    throw new PointGiftError("포인트가 부족합니다.", "INSUFFICIENT_POINTS");
  }

  const paidFee = roundAmount(paidGross * POINT_GIFT_FEE_RATE_PAID);
  const freeFee = roundAmount(freeGross * POINT_GIFT_FEE_RATE_FREE);
  const fee = roundAmount(paidFee + freeFee);
  const net = roundAmount(need - fee);
  const reason = `포인트 선물 → ${recipientNickname} (${need}P, 수수료 ${fee}P)`;

  db.prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
    userId,
    -need,
    reason
  );
  syncUserPointsColumn(db, userId);

  return {
    gross: need,
    fee,
    net,
    paidGross,
    freeGross,
    paidFee,
    freeFee,
  };
}

function creditPaidPointsInTx(
  db: ReturnType<typeof getDb>,
  userId: number,
  amount: number,
  reason: string
) {
  const rounded = roundAmount(amount);
  if (rounded <= 0) return;
  db.prepare(
    `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
     VALUES (?, 'PAID', ?, datetime('now', '+${PAID_POINTS_VALID_YEARS} years'))`
  ).run(userId, rounded);
  db.prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
    userId,
    rounded,
    reason
  );
  syncUserPointsColumn(db, userId);
}

/** @deprecated giftPoints 사용 */
export function giftPaidPoints(
  senderId: number,
  opts: { recipientId?: number; recipientNickname?: string; amount: number }
): GiftResult {
  return giftPoints(senderId, opts);
}

export function giftPoints(
  senderId: number,
  opts: { recipientId?: number; recipientNickname?: string; amount: number }
): GiftResult {
  const gross = roundAmount(opts.amount);
  if (gross < MIN_POINT_GIFT_AMOUNT) {
    throw new PointGiftError(
      `최소 선물 금액은 ${MIN_POINT_GIFT_AMOUNT}P입니다.`,
      "INVALID_AMOUNT"
    );
  }

  const db = getDb();
  return db.transaction(() => {
    const recipient = resolveRecipient(db, opts);
    if (!recipient) {
      throw new PointGiftError("받는 사람을 찾을 수 없습니다.", "RECIPIENT_NOT_FOUND");
    }
    if (recipient.id === senderId) {
      throw new PointGiftError("본인에게는 선물할 수 없습니다.", "SELF_GIFT");
    }

    const senderBal = readBalance(db, senderId);
    if (senderBal.total < gross - 0.001) {
      throw new PointGiftError("포인트가 부족합니다.", "INSUFFICIENT_POINTS");
    }

    // 미리보기로 net>0 확인 (실제 차감 전)
    const preview = estimateGiftBreakdown(gross, senderBal.free, senderBal.paid);
    if (preview.net <= 0) {
      throw new PointGiftError("선물 금액이 너무 작습니다.", "INVALID_AMOUNT");
    }

    const breakdown = deductGiftPointsInTx(db, senderId, gross, recipient.nickname);
    if (breakdown.net <= 0) {
      throw new PointGiftError("선물 금액이 너무 작습니다.", "INVALID_AMOUNT");
    }

    const recipientReason = `포인트 선물 수령 (${breakdown.net}P)`;
    creditPaidPointsInTx(db, recipient.id, breakdown.net, recipientReason);

    const gift = db
      .prepare(
        `INSERT INTO point_gifts (sender_id, recipient_id, gross_amount, fee_amount, net_amount)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        senderId,
        recipient.id,
        breakdown.gross,
        breakdown.fee,
        breakdown.net
      );

    const giftId = Number(gift.lastInsertRowid);
    const senderNick =
      (db.prepare("SELECT nickname FROM users WHERE id=?").get(senderId) as { nickname: string } | undefined)
        ?.nickname ?? "익명";

    notifyGiftSent(db, senderId, giftId, recipient.id, recipient.nickname, breakdown.gross);
    notifyGiftReceived(db, recipient.id, giftId, senderId, senderNick, breakdown.net);

    return {
      giftId,
      recipientId: recipient.id,
      recipientNickname: recipient.nickname,
      breakdown,
      senderBalance: getPointBalance(senderId),
    };
  })();
}
