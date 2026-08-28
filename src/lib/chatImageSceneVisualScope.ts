import type { SelectableCastAsset } from "@/lib/chatImageCast";
import type { ClientVisibleVisualSubject } from "@/lib/visualSubjects";

export type SceneVisualScopeState = {
  visualSubjects: ClientVisibleVisualSubject[];
  castSelectableAssets: SelectableCastAsset[];
};

/** Empty scene visual identity scope for a new source epoch. */
export function emptySceneVisualScopeState(): SceneVisualScopeState {
  return { visualSubjects: [], castSelectableAssets: [] };
}
