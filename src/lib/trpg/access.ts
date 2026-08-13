import { isAdminUser } from "@/lib/isAdminUser";
import type { User } from "@/lib/auth-types";

/** TRPG UI/API: admins only (`users.is_admin` or ADMIN_EMAILS). */
export function canAccessTrpg(
  user: Pick<User, "email"> & { is_admin?: number } | null | undefined
): boolean {
  if (!user) return false;
  return isAdminUser(user);
}
