"use client";

import Link from "next/link";
import CharacterIntroSection from "@/components/CharacterIntroSection";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import CharacterImageViewer from "@/components/CharacterImageViewer";
import CopyPageLinkButton from "@/components/CopyPageLinkButton";
import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { applyProfilePlaceholders } from "@/lib/userPlaceholder";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";

function AssetGalleryStrip({
  assets,
  viewerIsCreator,
  alt,
}: {
  assets: CharacterAsset[];
  viewerIsCreator: boolean;
  alt: string;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
      <div className="flex w-max gap-2">
        {assets.map((asset, i) => (
          <div
            key={`${asset.url}-${i}`}
            className={`${CHARACTER_THUMB_ASPECT} w-[4.75rem] shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#0a0d14] sm:w-[5.25rem]`}
          >
            <CharacterAssetImage
              src={asset.url}
              alt={alt}
              blurForViewer={shouldBlurAssetForViewer(asset, viewerIsCreator)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 홈 → 캐릭터 카드 클릭 시 보이는 공개 페이지 레이아웃 */
export default function CharacterPublicPagePreview({
  name,
  tagline,
  tags,
  description,
  cardImageUrl = "",
  assetImageUrls = [],
  galleryAssets = [],
  viewerIsCreator = false,
  emoji = "🎭",
  hue = 260,
  creatorName = "제작자",
  creatorComment = "",
  likes = 0,
  totalTurns = 0,
  users = 0,
  /** @deprecated totalTurns 사용 */
  chats = 0,
  viewerDisplayName,
  collapsibleDescription = true,
  creatorHref,
  pagePath,
}: {
  name: string;
  tagline: string;
  tags: string[];
  description: string;
  cardImageUrl?: string;
  /** @deprecated galleryAssets 사용 권장 */
  assetImageUrls?: string[];
  galleryAssets?: CharacterAsset[];
  /** 캐릭터 제작자가 보는 경우 — 가림 에셋도 선명하게 */
  viewerIsCreator?: boolean;
  emoji?: string;
  hue?: number;
  creatorName?: string;
  creatorComment?: string;
  likes?: number;
  /** 누적 대화 턴 */
  totalTurns?: number;
  /** 이용 유저 수 */
  users?: number;
  /** @deprecated totalTurns */
  chats?: number;
  viewerDisplayName?: string | null;
  /** 제작 미리보기: false — 실제 공개 페이지: true */
  collapsibleDescription?: boolean;
  creatorHref?: string;
  /** 설정 시 이름 옆 링크 복사 버튼 표시 */
  pagePath?: string;
}) {
  const turnCount = totalTurns > 0 ? totalTurns : chats;
  const primary = cardImageUrl.trim();
  const displayName = name.trim() || "캐릭터 이름";
  const tagList = tags.map((t) => t.trim()).filter(Boolean);
  const resolvedGallery: CharacterAsset[] =
    galleryAssets.length > 0
      ? galleryAssets
      : assetImageUrls.filter(Boolean).map((url, i) => ({
          url,
          tag: String(i + 1),
          viewerBlur: false,
        }));
  const imageCount = resolvedGallery.length;
  const primaryAsset = resolvedGallery.find((a) => a.url === primary);
  const primaryBlur = shouldBlurAssetForViewer(primaryAsset, viewerIsCreator);

  const resolvedTagline = applyProfilePlaceholders(tagline, {
    viewerDisplayName,
    characterDisplayName: displayName,
  });

  const cardVisual = primary ? (
    primaryBlur ? (
      <div className="relative w-full overflow-hidden rounded-2xl md:w-72">
        <CharacterAssetImage
          src={primary}
          alt={displayName}
          blurForViewer
          className="w-full"
          imgClassName="mx-auto h-auto max-h-[70vh] w-full object-contain"
        />
      </div>
    ) : (
      <CharacterImageViewer src={primary} alt={displayName} hue={hue} />
    )
  ) : (
    <div
      className={`flex ${CHARACTER_THUMB_ASPECT} w-full items-center justify-center overflow-hidden rounded-2xl text-7xl sm:text-8xl`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 24%), hsl(${(hue + 60) % 360} 60% 12%))`,
      }}
    >
      {emoji}
    </div>
  );

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <div className="w-full shrink-0 md:w-72">{cardVisual}</div>

        <div className="min-w-0 flex-1 overflow-visible">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-[1.65rem]">{displayName}</h1>
            {pagePath ? <CopyPageLinkButton path={pagePath} /> : null}
          </div>

          {resolvedTagline.trim() ? (
            <p className="mt-1.5 text-base font-semibold leading-snug text-violet-200/95">
              {resolvedTagline.trim()}
            </p>
          ) : null}

          {tagList.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tagList.map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-white/5 px-2.5 py-0.5 text-xs font-medium text-gray-300"
                >
                  #{t}
                </span>
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-sm text-gray-500">
            {creatorHref ? (
              <Link href={creatorHref} className="text-violet-400 hover:underline">
                @{creatorName}
              </Link>
            ) : (
              <span className="text-violet-400/90">@{creatorName}</span>
            )}{" "}
            · ❤️ {likes.toLocaleString()} · 💬 {turnCount.toLocaleString()}턴
            {users > 0 ? ` · 👥 ${users.toLocaleString()}명` : null}
            {imageCount > 0 ? ` · 🖼️ ${imageCount.toLocaleString()}장` : null}
          </p>

          <AssetGalleryStrip assets={resolvedGallery} viewerIsCreator={viewerIsCreator} alt={displayName} />
        </div>
      </div>

      <CharacterIntroSection
        description={description}
        creatorComment={creatorComment}
        viewerDisplayName={viewerDisplayName}
        characterDisplayName={displayName}
        collapsible={collapsibleDescription}
      />
    </div>
  );
}

/** 갤러리 URL + 본문 → 공개 페이지 description 필드 (DB 저장 형식과 동일) */
export function buildPublicCharacterDescription(imageUrls: string[], biography: string): string {
  const parts: string[] = [];
  for (const url of imageUrls) {
    const u = url.trim();
    if (u && !parts.includes(u)) parts.push(u);
  }
  const bio = biography.trim();
  if (bio) parts.push(bio);
  return parts.join("\n\n").slice(0, PROFILE_BIOGRAPHY_LIMIT);
}
