import {
  DEFAULT_CHAT_DISPLAY_PREFS,
  loadChatDisplayPrefs,
  normalizeFontSizePreset,
  saveChatDisplayPrefs,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

/** Pre-shared-prefs TRPG-only font size. */
export const TRPG_LEGACY_FONT_SIZE_KEY = "habi:trpg-fontSizePreset";

/** Opt-in: once on, fetch action examples at the start of every ACTION_INPUT turn. */
export const TRPG_ACTION_SUGGESTIONS_KEY = "habi:trpg-showActionSuggestions";

export function loadTrpgActionSuggestionsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(TRPG_ACTION_SUGGESTIONS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveTrpgActionSuggestionsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRPG_ACTION_SUGGESTIONS_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore quota / private mode */
  }
}

export function shouldAutoRequestTrpgActionSuggestions(opts: {
  enabled: boolean;
  phase: string;
  hasDraft: boolean;
  locked: boolean;
  requestedRound: number | null;
  roundNumber: number;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.phase !== "ACTION_INPUT") return false;
  if (!opts.hasDraft || opts.locked) return false;
  if (opts.requestedRound === opts.roundNumber) return false;
  return true;
}

/**
 * Scene readability uses the same chat display prefs (font, size, colors).
 * One-time: if this device only ever set TRPG size, keep that size.
 */
export function loadTrpgDisplayPrefs(): ChatDisplayPrefs {
  const prefs = loadChatDisplayPrefs();
  if (typeof window === "undefined") return prefs;
  try {
    const legacy = localStorage.getItem(TRPG_LEGACY_FONT_SIZE_KEY);
    if (!legacy) return prefs;
    const size = normalizeFontSizePreset(legacy);
    localStorage.removeItem(TRPG_LEGACY_FONT_SIZE_KEY);
    if (prefs.fontSizePreset === DEFAULT_CHAT_DISPLAY_PREFS.fontSizePreset && size !== prefs.fontSizePreset) {
      const next = { ...prefs, fontSizePreset: size };
      saveChatDisplayPrefs(next);
      return next;
    }
  } catch {
    /* ignore */
  }
  return prefs;
}
