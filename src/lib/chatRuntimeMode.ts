/**
 * Clear RP runtime modes — prefer these over ambiguous flags alone.
 *
 * - interactive: normal user-input turn; forbid deliberate [B] writing
 * - auto_progression: continue button; limited external [B] assist only
 * - ooc_user_impersonation_allowed: explicit OOC co-narration opt-in on an interactive turn
 *
 * Legacy novelModeEnabled must NOT map to auto_progression.
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
   * @deprecated Ignored for runtime mode. Novel/explicit_full is separate and dormant.
   */
  novelModeEnabled?: boolean;
};

export function resolveChatRuntimeMode(input: ResolveChatRuntimeModeInput): ChatRuntimeMode {
  void input.novelModeEnabled;
  if (input.isContinue === true) {
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
