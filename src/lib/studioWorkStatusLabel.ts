import type { CharacterVisibility, ModerationStatus } from "@/lib/characterVisibility";
import { moderationLabel } from "@/lib/characterVisibility";
import { parseAssets } from "@/lib/characterAssets";

/** Studio card chip only — does not change moderation DB or listing gates. */
export const ADMIN_IMAGELESS_PRIVATE_DRAFT_CHIP = "비공개 초안 · 이미지 미등록";

function legacyImageCount(imagesRaw: string | null | undefined): number {
  if (!imagesRaw?.trim()) return 0;
  try {
    const parsed = JSON.parse(imagesRaw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function characterHasAnyRegisteredImage(
  assetsRaw: string | null | undefined,
  imagesRaw: string | null | undefined,
): boolean {
  if (parseAssets(assetsRaw).length > 0) return true;
  return legacyImageCount(imagesRaw) > 0;
}

export function isAdminImagelessPrivateCharacterDraft(input: {
  ownerIsAdmin: boolean;
  isSimulation: boolean;
  official: number;
  visibility: CharacterVisibility;
  moderation: ModerationStatus;
  assets?: string | null;
  images?: string | null;
}): boolean {
  if (!input.ownerIsAdmin) return false;
  if (input.moderation !== "approved") return false;
  if (input.isSimulation) return false;
  if (input.official !== 0) return false;
  if (input.visibility !== "private") return false;
  return !characterHasAnyRegisteredImage(input.assets, input.images);
}

export function studioWorkModerationChipLabel(input: {
  ownerIsAdmin: boolean;
  isSimulation: boolean;
  official: number;
  visibility: CharacterVisibility;
  moderation: ModerationStatus;
  assets?: string | null;
  images?: string | null;
}): string {
  if (isAdminImagelessPrivateCharacterDraft(input)) {
    return ADMIN_IMAGELESS_PRIVATE_DRAFT_CHIP;
  }
  return moderationLabel(input.moderation);
}
