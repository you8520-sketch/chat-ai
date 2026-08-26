import {
  DEFAULT_CHAT_DISPLAY_PREFS,
  loadChatDisplayPrefs,
  normalizeFontSizePreset,
  normalizeStreamIntervalMs,
  saveChatDisplayPrefs,
  type ChatDisplayPrefs,
} from "@/lib/chatDisplayPrefs";
import type { TrpgReplySuggestion } from "./replySuggestionShared";

/** Pre-shared-prefs TRPG-only font size. */
export const TRPG_LEGACY_FONT_SIZE_KEY = "habi:trpg-fontSizePreset";

/** Opt-in: once on, fetch action examples at the start of every ACTION_INPUT turn. */
export const TRPG_ACTION_SUGGESTIONS_KEY = "habi:trpg-showActionSuggestions";

/** TRPG GM reveal speed — same presets as chat, stored separately. */
export const TRPG_STREAM_INTERVAL_KEY = "habi:trpg-streamIntervalMs";

export function loadTrpgStreamIntervalMs(): number {
  if (typeof window === "undefined") return DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs;
  try {
    const raw = window.localStorage.getItem(TRPG_STREAM_INTERVAL_KEY);
    if (raw == null || raw === "") return DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs;
    const next = normalizeStreamIntervalMs(Number(raw));
    if (raw !== String(next)) {
      window.localStorage.setItem(TRPG_STREAM_INTERVAL_KEY, String(next));
    }
    return next;
  } catch {
    return DEFAULT_CHAT_DISPLAY_PREFS.streamIntervalMs;
  }
}

export function saveTrpgStreamIntervalMs(intervalMs: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      TRPG_STREAM_INTERVAL_KEY,
      String(normalizeStreamIntervalMs(intervalMs))
    );
  } catch {
    /* ignore quota / private mode */
  }
}

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
  /** Same-round failed auto attempt persisted in localStorage — block automatic retry. */
  autoAttemptFailed?: boolean;
}): boolean {
  if (!opts.enabled) return false;
  if (opts.phase !== "ACTION_INPUT") return false;
  if (!opts.hasDraft || opts.locked) return false;
  if (opts.autoAttemptFailed) return false;
  if (opts.requestedRound === opts.roundNumber) return false;
  return true;
}

/** Per-campaign auto-request attempt marker (not a suggestion result cache). */
export const TRPG_ACTION_SUGGESTION_ATTEMPT_PREFIX = "habi:trpg-actionSuggestionAttempt:";

export type TrpgActionSuggestionAttemptState = "pending" | "failed";

type TrpgActionSuggestionAttemptRecord = {
  round: number;
  state: TrpgActionSuggestionAttemptState;
};

function suggestionAttemptKey(campaignId: number): string {
  return `${TRPG_ACTION_SUGGESTION_ATTEMPT_PREFIX}${campaignId}`;
}

export function loadTrpgActionSuggestionAttempt(
  campaignId: number,
  roundNumber: number
): TrpgActionSuggestionAttemptState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(suggestionAttemptKey(campaignId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrpgActionSuggestionAttemptRecord>;
    if (parsed.round !== roundNumber) return null;
    if (parsed.state === "pending" || parsed.state === "failed") return parsed.state;
    return null;
  } catch {
    return null;
  }
}

export function saveTrpgActionSuggestionAttempt(
  campaignId: number,
  roundNumber: number,
  state: TrpgActionSuggestionAttemptState
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      suggestionAttemptKey(campaignId),
      JSON.stringify({ round: roundNumber, state } satisfies TrpgActionSuggestionAttemptRecord)
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearTrpgActionSuggestionAttempt(campaignId: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(suggestionAttemptKey(campaignId));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Per-campaign cache of the last generated action examples (one round per campaign). */
export const TRPG_ACTION_SUGGESTIONS_CACHE_PREFIX = "habi:trpg-actionSuggestions:";

function suggestionsCacheKey(campaignId: number): string {
  return `${TRPG_ACTION_SUGGESTIONS_CACHE_PREFIX}${campaignId}`;
}

/** Returns cached examples only when they were generated for this exact round. */
export function loadTrpgActionSuggestionsCache(
  campaignId: number,
  roundNumber: number
): TrpgReplySuggestion[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(suggestionsCacheKey(campaignId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { round?: unknown; suggestions?: unknown };
    if (parsed.round !== roundNumber) return null;
    if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) return null;
    return parsed.suggestions as TrpgReplySuggestion[];
  } catch {
    return null;
  }
}

export function saveTrpgActionSuggestionsCache(
  campaignId: number,
  roundNumber: number,
  suggestions: readonly TrpgReplySuggestion[]
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      suggestionsCacheKey(campaignId),
      JSON.stringify({ round: roundNumber, suggestions })
    );
  } catch {
    /* ignore quota / private mode */
  }
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
