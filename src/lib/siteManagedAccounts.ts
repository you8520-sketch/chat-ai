import crypto from "crypto";
import { getDb } from "@/lib/db";

function hashUnusablePassword(): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(crypto.randomBytes(32).toString("hex"), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * Account-level identity for site-operated official studios.
 * Independent of `users.is_admin` and of `characters.official`.
 */
export function isSiteManagedUser(userId: number | null | undefined): boolean {
  if (userId == null || !Number.isFinite(userId) || userId <= 0) return false;
  const row = getDb()
    .prepare("SELECT site_managed FROM users WHERE id=?")
    .get(userId) as { site_managed: number } | undefined;
  return Number(row?.site_managed ?? 0) === 1;
}

export type SiteManagedStudioCreateInput = {
  /** Public display nickname (e.g. "로맨스 공식 스튜디오"). */
  nickname: string;
  /**
   * Unique login email. Prefer a non-routable domain so the account cannot
   * be claimed via normal signup recovery (e.g. `romance@site-managed.invalid`).
   */
  email: string;
  /** Adult verification is required to own NSFW official characters. Defaults to verified. */
  isAdult?: boolean;
};

export type SiteManagedStudioAccount = {
  id: number;
  email: string;
  nickname: string;
  site_managed: 1;
  is_admin: 0;
  is_adult: number;
};

/**
 * Internal/admin-only factory. Never call from public signup or client body fields.
 * The password is a random unusable hash — these accounts are not for interactive login.
 */
export function createSiteManagedStudioAccount(
  input: SiteManagedStudioCreateInput
): SiteManagedStudioAccount {
  const nickname = String(input.nickname ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!nickname) throw new Error("공식 스튜디오 닉네임이 필요합니다.");
  if (!email || !email.includes("@")) throw new Error("공식 스튜디오 이메일이 필요합니다.");

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(email) as { id: number } | undefined;
  if (existing) throw new Error("이미 존재하는 이메일입니다.");

  const isAdult = input.isAdult === false ? 0 : 1;
  // Unusable credential: random secret, never returned to callers.
  const pwHash = hashUnusablePassword();

  const info = db
    .prepare(
      `INSERT INTO users (email, nickname, pw_hash, points, is_adult, is_admin, site_managed, creator_points)
       VALUES (?,?,?,0,?,0,1,0)`
    )
    .run(email, nickname, pwHash, isAdult);

  const id = Number(info.lastInsertRowid);
  return {
    id,
    email,
    nickname,
    site_managed: 1,
    is_admin: 0,
    is_adult: isAdult,
  };
}

/** Reject any attempt to set site_managed from untrusted client payloads. */
export function rejectClientSiteManagedAssignment(body: Record<string, unknown>): void {
  if (
    Object.prototype.hasOwnProperty.call(body, "site_managed") ||
    Object.prototype.hasOwnProperty.call(body, "siteManaged")
  ) {
    throw new Error("site_managed는 클라이언트가 지정할 수 없습니다.");
  }
}
