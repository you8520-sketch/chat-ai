/** Chat-room 「성인모드」 — adult model handoff on/off. Not listing visibility. */

export const CHAT_ADULT_MODE_LABEL = "성인모드";
export const CHAT_ADULT_MODE_ON_HINT = "성인모드 켜기";
export const CHAT_ADULT_MODE_OFF_HINT = "성인모드 끄기";
export const CHAT_ADULT_MODE_VERIFY_HINT = "성인인증 후 성인모드를 사용할 수 있습니다";

export function parseAdultHandoffEnabled(input: unknown): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (input === 1 || input === "1" || input === "true") return true;
  if (input === 0 || input === "0" || input === "false") return false;
  return undefined;
}

/**
 * Request body wins for the current turn so a just-toggled switch applies
 * before PATCH finishes. Unverified adults cannot enable handoff.
 */
export function resolveChatAdultHandoffEnabled(input: {
  persisted?: unknown;
  requested?: unknown;
  userAdultVerified?: boolean;
}): boolean {
  if (input.userAdultVerified === false) return false;
  const requested = parseAdultHandoffEnabled(input.requested);
  if (requested !== undefined) return requested;
  return parseAdultHandoffEnabled(input.persisted) === true;
}
