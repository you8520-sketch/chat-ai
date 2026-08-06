/**
 * Clear RP runtime modes — prefer these over ambiguous flags alone.
 *
 * - interactive: normal user-input turn; collaborative interactive owner
 * - auto_progression: continue button OR legacy novelModeEnabled normalized
 * - ooc_user_impersonation_allowed: explicit OOC co-narration opt-in on an interactive turn
 *
 * Legacy novelModeEnabled maps to auto_progression (compatibility) — never novel POV.
 */

export type ChatRuntimeMode =
  | "interactive"
  | "auto_progression"
  | "ooc_user_impersonation_allowed";

export type ResolveChatRuntimeModeInput = {
  /** Auto-continue button turn */
  isContinue?: boolean;
  /** Explicit OOC opt-in (persona / focus-zone user note) — ignore when auto-continue */
  oocUserImpersonationAllowed?: boolean;
  /**
   * Legacy novel / explicit_full preference or request flag.
   * Normalized to auto_progression (AI-focal), not novel POV.
   */
  novelModeEnabled?: boolean;
  legacyNovelModeEnabled?: boolean;
};

export function resolveChatRuntimeMode(input: ResolveChatRuntimeModeInput): ChatRuntimeMode {
  const legacyNovel =
    input.legacyNovelModeEnabled === true || input.novelModeEnabled === true;
  if (input.isContinue === true || legacyNovel) {
    return "auto_progression";
  }
  if (input.oocUserImpersonationAllowed === true) {
    return "ooc_user_impersonation_allowed";
  }
  return "interactive";
}

/** Limited external [B] assist (auto) or OOC limited co-narration — not full novel POV. */
export function chatRuntimeModeAllowsUserNarration(mode: ChatRuntimeMode): boolean {
  return mode === "auto_progression" || mode === "ooc_user_impersonation_allowed";
}

export function isInteractiveChatRuntimeMode(mode: ChatRuntimeMode): boolean {
  return mode === "interactive";
}
