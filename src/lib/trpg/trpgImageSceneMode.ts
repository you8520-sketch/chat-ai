export type TrpgImageSceneMode = "RAW" | "AI_FOCUS";

export const TRPG_IMAGE_SCENE_MODE_DEFAULT: TrpgImageSceneMode = "AI_FOCUS";

/** Canonical TRPG illustration scene-mode normalization. */
export function normalizeTrpgImageSceneMode(
  raw: unknown,
  defaultMode: TrpgImageSceneMode = TRPG_IMAGE_SCENE_MODE_DEFAULT
): TrpgImageSceneMode {
  if (raw === "RAW") return "RAW";
  if (raw === "AI_FOCUS") return "AI_FOCUS";
  return defaultMode;
}
