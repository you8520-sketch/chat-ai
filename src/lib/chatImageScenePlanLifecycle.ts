import type { ScenePanelCount } from "@/lib/chatImageScenePlan";

export function shouldApplyComicAiPlanUpgrade(opts: {
  responseEpoch: number;
  currentEpoch: number;
  userEdited: boolean;
}): boolean {
  if (opts.responseEpoch !== opts.currentEpoch) return false;
  if (opts.userEdited) return false;
  return true;
}

/** Apply AI semantic plan at the latest requested panel count, not the request-time closure. */
export function resolveComicAiApplyPanelCount(
  currentPanelCount: ScenePanelCount
): ScenePanelCount {
  return currentPanelCount;
}

export function shouldUseCachedComicAiPlanOnPanelChange(
  comicDefaultAiPlanAppliedKey: string | null,
  sourceKey: string
): boolean {
  return comicDefaultAiPlanAppliedKey === sourceKey;
}
