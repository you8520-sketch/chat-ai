import { getDb } from "./db";
import {
  getPointBalance,
  PAID_POINTS_VALID_YEARS,
  POINT_SOURCE_ATTENDANCE,
  type PointBalance,
} from "./points";
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
 * 차감 롯은 만료 임박 → 출석 제외 무료 우선. 유료 수수료 10% / 무료 20%.
 * 출석 포인트는 선물 불가(서버에서 원천 차단). 받는 사람은 net만큼 PAID로 적립.
 * 수수료는 플랫폼 귀속(소각).
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
      | "ATTENDANCE_NOT_GIFTABLE"
      | "RECIPIENT_REQUIRED"
      | "IDEMPOTENCY_CONFLICT"
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

export type GiftableBalance = PointBalance & {
  /** 출석-derived FREE (선물 불가). */
  attendanceFree: number;
  /** 선물 가능 FREE (출석 제외). */
  giftableFree: number;
  /** 선물 가능 합계 (PAID + 출석 제외 FREE). */
  giftableTotal: number;
};

/**
 * Server-authoritative giftable split. Attendance lots are excluded from
 * gift funding; the UI preview and the commit path must both use this.
 */
export function getGiftableBalanceOnDb(
  db: ReturnType<typeof getDb>,
  userId: number
): GiftableBalance {
  const rows = db
    .prepare(
      `SELECT point_type, COALESCE(source,'') AS source, COALESCE(SUM(remaining_amount), 0) AS amt
       FROM point_transactions
       WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')
       GROUP BY point_type, COALESCE(source,'')`
    )
    .all(userId) as { point_type: "PAID" | "FREE"; source: string; amt: number }[];

  let paid = 0;
  let free = 0;
  let attendanceFree = 0;
  for (const row of rows) {
    const amt = roundAmount(Number(row.amt));
    if (row.point_type === "PAID") paid = roundAmount(paid + amt);
    else if (row.point_type === "FREE") {
      free = roundAmount(free + amt);
      if (row.source === POINT_SOURCE_ATTENDANCE) {
        attendanceFree = roundAmount(attendanceFree + amt);
      }
    }
  }
  const giftableFree = roundAmount(free - attendanceFree);
  return {
    total: roundAmount(paid + free),
    paid,
    free,
    attendanceFree,
    giftableFree,
    giftableTotal: roundAmount(paid + giftableFree),
  };
}

export function getGiftableBalance(userId: number): GiftableBalance {
  return getGiftableBalanceOnDb(getDb(), userId);
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

/** 만료 임박 → 출석 제외 무료 우선으로 gross 차감 후 종류별 수수료 산출 */
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
         AND COALESCE(source,'') != ?
       ORDER BY expires_at ASC,
         CASE point_type WHEN 'FREE' THEN 0 ELSE 1 END ASC,
         id ASC`
    )
    .all(userId, POINT_SOURCE_ATTENDANCE) as {
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
  opts: {
    recipientId?: number;
    recipientNickname?: string;
    amount: number;
    /** Idempotency key — scoped to the sender. Same sender+key+payload replays
     * the original gift without re-debit; same sender+key with a different
     * recipient/amount is rejected (IDEMPOTENCY_CONFLICT). */
    clientMutationId?: string;
  }
): GiftResult {
  const gross = roundAmount(opts.amount);
  if (gross < MIN_POINT_GIFT_AMOUNT) {
    throw new PointGiftError(
      `최소 선물 금액은 ${MIN_POINT_GIFT_AMOUNT}P입니다.`,
      "INVALID_AMOUNT"
    );
  }
  const clientMutationId = opts.clientMutationId?.trim() || null;

  const db = getDb();
  return db.transaction(() => {
    const recipient = resolveRecipient(db, opts);
    if (!recipient) {
      throw new PointGiftError("받는 사람을 찾을 수 없습니다.", "RECIPIENT_NOT_FOUND");
    }
    if (recipient.id === senderId) {
      throw new PointGiftError("본인에게는 선물할 수 없습니다.", "SELF_GIFT");
    }

    if (clientMutationId) {
      const existing = db
        .prepare(
          `SELECT id, recipient_id, gross_amount, fee_amount, net_amount,
                  paid_fee_amount, free_fee_amount, paid_gross_amount, free_gross_amount
           FROM point_gifts WHERE sender_id=? AND client_mutation_id=?`
        )
        .get(senderId, clientMutationId) as
        | {
            id: number;
            recipient_id: number;
            gross_amount: number;
            fee_amount: number;
            net_amount: number;
            paid_fee_amount: number;
            free_fee_amount: number;
            paid_gross_amount: number | null;
            free_gross_amount: number | null;
          }
        | undefined;
      if (existing) {
        // Same sender + same key: only an identical payload replays.
        // A reused key with a different recipient/amount is a key-reuse bug
        // across distinct intents — reject loudly instead of silently
        // echoing the old gift (settlement precedent replays because its keys
        // are server-deterministic per turn; gift keys are client-random per
        // intent, so mismatch cannot be a legitimate retry).
        const sameRecipient = existing.recipient_id === recipient.id;
        const sameGross = roundAmount(existing.gross_amount) === roundAmount(gross);
        if (!sameRecipient || !sameGross) {
          throw new PointGiftError(
            "이미 사용된 선물 요청 키입니다. 새로 선물하려면 다시 시도해 주세요.",
            "IDEMPOTENCY_CONFLICT"
          );
        }
        return {
          giftId: existing.id,
          recipientId: existing.recipient_id,
          recipientNickname: recipient.nickname,
          breakdown: {
            gross: roundAmount(existing.gross_amount),
            fee: roundAmount(existing.fee_amount),
            net: roundAmount(existing.net_amount),
            paidGross: roundAmount(existing.paid_gross_amount ?? 0),
            freeGross: roundAmount(existing.free_gross_amount ?? 0),
            paidFee: roundAmount(existing.paid_fee_amount ?? 0),
            freeFee: roundAmount(existing.free_fee_amount ?? 0),
          },
          senderBalance: getPointBalance(senderId),
        };
      }
    }

    // 출석 포인트는 선물 불가 — giftable(출석 제외) 기준으로 판정한다.
    const giftable = getGiftableBalanceOnDb(db, senderId);
    if (giftable.giftableTotal < gross - 0.001) {
      if (giftable.total >= gross - 0.001) {
        throw new PointGiftError(
          "출석 포인트는 선물할 수 없습니다.",
          "ATTENDANCE_NOT_GIFTABLE"
        );
      }
      throw new PointGiftError("포인트가 부족합니다.", "INSUFFICIENT_POINTS");
    }

    // 미리보기로 net>0 확인 (실제 차감 전, giftable split 기준)
    const preview = estimateGiftBreakdown(gross, giftable.giftableFree, giftable.paid);
    if (preview.net <= 0) {
      throw new PointGiftError("선물 금액이 너무 작습니다.", "INVALID_AMOUNT");
    }

    const breakdown = deductGiftPointsInTx(db, senderId, gross, recipient.nickname);
    if (breakdown.net <= 0) {
      throw new PointGiftError("선물 금액이 너무 작습니다.", "INVALID_AMOUNT");
    }

    const recipientReason = `포인트 선물 수령 (${breakdown.net}P)`;
    creditPaidPointsInTx(db, recipient.id, breakdown.net, recipientReason);

    // Schema is owned by the central migration (db.ts) — no request-path ALTER.
    const gift = db
      .prepare(
        `INSERT INTO point_gifts
          (sender_id, recipient_id, gross_amount, fee_amount, net_amount,
           paid_fee_amount, free_fee_amount, paid_gross_amount, free_gross_amount,
           client_mutation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        senderId,
        recipient.id,
        breakdown.gross,
        breakdown.fee,
        breakdown.net,
        breakdown.paidFee,
        breakdown.freeFee,
        breakdown.paidGross,
        breakdown.freeGross,
        clientMutationId
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
