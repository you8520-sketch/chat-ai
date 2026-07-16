/**
 * Platform-wide user co-narration mode — independent of legacy novelModeEnabled.
 *
 * - off: interactive turns; do not write deliberate [B]
 * - limited_external:
 *   - auto progression (short observable [B] action/dialogue)
 *   - OOC opt-in "사칭 허용" → LIMITED CO-NARRATION (최소 공동 서술; 감정·결정 창작 금지)
 * - explicit_full: dormant novelModeEnabled path only (never from isContinue / auto progression)
 */

export type UserCoNarrationMode = "off" | "limited_external" | "explicit_full";

export type ResolveUserCoNarrationModeInput = {
  autoProgressionEnabled?: boolean;
  /** Legacy novel / full impersonation — must never be derived from isContinue */
  novelModeEnabled?: boolean;
  oocUserImpersonationAllowed?: boolean;
};

export function resolveUserCoNarrationMode(
  input: ResolveUserCoNarrationModeInput
): UserCoNarrationMode {
  if (input.novelModeEnabled === true) return "explicit_full";
  if (input.autoProgressionEnabled === true) return "limited_external";
  if (input.oocUserImpersonationAllowed === true) return "limited_external";
  return "off";
}

export function userCoNarrationAllowsExternalAssist(mode: UserCoNarrationMode): boolean {
  return mode === "limited_external" || mode === "explicit_full";
}

export function userCoNarrationIsExplicitFull(mode: UserCoNarrationMode): boolean {
  return mode === "explicit_full";
}
