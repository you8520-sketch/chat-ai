import { getSessionUser } from "./auth";
import type { User } from "./auth-types";
import { getDb } from "./db";
import { isAdminUser } from "./isAdminUser";

export { isAdminUser } from "./isAdminUser";

export async function requireAdminUser(): Promise<(User & { is_admin: number }) | null> {
  const session = await getSessionUser();
  if (!session) return null;

  const row = getDb()
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(session.id) as { is_admin: number } | undefined;

  const user = { ...session, is_admin: row?.is_admin ?? 0 };
  return isAdminUser(user) ? user : null;
}

export async function requireAdminRequest(req: Request): Promise<boolean> {
  const secret = process.env.ADMIN_EXPORT_SECRET?.trim();
  if (secret) {
    const header = req.headers.get("x-admin-secret");
    if (header === secret) return true;
  }
  const admin = await requireAdminUser();
  return !!admin;
}
