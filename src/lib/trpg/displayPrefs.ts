import {
  DEFAULT_CHAT_DISPLAY_PREFS,
  loadChatDisplayPrefs,
  normalizeFontSizePreset,
  saveChatDisplayPrefs,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";

/** Pre-shared-prefs TRPG-only font size. */
export const TRPG_LEGACY_FONT_SIZE_KEY = "habi:trpg-fontSizePreset";

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
