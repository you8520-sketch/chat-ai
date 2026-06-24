import "server-only";
import { cookies } from "next/headers";
import crypto from "crypto";
import { getDb } from "./db";
import { effectiveIsAdult } from "./adultVerification";
import { type User, isSubscribed } from "./auth-types";

export type { User } from "./auth-types";
export { isSubscribed } from "./auth-types";

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(pw, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

export function createSession(userId: number): string {
  const db = getDb();
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").run(token, userId, expires);
  return token;
}

export async function getSessionUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get("session")?.value;
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.nickname, u.is_adult, u.nsfw_on, u.points, u.sub_until, u.google_id, u.pref, u.sub_plan, u.sub_auto_renew, u.notice_last_read_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`
    )
    .get(token) as User | undefined;
  if (!row) return null;
  if (!effectiveIsAdult(row.is_adult)) return row;
  return { ...row, is_adult: 1 };
}
