/** Pure GM provider-stream presentation helpers (client SceneTurn semantics). */

import { stripTrpgAssetControlMarkers } from "./gmSceneAssets";

export function markTrpgProviderStreamSeen(
  seen: boolean,
  gmStreamDraft: string | undefined
): boolean {
  return seen || Boolean(gmStreamDraft?.trim());
}

export function resolveTrpgGmStreamNarrationSource(opts: {
  providerStreamSeen: boolean;
  gmStreamDraft?: string;
  canonicalNarration?: string | null;
}): string {
  if (!opts.providerStreamSeen) return opts.canonicalNarration?.trim() ?? "";
  return (opts.gmStreamDraft ?? opts.canonicalNarration ?? "").trim();
}

export function resolveTrpgGmContentStreaming(opts: {
  directProviderStream: boolean;
  allowGm: boolean;
  canonicalNarration?: string | null;
  narrationSource: string;
  decorativeRevealActive: boolean;
  decorativeProgressive: boolean;
}): boolean {
  if (opts.directProviderStream) {
    return (
      opts.allowGm &&
      !opts.canonicalNarration?.trim() &&
      opts.narrationSource.length > 0
    );
  }
  return opts.decorativeRevealActive && opts.decorativeProgressive;
}

export function resolveTrpgGmShownNarration(opts: {
  directProviderStream: boolean;
  allowGm: boolean;
  narrationSource: string;
  decorativeShownText: string;
}): string {
  if (opts.directProviderStream && opts.allowGm) return opts.narrationSource;
  return opts.decorativeShownText;
}

export function resolveTrpgGmRevealComplete(opts: {
  directProviderStream: boolean;
  narrationSource: string;
  canonicalNarration?: string | null;
  decorativeShownLen: number;
}): boolean {
  const fullLen = Array.from(opts.narrationSource).length;
  if (fullLen <= 0) return false;
  if (opts.directProviderStream) return Boolean(opts.canonicalNarration?.trim());
  return opts.decorativeShownLen >= fullLen;
}

/** Live provider draft: prose only until canonical commit runs enforceGmSceneAssetMarkers. */
export function resolveTrpgGmLiveAssetResolution(opts: {
  directProviderStream: boolean;
  canonicalCommitted: boolean;
}): boolean {
  if (!opts.directProviderStream) return true;
  return opts.canonicalCommitted;
}

export function stripLiveGmNarrationText(text: string): string {
  return stripTrpgAssetControlMarkers(text);
}
