/**
 * Platform-wide user co-narration mode.
 *
 * - off: interactive collaborative turns
 * - limited_external:
 *   - auto progression (external [B] action/dialogue, AI-focal)
 *   - OOC opt-in "사칭 허용" → LIMITED CO-NARRATION
 * - explicit_full: removed from production — legacy novelModeEnabled normalizes to
 *   auto progression (limited_external), never novel inner POV
 */

export type UserCoNarrationMode = "off" | "limited_external";

export type ResolveUserCoNarrationModeInput = {
  autoProgressionEnabled?: boolean;
  /** Legacy novel — normalized to limited_external via auto progression */
  novelModeEnabled?: boolean;
  legacyNovelModeEnabled?: boolean;
  oocUserImpersonationAllowed?: boolean;
};

export function resolveUserCoNarrationMode(
  input: ResolveUserCoNarrationModeInput
): UserCoNarrationMode {
  const legacyNovel =
    input.legacyNovelModeEnabled === true || input.novelModeEnabled === true;
  if (input.autoProgressionEnabled === true || legacyNovel) {
    return "limited_external";
  }
  if (input.oocUserImpersonationAllowed === true) return "limited_external";
  return "off";
}

export function userCoNarrationAllowsExternalAssist(mode: UserCoNarrationMode): boolean {
  return mode === "limited_external";
}

/** @deprecated explicit_full removed from production */
export function userCoNarrationIsExplicitFull(_mode: UserCoNarrationMode): boolean {
  return false;
}
