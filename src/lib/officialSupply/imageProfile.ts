import type { OpenAiImageQuality } from "@/lib/openAiImageEdit";
import type { OfficialAssetSlotKind } from "@/lib/officialSupply/types";

/**
 * Official character asset output profiles.
 *
 * Separate product profiles from the chat LD illustration (800x1200), comic and
 * TRPG owners — those size/prompt owners are not touched. Both sizes are
 * native provider sizes with an exact product ratio, so no crop is required.
 */
export type OfficialImageProfile = {
  id: "official_character_representative" | "official_character_rp";
  aspect: "2:3" | "3:2";
  orientation: "portrait" | "landscape";
  size: `${number}x${number}`;
  width: number;
  height: number;
};

/** Card/profile identity anchor — matches `CHARACTER_THUMB_ASPECT` (aspect-[2/3]). */
export const OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE: OfficialImageProfile = {
  id: "official_character_representative",
  aspect: "2:3",
  orientation: "portrait",
  size: "1024x1536",
  width: 1024,
  height: 1536,
};

/** RP expression/emotion/scene assets — landscape so the chat renders them inline. */
export const OFFICIAL_RP_IMAGE_PROFILE: OfficialImageProfile = {
  id: "official_character_rp",
  aspect: "3:2",
  orientation: "landscape",
  size: "1536x1024",
  width: 1536,
  height: 1024,
};

export function officialImageProfileForSlot(kind: OfficialAssetSlotKind): OfficialImageProfile {
  switch (kind) {
    case "representative":
      return OFFICIAL_REPRESENTATIVE_IMAGE_PROFILE;
    case "signature":
    case "emotion":
    case "scene":
      return OFFICIAL_RP_IMAGE_PROFILE;
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown official asset slot kind: ${String(exhaustive)}`);
    }
  }
}

export const OFFICIAL_ASSET_DEFAULT_QUALITY: OpenAiImageQuality = "medium";
export const OFFICIAL_ASSET_OUTPUT_COMPRESSION = 88;

export type OfficialImageDimensionVerdict = "exact" | "reject";

/**
 * Deterministic output contract. The provider is asked for the exact native
 * profile size; anything else (wrong orientation, ratio or resolution) fails
 * that slot only and is regenerated — it is never resized, stretched or cropped.
 */
export function evaluateOfficialImageDimensions(
  profile: OfficialImageProfile,
  width: number,
  height: number
): OfficialImageDimensionVerdict {
  return width === profile.width && height === profile.height ? "exact" : "reject";
}

export const OFFICIAL_ASSET_IMAGE_MODEL_ENV = "OFFICIAL_ASSET_IMAGE_MODEL";

/**
 * Wolfgang representative A/B (2026-10-23): GPT Image 2 followed the user's style references more
 * faithfully than 2.5 Sunburst, which drifts toward the GPT default look. Official assets therefore
 * default to gpt-image-2 regardless of the chat-wide OPENAI_IMAGE_MODEL.
 */
export const OFFICIAL_ASSET_IMAGE_DEFAULT_MODEL = "gpt-image-2";

/**
 * The single model owner for official character asset generation. Chat, comic and TRPG illustration keep
 * `resolveChatImageGenerationModel` (OPENAI_IMAGE_MODEL); this path ignores that variable and changes
 * only through the explicit OFFICIAL_ASSET_IMAGE_MODEL override.
 */
export function resolveOfficialAssetImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return env[OFFICIAL_ASSET_IMAGE_MODEL_ENV]?.trim() || OFFICIAL_ASSET_IMAGE_DEFAULT_MODEL;
}
