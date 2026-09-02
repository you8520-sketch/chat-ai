/** Chat-room 「성인모드」 — adult RP level on/off. Not listing visibility. */

export const CHAT_ADULT_MODE_LABEL = "성인모드";
export const CHAT_ADULT_MODE_ON_HINT = "성인모드 켜기";
export const CHAT_ADULT_MODE_OFF_HINT = "성인모드 끄기";
export const CHAT_ADULT_MODE_VERIFY_HINT = "성인인증 후 성인모드를 사용할 수 있습니다";

/** Home/header 「성인 캐릭터 표시」 — listing visibility only (`users.nsfw_on`). */
export const HOME_ADULT_CHARACTER_VISIBILITY_FIELD = "users.nsfw_on";

export function parseAdultHandoffEnabled(input: unknown): boolean | undefined {
  if (typeof input === "boolean") return input;
  if (input === 1 || input === "1" || input === "true") return true;
  if (input === 0 || input === "0" || input === "false") return false;
  return undefined;
}

/**
 * Room adult mode persistence (`chats.adult_handoff_enabled`).
 * Request body wins for the current turn so a just-toggled switch applies
 * before PATCH finishes. Unverified adults cannot enable room adult mode.
 */
export function resolveRoomAdultModeEnabled(input: {
  persisted?: unknown;
  requested?: unknown;
  userAdultVerified?: boolean;
}): boolean {
  if (input.userAdultVerified === false) return false;
  const requested = parseAdultHandoffEnabled(input.requested);
  if (requested !== undefined) return requested;
  return parseAdultHandoffEnabled(input.persisted) === true;
}

/** @deprecated use resolveRoomAdultModeEnabled */
export const resolveChatAdultHandoffEnabled = resolveRoomAdultModeEnabled;

/**
 * Authoritative server-side adult RP level for prompt/routing.
 * Client isAdultMode / isNsfwMode must not override this.
 */
export function resolveEffectiveAdultRp(input: {
  userAdultVerified: boolean;
  roomAdultModeEnabled: boolean;
}): boolean {
  return input.userAdultVerified === true && input.roomAdultModeEnabled === true;
}
