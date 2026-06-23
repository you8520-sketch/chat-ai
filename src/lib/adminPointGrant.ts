import type Database from "better-sqlite3";
import { getDb } from "./db";
import { creditPointsWithIds, type PointBalance } from "./points";
import { notifyAdminPointGrant } from "./userNotifications";

export const ADMIN_FREE_POINT_GRANT_REASON_PREFIX = "관리자 무료 포인트 지급";
export const MIN_ADMIN_FREE_POINT_GRANT = 1;
export const MAX_ADMIN_FREE_POINT_GRANT = 1_000_000;
export const MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH = 120;

export class AdminPointGrantError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_AMOUNT"
      | "RECIPIENT_NOT_FOUND"
      | "RECIPIENT_REQUIRED"
      | "NOTE_TOO_LONG"
  ) {
    super(message);
    this.name = "AdminPointGrantError";
  }
}

export type AdminFreePointGrantResult = {
  recipientId: number;
  recipientNickname: string;
  amount: number;
  reason: string;
  logId: number;
  recipientBalance: PointBalance;
};

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

function readBalance(db: Database.Database, userId: number): PointBalance {
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

function resolveGrantRecipient(
  db: Database.Database,
  opts: { recipientId?: number; recipientNickname?: string }
): { id: number; nickname: string } | null {
  if (opts.recipientId != null && Number.isFinite(opts.recipientId) && opts.recipientId > 0) {
    const row = db
      .prepare("SELECT id, nickname FROM users WHERE id = ?")
      .get(Math.trunc(opts.recipientId)) as { id: number; nickname: string } | undefined;
    return row ?? null;
  }

  const nick = opts.recipientNickname?.trim();
  if (!nick) return null;

  const row = db
    .prepare("SELECT id, nickname FROM users WHERE nickname = ?")
    .get(nick) as { id: number; nickname: string } | undefined;
  return row ?? null;
}

export function buildAdminFreePointGrantReason(note?: string): string {
  const trimmed = note?.trim();
  if (!trimmed) return ADMIN_FREE_POINT_GRANT_REASON_PREFIX;
  return `${ADMIN_FREE_POINT_GRANT_REASON_PREFIX} — ${trimmed}`;
}

export function grantFreePointsByAdmin(
  db: Database.Database,
  adminId: number,
  opts: {
    recipientId?: number;
    recipientNickname?: string;
    amount: number;
    note?: string;
  }
): AdminFreePointGrantResult {
  const amount = roundAmount(Number(opts.amount));
  if (!Number.isFinite(amount) || amount < MIN_ADMIN_FREE_POINT_GRANT) {
    throw new AdminPointGrantError(
      `최소 지급 금액은 ${MIN_ADMIN_FREE_POINT_GRANT}P입니다.`,
      "INVALID_AMOUNT"
    );
  }
  if (amount > MAX_ADMIN_FREE_POINT_GRANT) {
    throw new AdminPointGrantError(
      `최대 지급 금액은 ${MAX_ADMIN_FREE_POINT_GRANT.toLocaleString()}P입니다.`,
      "INVALID_AMOUNT"
    );
  }

  const note = opts.note?.trim() ?? "";
  if (note.length > MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH) {
    throw new AdminPointGrantError(
      `메모는 ${MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH}자 이내로 입력해 주세요.`,
      "NOTE_TOO_LONG"
    );
  }

  if (!opts.recipientId && !opts.recipientNickname?.trim()) {
    throw new AdminPointGrantError("받는 사람을 입력해 주세요.", "RECIPIENT_REQUIRED");
  }

  return db.transaction(() => {
    const recipient = resolveGrantRecipient(db, opts);
    if (!recipient) {
      throw new AdminPointGrantError("받는 사람을 찾을 수 없습니다.", "RECIPIENT_NOT_FOUND");
    }

    const reason = buildAdminFreePointGrantReason(note);
    const credit = creditPointsWithIds(db, recipient.id, amount, "FREE", reason);
    if (!credit) {
      throw new AdminPointGrantError("지급 금액이 올바르지 않습니다.", "INVALID_AMOUNT");
    }

    notifyAdminPointGrant(db, recipient.id, credit.logId, adminId, amount, note);

    return {
      recipientId: recipient.id,
      recipientNickname: recipient.nickname,
      amount,
      reason,
      logId: credit.logId,
      recipientBalance: readBalance(db, recipient.id),
    };
  })();
}

export function grantFreePointsByAdminSession(
  adminId: number,
  opts: {
    recipientId?: number;
    recipientNickname?: string;
    amount: number;
    note?: string;
  }
): AdminFreePointGrantResult {
  return grantFreePointsByAdmin(getDb(), adminId, opts);
}
