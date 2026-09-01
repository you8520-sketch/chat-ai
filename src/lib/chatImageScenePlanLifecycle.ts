import type { ScenePanelCount } from "@/lib/chatImageScenePlan";

export function commitScenePanelCount(
  ref: { current: ScenePanelCount },
  count: ScenePanelCount,
  setState: (count: ScenePanelCount) => void
): void {
  ref.current = count;
  setState(count);
}

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
