"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CharacterIntroSection from "@/components/CharacterIntroSection";
import CharacterAssetImage from "@/components/CharacterAssetImage";
import CharacterAssetGalleryLightbox from "@/components/CharacterAssetGalleryLightbox";
import CharacterImageViewer from "@/components/CharacterImageViewer";
import CopyPageLinkButton from "@/components/CopyPageLinkButton";
import OfficialCreatorBadge from "@/components/OfficialCreatorBadge";
import OfficialStudioBadge from "@/components/OfficialStudioBadge";
import { CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import { CHARACTER_HERO_IMAGE_ATTR, HERO_ITEM_ATTR, REVEAL_FIT_ATTR, revealTagKey, splitRevealName } from "@/lib/characterReveal";
import {
  formatPublicHeight,
  formatPublicWeight,
  publicDossierHasItems,
  publicDossierRecordLines,
  type PublicDossierView,
} from "@/lib/characterPublicDossier";
import { PROFILE_BIOGRAPHY_LIMIT } from "@/lib/generateProfile";
import { applyProfilePlaceholders } from "@/lib/userPlaceholder";
import {
  galleryStripImgClassName,
  isRepresentativeAsset,
  safeLockedPreviewUrl,
  shouldBlurAssetForViewer,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { loadUnlockedCharacterAssetUrls } from "@/lib/characterAssetUnlocks";
import { studioSurface } from "@/lib/studioDesign";

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m7-2a8 8 0 0 1-8 8 8.7 8.7 0 0 1-3.5-.74L4 20l.9-3.62A8 8 0 1 1 20 12Z" />
    </svg>
  );
}

function ImageStackIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 4.5h11.2A1.8 1.8 0 0 1 20 6.3V8" />
      <rect x="3.2" y="7.2" width="15.6" height="12.2" rx="2" />
      <circle cx="7.8" cy="11.2" r="1.35" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m4 17.2 3.6-3.5 2.4 2.2 3.5-4.1 4.3 5.4" />
    </svg>
  );
}

function AssetGalleryStrip({
  assets,
  viewerIsCreator,
  unlockedUrls,
  alt,
  onOpenUnlocked,
  singleRow = false,
}: {
  singleRow?: boolean;
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
      <div
        className={`grid w-max auto-cols-[4.75rem] grid-flow-col gap-2 sm:auto-cols-[5.25rem] ${singleRow ? "grid-rows-1" : "grid-rows-2"}`}
      >
        {assets.map((asset, i) => {
          const blurred =
            !isRepresentativeAsset(asset) &&
            i !== 0 &&
            shouldBlurAssetForViewer(asset, viewerIsCreator, unlockedUrls);
          const previewSrc =
            blurred && !viewerIsCreator
              ? safeLockedPreviewUrl(asset) ?? ""
              : asset.url;
          const imgClassName = galleryStripImgClassName(asset);
          return (
            <div
              key={`${asset.url}-${i}`}
              className={`${CHARACTER_THUMB_ASPECT} flex w-[4.75rem] items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#0a0d14] sm:w-[5.25rem]`}
            >
              {blurred ? (
                previewSrc ? (
                  <CharacterAssetImage
                    src={previewSrc}
                    alt={alt}
                    className="h-full w-full"
                    imgClassName={imgClassName}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-zinc-900 text-[10px] text-zinc-500">
                    숨김
                  </div>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenUnlocked(asset)}
                  className="block h-full w-full cursor-zoom-in text-left"
                  aria-label={`${alt} 이미지 크게 보기`}
                >
                  <CharacterAssetImage
                    src={asset.url}
                    alt={alt}
                    className="h-full w-full"
                    imgClassName={imgClassName}
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PublicDossierBlock({
  dossier,
  align = "start",
}: {
  dossier: PublicDossierView;
  align?: "start" | "end";
}) {
  if (!publicDossierHasItems(dossier)) return null;
  const records = publicDossierRecordLines(dossier);
  const rowClass = `flex items-baseline gap-3 text-xs ${align === "end" ? "md:justify-end" : ""}`;
  return (
    <div
      className={`mt-3 w-fit max-w-full space-y-2 ${align === "end" ? "md:ml-auto md:text-right" : ""}`}
    >
      {dossier.world ? (
        <div
          {...{ [HERO_ITEM_ATTR]: "world" }}
          className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] ${
            align === "end" ? "md:justify-end" : ""
          }`}
        >
          <span aria-hidden className="h-px w-6 bg-[#f0e7d4]/30" />
          <span className="text-[#f0e7d4]/50">WORLD</span>
          <span className="tracking-[0.08em] text-[#f0e7d4]">{dossier.world}</span>
        </div>
      ) : null}
      {records.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#f0e7d4]/40">
            Character record
          </p>
          {dossier.gender ? (
            <div {...{ [HERO_ITEM_ATTR]: "gender" }} className={rowClass}>
              <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f0e7d4]/45">
                성별
              </span>
              <span className="font-semibold tabular-nums text-[#f0e7d4]/90">{dossier.gender}</span>
            </div>
          ) : null}
          {dossier.heightCm != null ? (
            <div {...{ [HERO_ITEM_ATTR]: "height" }} className={rowClass}>
              <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f0e7d4]/45">
                키
              </span>
              <span className="font-semibold tabular-nums text-[#f0e7d4]/90">
                {formatPublicHeight(dossier.heightCm)}
              </span>
            </div>
          ) : null}
          {dossier.weightKg != null ? (
            <div {...{ [HERO_ITEM_ATTR]: "weight" }} className={rowClass}>
              <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f0e7d4]/45">
                몸무게
              </span>
              <span className="font-semibold tabular-nums text-[#f0e7d4]/90">
                {formatPublicWeight(dossier.weightKg)}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
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
  creatorIsOfficialStudio = false,
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
  heroVariant = "default",
  genre = "",
  dossier,
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
  /** Site-managed official studio — distinct from partner badge. */
  creatorIsOfficialStudio?: boolean;
  creatorComment?: string;
  likes?: number;
  /** 누적 대화 턴 */
  totalTurns?: number;
  /** 누적 이용 유저 수 */
  users?: number;
  /** @deprecated totalTurns */
  chats?: number;
  viewerDisplayName?: string | null;
  /** 제작 미리보기: false — 실제 공개 페이지: true */
  collapsibleDescription?: boolean;
  creatorHref?: string;
  /** 설정 시 이름 옆 링크 복사 버튼 표시 */
  pagePath?: string;
  /** `poster`: 공개 프로필 상단 포스터 구도 (카드 reveal 전환과 연결). 제작 미리보기·임베드는 `default`. */
  heroVariant?: "default" | "poster";
  genre?: string;
  dossier?: PublicDossierView;
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
      ? galleryAssets.map((a) =>
          isRepresentativeAsset(a) ? { ...a, viewerBlur: false } : a
        )
      : assetImageUrls.filter(Boolean).map((url, i) => ({
          url,
          tag: String(i + 1),
          viewerBlur: false,
          ...(i === 0 ? { representativeRank: 1 } : {}),
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

  const metricsOverlay =
    turnCount > 0 || imageCount > 0 ? (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pb-2.5 pt-12">
        <div className="flex items-center justify-start gap-3 text-[11px] font-semibold tabular-nums text-white/95">
          {turnCount > 0 ? (
            <span
              className="flex items-center gap-1"
              title="누적 대화 턴"
              aria-label={`누적 대화 ${turnCount.toLocaleString()}턴`}
            >
              <ChatBubbleIcon className="h-3.5 w-3.5" />
              {turnCount.toLocaleString()}
            </span>
          ) : null}
          {imageCount > 0 ? (
            <span
              className="flex items-center gap-1"
              title="갤러리 이미지 수"
              aria-label={`이미지 ${imageCount.toLocaleString()}장`}
            >
              <ImageStackIcon className="h-3.5 w-3.5" />
              {imageCount.toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>
    ) : null;

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
        {metricsOverlay}
      </div>
    ) : (
      <div className="relative mx-auto w-fit max-w-full">
        <CharacterImageViewer src={primary} alt={displayName} hue={hue} />
        {metricsOverlay}
      </div>
    )
  ) : (
    <div
      className={`relative flex ${CHARACTER_THUMB_ASPECT} w-full items-center justify-center overflow-hidden rounded-xl text-7xl sm:text-8xl`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 24%), hsl(${(hue + 60) % 360} 60% 12%))`,
      }}
    >
      {emoji}
      {metricsOverlay}
    </div>
  );

  const creatorLine = creatorName.trim() ? (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-500">
      {creatorHref ? (
        <Link
          href={creatorHref}
          className={`hover:underline ${
            creatorIsOfficialStudio || creatorIsPartner ? "text-zinc-50" : "text-violet-400"
          }`}
        >
          @{creatorName}
        </Link>
      ) : (
        <span
          className={
            creatorIsOfficialStudio || creatorIsPartner ? "text-zinc-50" : "text-violet-400/90"
          }
        >
          @{creatorName}
        </span>
      )}
      {creatorIsOfficialStudio ? <OfficialStudioBadge /> : null}
      {!creatorIsOfficialStudio && creatorIsPartner ? <OfficialCreatorBadge /> : null}
    </span>
  ) : null;

  const tagChips =
    tagList.length > 0 ? (
      <div className="mt-3 flex flex-wrap gap-1.5">
        {tagList.map((t, i) => (
          <span key={t} {...{ [HERO_ITEM_ATTR]: revealTagKey(i) }} className={studioSurface.chip}>
            #{t}
          </span>
        ))}
      </div>
    ) : null;

  const galleryStripProps = {
    assets: resolvedGallery,
    viewerIsCreator,
    unlockedUrls,
    alt: displayName,
    onOpenUnlocked: openUnlockedAsset,
  };
  const galleryStrip = <AssetGalleryStrip {...galleryStripProps} />;

  const posterName = splitRevealName(displayName);
  const heroSection = (
    <section
      data-character-hero={characterId ?? ""}
      className="relative isolate overflow-hidden rounded-3xl border border-white/10 px-5 pb-7 pt-7 sm:px-8 md:px-10 md:py-10"
      style={{
        background:
          "radial-gradient(120% 90% at 78% 30%, #1c1825 0%, #0f0e14 55%, #08080b 100%)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(38% 55% at 72% 40%, rgb(139 92 246 / 0.2), transparent 72%)",
        }}
      />
      <div className="relative grid gap-0 md:grid-cols-[minmax(0,26rem)_minmax(15rem,21rem)] md:items-center md:justify-center">
        <div className="relative z-10 order-1 mx-auto w-[min(74vw,19rem)] md:order-2 md:mx-0 md:w-full md:justify-self-end">
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-3 rounded-[1.15rem] border border-[#f0e7d4]/20"
          />
          <div
            {...(characterId ? { [CHARACTER_HERO_IMAGE_ATTR]: String(characterId) } : {})}
            className="relative aspect-[2/3] w-full overflow-hidden rounded-[14px] bg-[#14121a]"
          >
            {primary && !primaryBlur ? (
              <CharacterImageViewer src={primary} alt={displayName} hue={hue} variant="poster" />
            ) : primary ? (
              <CharacterAssetImage
                src={primary}
                alt={displayName}
                blurForViewer
                className="h-full w-full"
                imgClassName="block h-full w-full object-cover object-top"
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center text-7xl sm:text-8xl"
                style={{
                  background: `linear-gradient(135deg, hsl(${hue} 60% 24%), hsl(${(hue + 60) % 360} 60% 12%))`,
                }}
              >
                {emoji}
              </div>
            )}
            {metricsOverlay}
          </div>
        </div>

        <div
          className="relative z-0 order-2 -mt-4 min-w-0 [container-type:inline-size] md:order-1 md:mt-0 md:-mr-14 md:pr-[4.75rem]"
          style={{ ["--hero-chars" as string]: String(posterName.maxChars) }}
        >
          <div
            {...{ [HERO_ITEM_ATTR]: "eyebrow" }}
            className="flex w-fit items-center gap-3 pt-5 text-[11px] font-bold uppercase tracking-[0.22em] md:ml-auto md:pt-0"
          >
            {genre.trim() ? <span className="text-violet-300">{genre.trim()}</span> : null}
            <span aria-hidden className="h-px w-10 bg-[#f0e7d4]/30" />
            <span className="text-[#f0e7d4]/55">Character</span>
          </div>
          <h1
            className="mt-3 break-keep font-black leading-[1] tracking-[-0.04em] text-[#f0e7d4] md:text-right"
            style={{ fontSize: "min(8.5rem, calc(96cqw / (var(--hero-chars) * 0.98)))" }}
          >
            <span className="sr-only">{displayName}</span>
            <span
              aria-hidden
              {...{ [HERO_ITEM_ATTR]: "name", [REVEAL_FIT_ATTR]: "width" }}
              className="block w-fit md:ml-auto"
            >
              {posterName.lines.map((line, i) => (
                <span key={i} className="block whitespace-nowrap pb-[0.06em] md:text-right">
                  {line}
                </span>
              ))}
            </span>
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2 md:justify-end">
            {creatorLine}
            {pagePath ? <CopyPageLinkButton path={pagePath} /> : null}
          </div>
          {resolvedTagline.trim() ? (
            <p
              {...{ [HERO_ITEM_ATTR]: "tagline" }}
              className="mt-3 w-fit max-w-full text-base font-semibold leading-snug text-[#f0e7d4]/85 md:ml-auto md:text-right"
            >
              {resolvedTagline.trim()}
            </p>
          ) : null}
          <div className="md:flex md:justify-end">{tagChips}</div>
          {dossier ? <PublicDossierBlock dossier={dossier} align="end" /> : null}
        </div>
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-6">
      {heroVariant === "poster" ? (
        <>
          {heroSection}
          {imageCount > 1 ? (
            <section aria-label="갤러리" className="rounded-2xl border border-white/10 bg-white/[0.02] px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">
                갤러리
                <span className="ml-2 text-xs font-medium tabular-nums text-zinc-500">{imageCount.toLocaleString()}</span>
              </h2>
              <AssetGalleryStrip {...galleryStripProps} singleRow />
            </section>
          ) : null}
        </>
      ) : (
        <div className="flex flex-col gap-5 md:flex-row md:items-start">
          <div className="w-full shrink-0 md:w-72">{cardVisual}</div>

          <div className="min-w-0 flex-1 overflow-visible">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-[1.65rem]">
                {displayName}
              </h1>
              {creatorLine}
              {pagePath ? <CopyPageLinkButton path={pagePath} /> : null}
            </div>

            {resolvedTagline.trim() ? (
              <p className="mt-1.5 text-base font-semibold leading-snug text-violet-200/95">
                {resolvedTagline.trim()}
              </p>
            ) : null}

            {tagChips}

            {dossier ? <PublicDossierBlock dossier={dossier} /> : null}

            {galleryStrip}
          </div>
        </div>
      )}

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
