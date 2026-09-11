/** Pure GM provider-stream presentation helpers (client SceneTurn semantics). */

import {
  stripMalformedTrpgAssetControlMarkers,
  stripTrpgAssetControlMarkers,
} from "./gmSceneAssets";

/**
 * GM_SOURCE_BUFFER — monotonic narration text available to the client.
 * Hidden draft may populate this without counting as visible consumption.
 */
export function resolveTrpgGmSourceBuffer(opts: {
  gmStreamDraft?: string | null;
  canonicalNarration?: string | null;
}): string {
  const draft = opts.gmStreamDraft?.trim() ?? "";
  const canonical = opts.canonicalNarration?.trim() ?? "";
  if (draft && canonical) {
    if (canonical.startsWith(draft) || draft.startsWith(canonical)) {
      return canonical.length >= draft.length ? canonical : draft;
    }
    // Prefer canonical once committed; draft was live-stripped and may diverge by markers.
    return canonical;
  }
  return draft || canonical;
}

/**
 * Pacing source for decorative reveal cursor.
 * Live provider draft keeps valid closed markers for inline asset resolution.
 * Canonical commit still strips markers for prefix-safe pacing handoff.
 */
export function resolveTrpgGmPacingSource(opts: {
  gmStreamDraft?: string | null;
  canonicalNarration?: string | null;
}): string {
  const raw = resolveTrpgGmSourceBuffer(opts);
  const draft = opts.gmStreamDraft?.trim() ?? "";
  const canonical = opts.canonicalNarration?.trim() ?? "";
  if (draft && !canonical) {
    return stripMalformedTrpgAssetControlMarkers(raw) || raw;
  }
  return stripTrpgAssetControlMarkers(raw) || raw;
}

/** Whether the GM slot may advance the visible cursor. */
export function resolveTrpgGmRevealActive(opts: {
  allowGm: boolean;
  skipDecorativeReveal: boolean;
  isFreshLogKey: boolean;
}): boolean {
  return opts.allowGm && opts.isFreshLogKey && !opts.skipDecorativeReveal;
}

/**
 * Visible narration for the current frame.
 * HIDDEN_DRAFT_COUNTS_AS_VISIBLE=false — closed slot shows nothing.
 * skipDecorativeReveal (hidden catch-up) shows full pacing source instantly.
 */
export function resolveTrpgGmShownNarration(opts: {
  allowGm: boolean;
  skipDecorativeReveal: boolean;
  pacingSource: string;
  visibleCursorText: string;
}): string {
  if (!opts.allowGm) return "";
  if (opts.skipDecorativeReveal) return opts.pacingSource;
  return opts.visibleCursorText;
}

export function resolveTrpgGmContentStreaming(opts: {
  allowGm: boolean;
  canonicalNarration?: string | null;
  pacingSource: string;
  decorativeRevealActive: boolean;
  decorativeProgressive: boolean;
}): boolean {
  if (!opts.allowGm || !opts.pacingSource) return false;
  if (!opts.canonicalNarration?.trim() && opts.decorativeRevealActive) {
    return true;
  }
  return opts.decorativeRevealActive && opts.decorativeProgressive;
}

export function resolveTrpgGmRevealComplete(opts: {
  allowGm: boolean;
  skipDecorativeReveal: boolean;
  pacingSource: string;
  decorativeShownLen: number;
}): boolean {
  const fullLen = Array.from(opts.pacingSource).length;
  if (!opts.allowGm || fullLen <= 0) return false;
  if (opts.skipDecorativeReveal) return true;
  return opts.decorativeShownLen >= fullLen;
}

/** Live provider draft may resolve validated markers before canonical commit. */
export function resolveTrpgGmLiveAssetResolution(opts: {
  canonicalCommitted: boolean;
  revealComplete: boolean;
  liveStreaming?: boolean;
}): boolean {
  if (opts.liveStreaming) return true;
  return opts.canonicalCommitted && opts.revealComplete;
}

export function stripLiveGmNarrationText(text: string): string {
  return stripTrpgAssetControlMarkers(text);
}

/** @deprecated Kept for source-shape tests migrating off hidden-as-seen latch. */
export function markTrpgProviderStreamSeen(
  _seen: boolean,
  _gmStreamDraft: string | undefined
): boolean {
  return false;
}
