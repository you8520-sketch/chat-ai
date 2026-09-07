import type { ScenePanelCount } from "@/lib/chatImageScenePlan";

export function commitScenePanelCount(
  ref: { current: ScenePanelCount },
  count: ScenePanelCount,
  setState: (count: ScenePanelCount) => void
): void {
  ref.current = count;
  setState(count);
}

/** Apply AI semantic plan at the latest requested panel count, not the request-time closure. */
export function resolveComicAiApplyPanelCount(
  currentPanelCount: ScenePanelCount
): ScenePanelCount {
  return currentPanelCount;
}
