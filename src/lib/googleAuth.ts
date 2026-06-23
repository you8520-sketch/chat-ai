import "server-only";
import { getDb } from "@/lib/db";
import { creditPoints } from "@/lib/points";
import { SIGNUP_BONUS_POINTS } from "@/lib/plans";
import {
  BETA_INVITE_INVALID_MESSAGE,
  BETA_INVITE_REQUIRED_MESSAGE,
  isBetaInviteGateEnabled,
  isValidBetaInviteCode,
} from "@/lib/betaInvite";

const SAFE_RETURN_PATH = /^\/(?!\/)[^?#]*$/;

export function isGoogleAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function sanitizeOAuthReturnTo(value: string | null | undefined, fallback = "/login"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || !SAFE_RETURN_PATH.test(trimmed)) return fallback;
  return trimmed;
}

export type GoogleUserInfo = {
  sub: string;
  email: string;
  name?: string;
};

export class BetaInviteRejectedError extends Error {
  readonly code: "invite_required" | "invite_invalid";

  constructor(code: "invite_required" | "invite_invalid", message: string) {
    super(message);
    this.code = code;
  }
}

function findExistingGoogleUser(info: GoogleUserInfo): { id: number; pref: string | null } | null {
  const db = getDb();
  const byGoogle = db.prepare("SELECT id, pref FROM users WHERE google_id = ?").get(info.sub) as
    | { id: number; pref: string | null }
    | undefined;
  if (byGoogle) return byGoogle;

  const byEmail = db.prepare("SELECT id, pref FROM users WHERE email = ?").get(info.email) as
    | { id: number; pref: string | null }
    | undefined;
  return byEmail ?? null;
}

export function upsertGoogleUser(
  info: GoogleUserInfo,
  inviteCode?: string | null
): { userId: number; isNew: boolean; pref: string | null } {
  const existing = findExistingGoogleUser(info);
  if (!existing && isBetaInviteGateEnabled()) {
    if (!inviteCode?.trim()) {
      throw new BetaInviteRejectedError("invite_required", BETA_INVITE_REQUIRED_MESSAGE);
    }
    if (!isValidBetaInviteCode(inviteCode)) {
      throw new BetaInviteRejectedError("invite_invalid", BETA_INVITE_INVALID_MESSAGE);
    }
  }

  const db = getDb();

  let user = existing;
  let isNew = false;

  if (!user) {
    const nickname = (info.name?.trim() || info.email.split("@")[0] || "user").slice(0, 40);
    const r = db
      .prepare("INSERT INTO users (email, nickname, pw_hash, google_id, points) VALUES (?,?,?,?,0)")
      .run(info.email, nickname, "", info.sub);
    const userId = Number(r.lastInsertRowid);
    creditPoints(userId, SIGNUP_BONUS_POINTS, "FREE", "신규 가입 보너스");
    user = { id: userId, pref: null };
    isNew = true;
  } else if (existing) {
    db.prepare("UPDATE users SET google_id = ? WHERE id = ?").run(info.sub, user.id);
  }

  return { userId: user.id, isNew, pref: user.pref };
}

export function resolvePostGoogleDest(opts: {
  isNew: boolean;
  pref: string | null;
  redirectAfter?: string | null;
}): string {
  const afterAuth = sanitizeOAuthReturnTo(opts.redirectAfter, "/");
  return opts.isNew ? "/onboarding" : afterAuth;
}
