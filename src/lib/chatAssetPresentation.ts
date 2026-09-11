import type { ChatAssetDisplayMode } from "@/lib/chatDisplayPrefs";

/** Effective presentation after applying the viewport policy. Never persisted. */
export type ChatAssetPresentation = "left" | "inline" | "off";

/**
 * Which orientations may render inline in the body.
 * - `left` desktop: only landscape (portrait/square own the left rail).
 * - `inline`: every orientation renders inline.
 */
export type InlineAssetOrientationPolicy = "landscape" | "any";

/** One assistant turn may render at most this many unique inline assets. */
export const INLINE_ASSET_TURN_LIMIT = 3;

/**
 * Canonical stored→effective policy (pure, no persistence).
 *
 * | stored | desktop | mobile |
 * | left   | left    | inline |
 * | inline | inline  | inline |
 * | off    | off     | off    |
 *
 * Viewport never mutates the stored value.
 */
export function resolveChatAssetPresentation(
  mode: ChatAssetDisplayMode,
  isDesktop: boolean
): ChatAssetPresentation {
  if (mode === "off") return "off";
  if (mode === "inline") return "inline";
  return isDesktop ? "left" : "inline";
}

export function inlineOrientationPolicy(
  presentation: ChatAssetPresentation
): InlineAssetOrientationPolicy {
  return presentation === "inline" ? "any" : "landscape";
}
