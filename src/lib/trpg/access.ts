import type { User } from "@/lib/auth-types";

/** TRPG UI/API: available to every signed-in user. */
export function canAccessTrpg(
  user: Pick<User, "email"> & { is_admin?: number } | null | undefined
): boolean {
  return !!user;
}
