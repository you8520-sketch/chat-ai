import type { StatusWidgetDisplayMode } from "./types";

/** UI-only visibility pair derived from stored display preference. */
export type StatusWidgetDisplayVisibility = {
  creatorVisible: boolean;
  userVisible: boolean;
};

/**
 * Canonical UI-only owner: StatusWidgetDisplayMode ↔ per-source visibility toggles.
 * Must not derive or write engine / tracking mode.
 */
export function displayVisibilityFromMode(
  mode: StatusWidgetDisplayMode
): StatusWidgetDisplayVisibility {
  switch (mode) {
    case "creator":
      return { creatorVisible: true, userVisible: false };
    case "user":
      return { creatorVisible: false, userVisible: true };
    case "both":
      return { creatorVisible: true, userVisible: true };
    case "hidden":
      return { creatorVisible: false, userVisible: false };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/** Inverse mapping for settings UI saves — writes canonical display mode only. */
export function displayModeFromVisibilityToggles(
  creatorVisible: boolean,
  userVisible: boolean
): StatusWidgetDisplayMode {
  if (creatorVisible && userVisible) return "both";
  if (creatorVisible) return "creator";
  if (userVisible) return "user";
  return "hidden";
}
