import type { ResolvedStatusWidgetTurn } from "@/lib/statusWidget/types";

/**
 * Canonical owner — fail-closed gate for StatusWidget + SuggestedReplies shared initial.
 * All widget sources participating in extract must be user-visible in displayMode.
 */
export function isStatusWidgetContextSafeForSuggestedRepliesCoalesce(
  resolved: ResolvedStatusWidgetTurn
): boolean {
  const { needsCharacterValues, needsUserValues, displayMode } = resolved;
  if (!needsCharacterValues && !needsUserValues) return false;

  if (needsCharacterValues && needsUserValues) {
    return displayMode === "both";
  }
  if (needsCharacterValues) {
    return displayMode === "creator" || displayMode === "both";
  }
  return displayMode === "user" || displayMode === "both";
}
