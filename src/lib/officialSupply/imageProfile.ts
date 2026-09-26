import { resolveChatImageGenerationModel } from "@/lib/chatImageGeneration";
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

/** Max relative ratio deviation still accepted as a lossless-equivalent resize. */
const RATIO_TOLERANCE = 0.02;

export type OfficialImageDimensionVerdict = "exact" | "normalize" | "reject";

/**
 * Deterministic output contract. A provider result in the right orientation and
 * (within 2%) the right ratio is resized to the profile; anything else is a
 * malformed result for that slot only (it is never cropped into shape).
 */
export function evaluateOfficialImageDimensions(
  profile: OfficialImageProfile,
  width: number,
  height: number
): OfficialImageDimensionVerdict {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "reject";
  }
  if (width === profile.width && height === profile.height) return "exact";
  const orientation = width > height ? "landscape" : height > width ? "portrait" : "square";
  if (orientation !== profile.orientation) return "reject";
  const target = profile.width / profile.height;
  const actual = width / height;
  return Math.abs(actual - target) / target <= RATIO_TOLERANCE ? "normalize" : "reject";
}

/**
 * The official pipeline never owns an image model id. The effective model is
 * always the canonical chat image resolver (OPENAI_IMAGE_MODEL override first).
 */
export function resolveOfficialAssetImageModel(env: NodeJS.ProcessEnv = process.env): string {
  return resolveChatImageGenerationModel(env);
}
