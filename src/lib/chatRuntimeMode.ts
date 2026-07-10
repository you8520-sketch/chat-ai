/**
 * Clear RP runtime modes — prefer these over ambiguous `isContinue` / `novelModeEnabled` alone.
 *
 * - interactive: normal user-input turn; forbid deliberate [B] writing
 * - auto_progression: continue button; persona-based [B] narration allowed
 * - ooc_user_impersonation_allowed: explicit OOC co-narration opt-in on an interactive turn
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
   * @deprecated Prefer isContinue — kept for call sites still using novelModeEnabled (= isContinue)
   */
  novelModeEnabled?: boolean;
};

export function resolveChatRuntimeMode(input: ResolveChatRuntimeModeInput): ChatRuntimeMode {
  if (input.isContinue === true || input.novelModeEnabled === true) {
    return "auto_progression";
  }
  if (input.oocUserImpersonationAllowed === true) {
    return "ooc_user_impersonation_allowed";
  }
  return "interactive";
}

export function chatRuntimeModeAllowsUserNarration(mode: ChatRuntimeMode): boolean {
  return mode === "auto_progression" || mode === "ooc_user_impersonation_allowed";
}

export function isInteractiveChatRuntimeMode(mode: ChatRuntimeMode): boolean {
  return mode === "interactive";
}
