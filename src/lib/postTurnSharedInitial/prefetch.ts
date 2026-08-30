import { statusWidgetDiagnosticHash } from "@/lib/statusWidget/diagnostics";
import type { SuggestedReplyItem } from "@/lib/suggestedReplies/types";

/** Discard stale shared prefetch when final assistant prose differs from shared-input prose. */
export function resolvePrefetchedSuggestedReplies(opts: {
  prefetched: SuggestedReplyItem[] | null | undefined;
  prefetchAssistantProseHash: string | null | undefined;
  finalAssistantProse: string;
}): SuggestedReplyItem[] | null {
  if (!opts.prefetched?.length) return null;
  if (!opts.prefetchAssistantProseHash) return opts.prefetched;
  const finalHash = statusWidgetDiagnosticHash(opts.finalAssistantProse);
  if (!finalHash || finalHash !== opts.prefetchAssistantProseHash) return null;
  return opts.prefetched;
}

export function hashAssistantProseForSuggestionPrefetch(
  prose: string | null | undefined
): string | null {
  return statusWidgetDiagnosticHash(prose);
}
