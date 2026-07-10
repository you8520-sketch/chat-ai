/**
 * Creator vs user status namespaces.
 * Creator keys are canonical engine state; user keys are display/personalization only.
 */

import { CREATOR_PROTECTED_STATUS_KEYS, type ParsedStatusWidgetTurnValues, type StatusWidgetValues } from "./types";

const CREATOR_NS = "creator.";
const USER_NS = "user.";

export function creatorStatusKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  return k.startsWith(CREATOR_NS) ? k : `${CREATOR_NS}${k}`;
}

export function userStatusKey(key: string): string {
  const k = key.trim();
  if (!k) return "";
  return k.startsWith(USER_NS) ? k : `${USER_NS}${k}`;
}

export function stripStatusNamespace(key: string): string {
  const k = key.trim();
  if (k.startsWith(CREATOR_NS)) return k.slice(CREATOR_NS.length);
  if (k.startsWith(USER_NS)) return k.slice(USER_NS.length);
  return k;
}

export function isCreatorProtectedKey(key: string): boolean {
  const bare = stripStatusNamespace(key).toLowerCase();
  return (CREATOR_PROTECTED_STATUS_KEYS as readonly string[]).includes(bare);
}

/**
 * Merge turn values with namespace isolation.
 * User values never overwrite protected creator machine keys (d_day, affection, …).
 */
export function mergeNamespacedStatusValues(
  values: ParsedStatusWidgetTurnValues | null | undefined
): {
  creator: StatusWidgetValues;
  user: StatusWidgetValues;
  /** Flat map for triggers — creator keys only (bare + creator.* aliases) */
  creatorForTriggers: Record<string, string>;
} {
  const creator: StatusWidgetValues = {};
  const user: StatusWidgetValues = {};

  if (values?.character) {
    for (const [key, value] of Object.entries(values.character)) {
      const bare = stripStatusNamespace(key);
      if (!bare || !value?.trim()) continue;
      creator[bare] = value.trim();
    }
  }

  if (values?.user) {
    for (const [key, value] of Object.entries(values.user)) {
      const bare = stripStatusNamespace(key);
      if (!bare || !value?.trim()) continue;
      // User cannot overwrite protected creator keys into the creator namespace
      if (isCreatorProtectedKey(bare) && creator[bare] != null) continue;
      if (isCreatorProtectedKey(bare)) {
        // Ignore attempts to set protected keys via user widget
        continue;
      }
      user[bare] = value.trim();
    }
  }

  const creatorForTriggers: Record<string, string> = {};
  for (const [bare, value] of Object.entries(creator)) {
    creatorForTriggers[bare] = value;
    creatorForTriggers[bare.toLowerCase()] = value;
    creatorForTriggers[creatorStatusKey(bare)] = value;
  }

  return { creator, user, creatorForTriggers };
}

/** Namespaced view for diagnostics / future mapping (no implicit label mapping). */
export function namespacedStatusSnapshot(
  values: ParsedStatusWidgetTurnValues | null | undefined
): Record<string, string> {
  const { creator, user } = mergeNamespacedStatusValues(values);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creator)) out[creatorStatusKey(k)] = v;
  for (const [k, v] of Object.entries(user)) out[userStatusKey(k)] = v;
  return out;
}
