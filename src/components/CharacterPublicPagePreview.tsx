"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CharacterIntroSection from "@/components/CharacterIntroSection";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import CharacterAssetGalleryLightbox from "@/components/CharacterAssetGalleryLightbox";
import CharacterImageViewer from "@/components/CharacterImageViewer";
import CopyPageLinkButton from "@/components/CopyPageLinkButton";
import OfficialCreatorBadge from "@/components/OfficialCreatorBadge";
import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { applyProfilePlaceholders } from "@/lib/userPlaceholder";
import { shouldBlurAssetForViewer, type CharacterAsset } from "@/lib/characterAssets";
import { loadUnlockedCharacterAssetUrls } from "@/lib/characterAssetUnlocks";
import { studioSurface } from "@/lib/studioDesign";

function AssetGalleryStrip({
  assets,
  viewerIsCreator,
  unlockedUrls,
  alt,
  onOpenUnlocked,
}: {
  assets: CharacterAsset[];
  viewerIsCreator: boolean;
  unlockedUrls: ReadonlySet<string>;
  alt: string;
  onOpenUnlocked: (asset: CharacterAsset) => void;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
      {/* 가로 스크롤 · 2행 그리드 (열 우선 채움) */}
      <div className="grid w-max auto-cols-[4.75rem] grid-flow-col grid-rows-2 gap-2 sm:auto-cols-[5.25rem]">
        {assets.map((asset, i) => {
          // 1번 대표 이미지는 항상 공개
          const blurred =
            i !== 0 && shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls);
          return (
            <div
              key={`${asset.url}-${i}`}
              className={`${CHARACTER_THUMB_ASPECT} w-[4.75rem] overflow-hidden rounded-lg border border-white/10 bg-[#0a0d14] sm:w-[5.25rem]`}
            >
              {blurred ? (
                <CharacterAssetImage src={asset.url} alt={alt} blurForViewer />
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenUnlocked(asset)}
                  className="block h-full w-full cursor-zoom-in text-left"
                  aria-label={`${alt} 이미지 크게 보기`}
                >
                  <CharacterAssetImage src={asset.url} alt={alt} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 홈 → 캐릭터 카드 클릭 시 보이는 공개 페이지 레이아웃 */
export default function CharacterPublicPagePreview({
  characterId,
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
  creatorIsPartner = false,
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
  /** 채팅에서 해금한 에셋을 공개 갤러리에도 반영할 때 사용 */
  characterId?: number;
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
  /** 파트너(전속 포함) 등급 이상 — 이름 강조 + 공식 크리에이터 뱃지 표시 */
  creatorIsPartner?: boolean;
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
  const [unlockedUrls, setUnlockedUrls] = useState<ReadonlySet<string>>(() => new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!characterId || viewerIsCreator) {
      setUnlockedUrls(new Set());
      return;
    }
    setUnlockedUrls(loadUnlockedCharacterAssetUrls(characterId));
  }, [characterId, viewerIsCreator]);

  const turnCount = totalTurns > 0 ? totalTurns : chats;
  const displayName = name.trim() || "캐릭터 이름";
  const tagList = tags.map((t) => t.trim()).filter(Boolean);
  const resolvedGallery: CharacterAsset[] =
    galleryAssets.length > 0
      ? galleryAssets.map((a, i) => (i === 0 ? { ...a, viewerBlur: false } : a))
      : assetImageUrls.filter(Boolean).map((url, i) => ({
          url,
          tag: String(i + 1),
          viewerBlur: false,
        }));
  const imageCount = resolvedGallery.length;
  // 대표(갤러리 1번) 우선 — 카드 URL이 없거나 어긋나도 메인 이미지는 항상 공개
  const primary = (cardImageUrl.trim() || resolvedGallery[0]?.url || "").trim();
  const primaryAsset = resolvedGallery.find((a) => a.url === primary) ?? resolvedGallery[0];
  const primaryBlur =
    primaryAsset !== resolvedGallery[0] &&
    shouldBlurAssetForViewer(primaryAsset, viewerIsCreator, unlockedUrls);

  const viewableGallery = useMemo(
    () =>
      resolvedGallery.filter(
        (asset, index) =>
          index === 0 || !shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls)
      ),
    [resolvedGallery, viewerIsCreator, unlockedUrls]
  );

  const resolvedTagline = applyProfilePlaceholders(tagline, {
    viewerDisplayName,
    characterDisplayName: displayName,
  });

  const openUnlockedAsset = (asset: CharacterAsset) => {
    const idx = viewableGallery.findIndex((a) => a.url === asset.url);
    if (idx < 0) return;
    setLightboxIndex(idx);
  };

  const cardVisual = primary ? (
    primaryBlur ? (
      <div className="relative mx-auto w-fit max-w-full overflow-hidden rounded-xl">
        <CharacterAssetImage
          src={primary}
          alt={displayName}
          blurForViewer
          className="w-fit max-w-full"
          imgClassName="block h-auto max-h-[70vh] w-auto max-w-full object-contain"
        />
      </div>
    ) : (
      <CharacterImageViewer src={primary} alt={displayName} hue={hue} />
    )
  ) : (
    <div
      className={`flex ${CHARACTER_THUMB_ASPECT} w-full items-center justify-center overflow-hidden rounded-xl text-7xl sm:text-8xl`}
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
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[1.65rem]">{displayName}</h1>
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
                <span key={t} className={studioSurface.chip}>
                  #{t}
                </span>
              ))}
            </div>
          ) : null}

          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-zinc-500">
            {creatorHref ? (
              <Link
                href={creatorHref}
                className={`hover:underline ${
                  creatorIsPartner ? "font-semibold text-zinc-50" : "text-violet-400"
                }`}
              >
                @{creatorName}
              </Link>
            ) : (
              <span className={creatorIsPartner ? "font-semibold text-zinc-50" : "text-violet-400/90"}>
                @{creatorName}
              </span>
            )}
            {creatorIsPartner && <OfficialCreatorBadge />}
            <span>
              · ❤️ {likes.toLocaleString()} · 💬 {turnCount.toLocaleString()}턴
              {users > 0 ? ` · 👥 ${users.toLocaleString()}명` : null}
              {imageCount > 0 ? ` · 🖼️ ${imageCount.toLocaleString()}장` : null}
            </span>
          </p>

          <AssetGalleryStrip
            assets={resolvedGallery}
            viewerIsCreator={viewerIsCreator}
            unlockedUrls={unlockedUrls}
            alt={displayName}
            onOpenUnlocked={openUnlockedAsset}
          />
        </div>
      </div>

      <CharacterIntroSection
        description={description}
        creatorComment={creatorComment}
        viewerDisplayName={viewerDisplayName}
        characterDisplayName={displayName}
        collapsible={collapsibleDescription}
      />

      <CharacterAssetGalleryLightbox
        open={lightboxIndex != null && viewableGallery.length > 0}
        assets={viewableGallery}
        initialIndex={lightboxIndex ?? 0}
        characterName={displayName}
        viewerIsCreator={viewerIsCreator}
        unlockedUrls={unlockedUrls}
        onClose={() => setLightboxIndex(null)}
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
