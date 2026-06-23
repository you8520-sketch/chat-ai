import type Database from "better-sqlite3";
import {
  MAX_ADMIN_FREE_POINT_GRANT,
  MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH,
  MIN_ADMIN_FREE_POINT_GRANT,
} from "./adminPointGrantConstants";
import { creditPointsWithIds } from "./points";
import {
  applicationStatusLabel,
  type CreateMigrationApplicationStatus,
} from "./createMigrationEventShared";
import { notifyAdminPointGrant } from "./userNotifications";

export const BETA_FREE_POINT_REASON_PREFIX = "클로즈베타 무료 포인트";

export type BetaFreePointApplicationStatus = CreateMigrationApplicationStatus;

export type BetaFreePointApplicationRow = {
  id: number;
  user_id: number;
  status: BetaFreePointApplicationStatus;
  reward_amount: number | null;
  admin_note: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  created_at: string;
  user_nickname: string;
  user_email: string;
};

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildGrantReason(adminNote?: string): string {
  const trimmed = adminNote?.trim();
  if (!trimmed) return BETA_FREE_POINT_REASON_PREFIX;
  return `${BETA_FREE_POINT_REASON_PREFIX} — ${trimmed}`;
}

export function getLatestApplicationForUser(
  db: Database.Database,
  userId: number
): BetaFreePointApplicationRow | null {
  return (
    (db
      .prepare(
        `SELECT a.id, a.user_id, a.status, a.reward_amount, a.admin_note, a.reviewed_by, a.reviewed_at, a.created_at,
                u.nickname AS user_nickname, u.email AS user_email
         FROM beta_free_point_applications a
         JOIN users u ON u.id = a.user_id
         WHERE a.user_id = ?
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 1`
      )
      .get(userId) as BetaFreePointApplicationRow | undefined) ?? null
  );
}

export function submitBetaFreePointApplication(
  db: Database.Database,
  userId: number
): { ok: true; applicationId: number } | { ok: false; error: string; status?: number } {
  const pending = db
    .prepare(
      "SELECT id FROM beta_free_point_applications WHERE user_id = ? AND status = 'pending'"
    )
    .get(userId) as { id: number } | undefined;
  if (pending) {
    return { ok: false, error: "이미 신청이 접수되어 검토 중입니다.", status: 409 };
  }

  const approved = db
    .prepare(
      "SELECT id FROM beta_free_point_applications WHERE user_id = ? AND status = 'approved'"
    )
    .get(userId) as { id: number } | undefined;
  if (approved) {
    return { ok: false, error: "이미 무료 포인트를 지급받았습니다.", status: 409 };
  }

  const info = db
    .prepare("INSERT INTO beta_free_point_applications (user_id) VALUES (?)")
    .run(userId);

  return { ok: true, applicationId: Number(info.lastInsertRowid) };
}

export function listBetaFreePointApplicationsForAdmin(
  db: Database.Database,
  status?: BetaFreePointApplicationStatus | "all"
): BetaFreePointApplicationRow[] {
  const filter = status && status !== "all" ? "WHERE a.status = ?" : "";
  const params = status && status !== "all" ? [status] : [];
  return db
    .prepare(
      `SELECT a.id, a.user_id, a.status, a.reward_amount, a.admin_note, a.reviewed_by, a.reviewed_at, a.created_at,
              u.nickname AS user_nickname, u.email AS user_email
       FROM beta_free_point_applications a
       JOIN users u ON u.id = a.user_id
       ${filter}
       ORDER BY
         CASE a.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END,
         a.created_at DESC`
    )
    .all(...params) as BetaFreePointApplicationRow[];
}

export function reviewBetaFreePointApplication(
  db: Database.Database,
  applicationId: number,
  adminId: number,
  action: "approve" | "reject",
  opts: { amount?: number; adminNote?: string } = {}
): { ok: true; rewardAmount?: number } | { ok: false; error: string; status?: number } {
  const adminNote = opts.adminNote?.trim() ?? "";
  if (adminNote.length > MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH) {
    return {
      ok: false,
      error: `메모는 ${MAX_ADMIN_FREE_POINT_GRANT_NOTE_LENGTH}자 이내로 입력해 주세요.`,
      status: 400,
    };
  }

  const app = db
    .prepare(
      `SELECT a.id, a.user_id, a.status
       FROM beta_free_point_applications a
       WHERE a.id = ?`
    )
    .get(applicationId) as
    | { id: number; user_id: number; status: BetaFreePointApplicationStatus }
    | undefined;

  if (!app) return { ok: false, error: "신청을 찾을 수 없습니다.", status: 404 };
  if (app.status !== "pending") {
    return { ok: false, error: "이미 처리된 신청입니다.", status: 409 };
  }

  if (action === "reject") {
    db.prepare(
      `UPDATE beta_free_point_applications
       SET status='rejected', admin_note=?, reviewed_by=?, reviewed_at=datetime('now')
       WHERE id=?`
    ).run(adminNote, adminId, applicationId);
    return { ok: true };
  }

  const amount = roundAmount(Number(opts.amount));
  if (!Number.isFinite(amount) || amount < MIN_ADMIN_FREE_POINT_GRANT) {
    return {
      ok: false,
      error: `지급 포인트는 ${MIN_ADMIN_FREE_POINT_GRANT}P 이상으로 입력해 주세요.`,
      status: 400,
    };
  }
  if (amount > MAX_ADMIN_FREE_POINT_GRANT) {
    return {
      ok: false,
      error: `지급 포인트는 ${MAX_ADMIN_FREE_POINT_GRANT.toLocaleString()}P 이하로 입력해 주세요.`,
      status: 400,
    };
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE beta_free_point_applications
       SET status='approved', reward_amount=?, admin_note=?, reviewed_by=?, reviewed_at=datetime('now')
       WHERE id=?`
    ).run(amount, adminNote, adminId, applicationId);

    const reason = buildGrantReason(adminNote);
    const credit = creditPointsWithIds(db, app.user_id, amount, "FREE", reason);
    if (!credit) {
      throw new Error("INVALID_AMOUNT");
    }
    notifyAdminPointGrant(db, app.user_id, credit.logId, adminId, amount, adminNote || undefined);
  })();

  return { ok: true, rewardAmount: amount };
}

export { applicationStatusLabel };
