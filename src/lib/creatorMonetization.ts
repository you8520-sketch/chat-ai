import { isSiteManagedUser } from "@/lib/siteManagedAccounts";

/**
 * Canonical owner for creator-economy eligibility (CP, earnings, tier, withdrawal).
 *
 * Account identity (`site_managed`) is the only gate here — never `characters.official`
 * and never `is_admin`. User-paid billing / point deduction must NOT call this.
 */
export function isCreatorMonetizationEligible(
  userId: number | null | undefined
): boolean {
  if (userId == null || !Number.isFinite(userId) || userId <= 0) return false;
  if (isSiteManagedUser(userId)) return false;
  return true;
}
