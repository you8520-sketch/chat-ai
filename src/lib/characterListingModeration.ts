import type { CharacterAsset } from "@/lib/characterAssets";
import {
  ALL_AGES_ADULT_ASSET_ERROR,
  ALL_AGES_ADULT_TEXT_ERROR,
} from "@/lib/characterAdultText";
import {
  generateShareSlug,
  type CharacterVisibility,
  type ModerationStatus,
} from "@/lib/characterVisibility";

export type CharacterListingDecision = {
  finalVisibility: CharacterVisibility;
  moderationStatus: ModerationStatus;
  moderationNote: string;
  shareSlug: string | null;
  /** True when a human must review before home listing (legacy rows only). */
  awaitingAdmin: boolean;
};

function sameImageList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}

export function isAssetBlockedForAllAges(asset: {
  adultFlagged?: boolean;
  moderationReject?: boolean;
}): boolean {
  return asset.moderationReject === true || asset.adultFlagged === true;
}

export function partitionAllAgesTaggingBatch<T extends {
  adultFlagged?: boolean;
  moderationReject?: boolean;
}>(items: T[], nsfw: boolean): { accepted: T[]; rejected: T[] } {
  if (nsfw) return { accepted: items, rejected: [] };
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const item of items) {
    if (isAssetBlockedForAllAges(item)) rejected.push(item);
    else accepted.push(item);
  }
  return { accepted, rejected };
}

export function allAgesAssetChangeRequest(rejectedCount: number): string {
  if (rejectedCount <= 1) return ALL_AGES_ADULT_ASSET_ERROR;
  return `${rejectedCount}장이 성인용으로 검열되어 넣지 않았습니다. 해당 에셋을 바꿔 주세요.`;
}

export function assetModerationSummary(assets: CharacterAsset[]): {
  rejected: CharacterAsset | undefined;
  adultFlagged: boolean;
  unknown: boolean;
} {
  let adultFlagged = false;
  let unknown = false;
  let rejected: CharacterAsset | undefined;
  for (const asset of assets) {
    if (asset.moderationReject === true) {
      rejected = asset;
      break;
    }
    if (asset.adultFlagged === true) adultFlagged = true;
    else if (asset.adultFlagged !== false) unknown = true;
  }
  return { rejected, adultFlagged, unknown };
}

export function decideCharacterListing(input: {
  requestedVisibility: CharacterVisibility;
  nsfw: boolean;
  assets: CharacterAsset[];
  /**
   * Official characters skip ordinary creator listing review.
   * They must never enter `pending` (the admin queue is for user-created rows).
   */
  official?: boolean;
  existing?: {
    shareSlug: string | null;
    visibility?: CharacterVisibility;
    moderationStatus?: ModerationStatus;
    moderationNote?: string | null;
    imageUrls?: string[] | null;
    nsfw?: boolean;
  };
}): CharacterListingDecision {
  const { requestedVisibility, nsfw, assets, existing } = input;
  if (requestedVisibility === "private") {
    return {
      finalVisibility: "private",
      moderationStatus: "approved",
      moderationNote: "비공개 — 검수 생략",
      shareSlug: null,
      awaitingAdmin: false,
    };
  }

  const imageUrls = assets.map((a) => a.url);
  // Private saves store moderation_status=approved because review is skipped.
  // That is not proof of a prior human image verdict, so it must not be reused.
  const canReuseApproved =
    existing?.moderationStatus === "approved" &&
    existing.visibility !== "private" &&
    Array.isArray(existing.imageUrls) &&
    sameImageList(existing.imageUrls, imageUrls) &&
    Boolean(existing.nsfw) === nsfw;
  if (canReuseApproved) {
    return {
      finalVisibility: requestedVisibility,
      moderationStatus: "approved",
      moderationNote: existing?.moderationNote || "기존 이미지 검수 결과 재사용",
      shareSlug:
        requestedVisibility === "link"
          ? existing?.shareSlug || generateShareSlug()
          : existing?.shareSlug ?? null,
      awaitingAdmin: false,
    };
  }

  const summary = assetModerationSummary(assets);
  if (summary.rejected) {
    return {
      finalVisibility: "private",
      moderationStatus: "rejected",
      moderationNote: summary.rejected.moderationReason?.trim() || "이미지 검열 반려",
      shareSlug: null,
      awaitingAdmin: false,
    };
  }

  if (input.official === true) {
    return {
      finalVisibility: requestedVisibility,
      moderationStatus: "approved",
      moderationNote: "공식 캐릭터 — 홈 노출 검수 생략",
      shareSlug:
        requestedVisibility === "link"
          ? existing?.shareSlug || generateShareSlug()
          : existing?.shareSlug ?? null,
      awaitingAdmin: false,
    };
  }

  if (!nsfw) {
    return {
      finalVisibility: requestedVisibility,
      moderationStatus: "approved",
      moderationNote: "일반 캐릭터 — 성인물 단어 검사 통과, 즉시 공개",
      shareSlug:
        requestedVisibility === "link"
          ? existing?.shareSlug || generateShareSlug()
          : existing?.shareSlug ?? null,
      awaitingAdmin: false,
    };
  }

  // 성인용 캐릭터: 성기·항문 등 reject만 비공개 반려. adultFlagged는 일반 캐릭터 업로드 필터용 메타.
  return {
    finalVisibility: requestedVisibility,
    moderationStatus: "approved",
    moderationNote: summary.unknown
      ? "성인 캐릭터 — 레거시 에셋 adultFlagged 미기록"
      : "성인 캐릭터 — 금지 항목(성기·항문 등) 없음, 즉시 공개",
    shareSlug:
      requestedVisibility === "link"
        ? existing?.shareSlug || generateShareSlug()
        : existing?.shareSlug ?? null,
    awaitingAdmin: false,
  };
}

export function allAgesListingBlockReason(input: {
  nsfw: boolean;
  visibility: CharacterVisibility;
  adultTextHits: string[];
  assets: CharacterAsset[];
}): string | null {
  // Adult characters skip the public-text word filter; only all-ages listings are blocked here.
  if (input.nsfw || input.visibility === "private") return null;
  if (input.adultTextHits.length > 0) {
    return ALL_AGES_ADULT_TEXT_ERROR;
  }
  const summary = assetModerationSummary(input.assets);
  if (summary.rejected || summary.adultFlagged) {
    return ALL_AGES_ADULT_ASSET_ERROR;
  }
  return null;
}
