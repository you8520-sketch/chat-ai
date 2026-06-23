import { DEFAULT_TARGET_RESPONSE_CHARS, normalizeTargetResponseChars } from "@/lib/responseLengthConstants";
import {
  DEFAULT_CHAT_DISPLAY_PREFS,
  loadChatDisplayPrefs,
  normalizeFontSizePreset,
  normalizeShowCharacterPortrait,
  normalizeStreamIntervalMs,
  streamCharsPerTickForInterval,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";
import { parseUserNoteCombined } from "@/lib/userNoteStatusWindow";

export function normalizeNovelModeEnabled(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export type UserChatPrefs = {
  v: 1;
  targetResponseChars: number;
  novelModeEnabled: boolean;
  displayPrefs: ChatDisplayPrefs;
};

export const EMPTY_USER_CHAT_PREFS: UserChatPrefs = {
  v: 1,
  targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
  novelModeEnabled: false,
  displayPrefs: DEFAULT_CHAT_DISPLAY_PREFS,
};

function normalizeDisplayPrefs(raw: Partial<ChatDisplayPrefs> | undefined): ChatDisplayPrefs {
  if (!raw) return DEFAULT_CHAT_DISPLAY_PREFS;
  const streamIntervalMs = normalizeStreamIntervalMs(raw.streamIntervalMs);
  return {
    ...DEFAULT_CHAT_DISPLAY_PREFS,
    ...raw,
    streamIntervalMs,
    streamCharsPerTick: streamCharsPerTickForInterval(streamIntervalMs),
    fontSizePreset: normalizeFontSizePreset(raw.fontSizePreset ?? raw.fontSizePx),
    showCharacterPortrait: normalizeShowCharacterPortrait(raw.showCharacterPortrait),
  };
}

export function parseUserChatPrefs(raw: string | null | undefined): UserChatPrefs | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  try {
    const j = JSON.parse(trimmed) as Partial<UserChatPrefs & { statusWindowEnabled?: unknown; userStatusTemplate?: string; writingStyleOverride?: unknown }>;
    if (j?.v !== 1) return null;
    return {
      v: 1,
      targetResponseChars: normalizeTargetResponseChars(
        j.targetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS
      ),
      novelModeEnabled: normalizeNovelModeEnabled(j.novelModeEnabled),
      displayPrefs: normalizeDisplayPrefs(j.displayPrefs),
    };
  } catch {
    return null;
  }
}

export function serializeUserChatPrefs(prefs: UserChatPrefs): string {
  return JSON.stringify({
    v: 1,
    targetResponseChars: normalizeTargetResponseChars(prefs.targetResponseChars),
    novelModeEnabled: normalizeNovelModeEnabled(prefs.novelModeEnabled),
    displayPrefs: normalizeDisplayPrefs(prefs.displayPrefs),
  } satisfies UserChatPrefs);
}

/** SSR 없을 때 — localStorage 캐시 폴백 */
export function loadUserChatPrefsClient(fallback?: UserChatPrefs | null): UserChatPrefs {
  if (fallback) return fallback;
  if (typeof window === "undefined") return EMPTY_USER_CHAT_PREFS;
  try {
    const raw = localStorage.getItem("playai-user-chat-prefs");
    return parseUserChatPrefs(raw) ?? { ...EMPTY_USER_CHAT_PREFS, displayPrefs: loadChatDisplayPrefs() };
  } catch {
    return { ...EMPTY_USER_CHAT_PREFS, displayPrefs: loadChatDisplayPrefs() };
  }
}

export function cacheUserChatPrefsClient(prefs: UserChatPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("playai-user-chat-prefs", serializeUserChatPrefs(prefs));
  } catch {
    /* ignore */
  }
}

export function resolveInitialUserChatPrefs(opts: {
  serverRaw: string | null | undefined;
  chatTargetResponseChars?: number | null;
}): UserChatPrefs {
  const fromUser = parseUserChatPrefs(opts.serverRaw);
  if (fromUser) return fromUser;

  return {
    v: 1,
    targetResponseChars: normalizeTargetResponseChars(
      opts.chatTargetResponseChars ?? DEFAULT_TARGET_RESPONSE_CHARS
    ),
    novelModeEnabled: false,
    displayPrefs: DEFAULT_CHAT_DISPLAY_PREFS,
  };
}

export function buildUserChatPrefsPayload(state: {
  targetResponseChars: number;
  novelModeEnabled?: boolean;
  userNote: string;
  displayPrefs: ChatDisplayPrefs;
}): UserChatPrefs {
  parseUserNoteCombined(state.userNote);
  return {
    v: 1,
    targetResponseChars: normalizeTargetResponseChars(state.targetResponseChars),
    novelModeEnabled: normalizeNovelModeEnabled(state.novelModeEnabled),
    displayPrefs: normalizeDisplayPrefs(state.displayPrefs),
  };
}

export function mergeUserNoteWithChatPrefs(userNote: string, _prefs: UserChatPrefs): string {
  return userNote;
}
