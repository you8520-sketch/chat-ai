import type { User } from "./auth-types";

export function isAdminUser(
  user: Pick<User, "email"> & { is_admin?: number; account_kind?: string | null }
): boolean {
  if (user.account_kind === "portone_reviewer") return false;
  if (user.is_admin === 1) return true;
  const allow = process.env.ADMIN_EMAILS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allow?.length) return false;
  return allow.includes(user.email.toLowerCase());
}
