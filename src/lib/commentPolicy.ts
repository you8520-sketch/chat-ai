import type Database from "better-sqlite3";
import {
  COMMENT_MIN_ACCOUNT_AGE_DAYS,
  COMMENT_MIN_CHARACTER_POINTS,
  COMMENT_MIN_SITE_POINTS,
  COMMENT_REPORT_RESTRICT_DAYS,
  COMMENT_REPORT_TRUST_MIN,
  COMMENT_REPORT_TRUST_PENALTY,
} from "@/lib/commentModerationPolicy";

export type CommentEligibilityReason =
  | "ok"
  | "not_logged_in"
  | "comment_banned"
  | "account_too_new"
  | "insufficient_points"
  | "report_restricted"
  | "report_trust_low";

export type CommentEligibility = {
  ok: boolean;
  reason: CommentEligibilityReason;
  message: string;
};

function parseSqliteUtcMs(iso: string): number {
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : 0;
}

export function userAccountAgeDays(db: Database.Database, userId: number): number {
  const row = db.prepare("SELECT created_at FROM users WHERE id=?").get(userId) as
    | { created_at: string }
    | undefined;
  if (!row?.created_at) return 0;
  const ageMs = Date.now() - parseSqliteUtcMs(row.created_at);
  return ageMs / (24 * 60 * 60 * 1000);
}

export function userSpentPointsOnCharacter(
  db: Database.Database,
  userId: number,
  characterId: number
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(pl.delta)), 0) AS spent
       FROM point_logs pl
       INNER JOIN chats ch ON ch.id = pl.chat_id
       WHERE pl.user_id = ? AND ch.character_id = ? AND pl.delta < 0`
    )
    .get(userId, characterId) as { spent: number };
  return Number(row?.spent ?? 0);
}

export function userTotalSpentPoints(db: Database.Database, userId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(ABS(delta)), 0) AS spent
       FROM point_logs WHERE user_id = ? AND delta < 0`
    )
    .get(userId) as { spent: number };
  return Number(row?.spent ?? 0);
}

export function getCommentReportTrust(db: Database.Database, userId: number): number {
  const row = db
    .prepare("SELECT comment_report_trust FROM users WHERE id=?")
    .get(userId) as { comment_report_trust: number | null } | undefined;
  return row?.comment_report_trust ?? 100;
}

export function isCommentReportRestricted(db: Database.Database, userId: number): boolean {
  const row = db
    .prepare("SELECT comment_report_restricted_until FROM users WHERE id=?")
    .get(userId) as { comment_report_restricted_until: string | null } | undefined;
  if (!row?.comment_report_restricted_until) return false;
  return parseSqliteUtcMs(row.comment_report_restricted_until) > Date.now();
}

function accountAgeOk(db: Database.Database, userId: number): boolean {
  return userAccountAgeDays(db, userId) >= COMMENT_MIN_ACCOUNT_AGE_DAYS;
}

export function checkCommentWriteEligibility(
  db: Database.Database,
  userId: number,
  opts: { characterId?: number; isOwner?: boolean }
): CommentEligibility {
  if (opts.isOwner) {
    return { ok: true, reason: "ok", message: "" };
  }

  const banned = db.prepare("SELECT comment_banned FROM users WHERE id=?").get(userId) as
    | { comment_banned: number }
    | undefined;
  if ((banned?.comment_banned ?? 0) !== 0) {
    return {
      ok: false,
      reason: "comment_banned",
      message: "댓글 작성이 제한된 계정입니다.",
    };
  }

  if (!accountAgeOk(db, userId)) {
    return {
      ok: false,
      reason: "account_too_new",
      message: `가입 후 ${COMMENT_MIN_ACCOUNT_AGE_DAYS}일이 지나야 댓글을 작성할 수 있습니다.`,
    };
  }

  if (opts.characterId != null) {
    const spent = userSpentPointsOnCharacter(db, userId, opts.characterId);
    if (spent < COMMENT_MIN_CHARACTER_POINTS) {
      return {
        ok: false,
        reason: "insufficient_points",
        message: `이 캐릭터와 누적 ${COMMENT_MIN_CHARACTER_POINTS.toLocaleString()}포인트 이상 대화한 후 댓글을 작성할 수 있습니다.`,
      };
    }
  } else {
    const spent = userTotalSpentPoints(db, userId);
    if (spent < COMMENT_MIN_SITE_POINTS) {
      return {
        ok: false,
        reason: "insufficient_points",
        message: `누적 ${COMMENT_MIN_SITE_POINTS.toLocaleString()}포인트 이상 사용한 후 댓글을 작성할 수 있습니다.`,
      };
    }
  }

  return { ok: true, reason: "ok", message: "" };
}

export function checkCommentReportEligibility(
  db: Database.Database,
  userId: number,
  opts: { characterId?: number }
): CommentEligibility {
  if (isCommentReportRestricted(db, userId)) {
    return {
      ok: false,
      reason: "report_restricted",
      message: `허위 신고가 반복되어 ${COMMENT_REPORT_RESTRICT_DAYS}일간 신고 기능이 제한되었습니다.`,
    };
  }

  if (getCommentReportTrust(db, userId) < COMMENT_REPORT_TRUST_MIN) {
    return {
      ok: false,
      reason: "report_trust_low",
      message: "신고 신뢰도가 낮아 신고할 수 없습니다.",
    };
  }

  if (!accountAgeOk(db, userId)) {
    return {
      ok: false,
      reason: "account_too_new",
      message: `가입 후 ${COMMENT_MIN_ACCOUNT_AGE_DAYS}일이 지나야 신고할 수 있습니다.`,
    };
  }

  const spent =
    opts.characterId != null
      ? userSpentPointsOnCharacter(db, userId, opts.characterId)
      : userTotalSpentPoints(db, userId);
  const minPoints = opts.characterId != null ? COMMENT_MIN_CHARACTER_POINTS : COMMENT_MIN_SITE_POINTS;
  if (spent < minPoints) {
    return {
      ok: false,
      reason: "insufficient_points",
      message: `누적 ${minPoints.toLocaleString()}포인트 이상 사용한 후 신고할 수 있습니다.`,
    };
  }

  return { ok: true, reason: "ok", message: "" };
}

export function penalizeCommentReporterTrust(db: Database.Database, userId: number): void {
  const trust = getCommentReportTrust(db, userId);
  const next = Math.max(0, trust - COMMENT_REPORT_TRUST_PENALTY);
  db.prepare("UPDATE users SET comment_report_trust=? WHERE id=?").run(next, userId);
  if (next < COMMENT_REPORT_TRUST_MIN) {
    const until = new Date(Date.now() + COMMENT_REPORT_RESTRICT_DAYS * 24 * 60 * 60 * 1000);
    db.prepare("UPDATE users SET comment_report_restricted_until=? WHERE id=?").run(
      until.toISOString().slice(0, 19).replace("T", " "),
      userId
    );
  }
}
