import {
  OPENROUTER_QWEN38_FLASH_MODEL,
  OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL,
} from "@/lib/chatModels";

/** Canonical default primary for asset vision classification. */
export const DEFAULT_ASSET_VISION_PRIMARY = OPENROUTER_QWEN38_FLASH_MODEL;

/** Canonical default fallback when primary fails structured output. */
export const DEFAULT_ASSET_VISION_FALLBACK = OPENROUTER_QWEN3_VL_8B_INSTRUCT_MODEL;

export type AssetVisionEnv = {
  ASSET_VISION_MODEL?: string;
  BACKGROUND_VISION_MODEL?: string;
  ASSET_VISION_MODEL_FALLBACK?: string;
};

function assetVisionEnv(env?: AssetVisionEnv): AssetVisionEnv {
  return env ?? (process.env as AssetVisionEnv);
}

/**
 * Single owner for asset-vision primary model resolution.
 * Precedence: ASSET_VISION_MODEL → legacy BACKGROUND_VISION_MODEL → Qwen3.8 Flash.
 */
export function resolveAssetVisionPrimaryModel(env?: AssetVisionEnv): string {
  const resolved = assetVisionEnv(env);
  return (
    resolved.ASSET_VISION_MODEL?.trim() ||
    resolved.BACKGROUND_VISION_MODEL?.trim() ||
    DEFAULT_ASSET_VISION_PRIMARY
  );
}

/**
 * Ordered primary → fallback models for asset vision.
 * When primary === fallback, returns a single entry.
 */
export function resolveAssetVisionModels(env?: AssetVisionEnv): string[] {
  const resolved = assetVisionEnv(env);
  const primary = resolveAssetVisionPrimaryModel(resolved);
  const fallback =
    resolved.ASSET_VISION_MODEL_FALLBACK?.trim() || DEFAULT_ASSET_VISION_FALLBACK;
  return primary === fallback ? [primary] : [primary, fallback];
}
