import { isAdminUser } from "./isAdminUser";

function envFlag(name: string): "true" | "false" | "unset" {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return "unset";
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return "true";
  if (v === "0" || v === "false" || v === "no") return "false";
  return "unset";
}

function isPaymentsDisabledForBeta(): boolean {
  return (
    envFlag("PORTONE_CHARGE_ENABLED") === "false" ||
    envFlag("NEXT_PUBLIC_PAYMENTS_ENABLED") === "false" ||
    envFlag("NEXT_PUBLIC_PORTONE_CHARGE_ENABLED") === "false"
  );
}

/**
 * Diagnostic/legacy env only. Does NOT grant adult content access.
 * Health and ops surfaces may still report this flag.
 */
export function isAdultVerificationSkipped(): boolean {
  const skip = envFlag("SKIP_ADULT_VERIFICATION");
  if (skip === "true") return true;
  if (skip === "false") return false;
  return isPaymentsDisabledForBeta();
}

/** Stored `users.is_adult` only. Skip and admin beta never promote this. */
export function effectiveIsAdult(isAdult: number | boolean | null | undefined): boolean {
  return !!isAdult;
}

export type AdultAccessUser = {
  email?: string | null;
  is_adult?: number | boolean | null;
  is_admin?: number | null;
};

/**
 * Adult content / safety-filter-off capability.
 * Real stored verification OR existing admin beta-test access.
 * Does not write or promote `users.is_adult`.
 */
export function canAccessAdultContent(user: AdultAccessUser | null | undefined): boolean {
  if (!user) return false;
  if (effectiveIsAdult(user.is_adult)) return true;
  if (!user.email) return false;
  return isAdminUser({
    email: user.email,
    is_admin: user.is_admin ?? 0,
  });
}

/**
 * Safety filter ON (default) hides adult listings.
 * OFF is stored as `users.nsfw_on = 1` and allowed only when `canAccessAdultContent`.
 */
export function shouldHideAdultListings(
  user: (AdultAccessUser & { nsfw_on?: number | boolean | null }) | null | undefined
): boolean {
  if (!canAccessAdultContent(user)) return true;
  return !user?.nsfw_on;
}
