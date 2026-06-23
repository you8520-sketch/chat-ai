"use client";

import type { GeneratedProfile } from "@/lib/generateProfile";
import { profileTypography, type LayoutHint } from "@/lib/profileTypography";
import { ProfileRichText } from "@/components/ProfileRichText";

function ProfileImage({ imageUrls, name }: { imageUrls: string[]; name?: string | null }) {
  const primary = imageUrls[0];
  const extras = imageUrls.slice(1);

  if (primary?.trim()) {
    return (
      <div className="space-y-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={primary}
          alt={name || "캐릭터"}
          className="h-auto w-full rounded-xl object-contain shadow-lg shadow-black/50 ring-1 ring-white/10"
        />
        {extras.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {extras.map((url) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt=""
                className="aspect-square w-full rounded-lg object-cover object-top ring-1 ring-white/10"
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      className="flex aspect-[3/4] w-full items-center justify-center rounded-xl bg-gradient-to-br from-violet-900/40 via-[#1a1a2e] to-emerald-900/30 shadow-inner ring-1 ring-white/10"
      aria-hidden
    >
      <svg viewBox="0 0 120 160" className="h-2/3 w-auto opacity-30" fill="currentColor">
        <ellipse cx="60" cy="38" rx="28" ry="32" className="text-gray-400" />
        <path d="M20 155 Q20 90 60 85 Q100 90 100 155 Z" className="text-gray-500" />
      </svg>
    </div>
  );
}

function TextBlock({
  profile,
  estimated,
  warning,
}: {
  profile: GeneratedProfile;
  estimated?: boolean;
  warning?: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h2 className={profileTypography.name}>{profile.name || "이름 없음"}</h2>

      {profile.tags && profile.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {profile.tags.map((tag) => (
            <span key={tag} className={profileTypography.tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {profile.summary && (
        <div className={profileTypography.summaryCard}>
          <p className={profileTypography.summaryLabel}>Profile</p>
          <p className={profileTypography.summary}>{profile.summary}</p>
        </div>
      )}

      {profile.appearance && (
        <div className="mt-8">
          <p className={profileTypography.appearanceLabel}>외형</p>
          <div className={profileTypography.appearance}>
            <ProfileRichText content={profile.appearance} />
          </div>
        </div>
      )}

      {profile.biography && (
        <div className="mt-2 min-w-0">
          <ProfileRichText content={profile.biography} />
        </div>
      )}

      {estimated && warning && (
        <p className="mt-6 text-[11px] text-amber-400/90">{warning}</p>
      )}
    </div>
  );
}

function LayoutBody({
  profile,
  imageUrls = [],
  estimated,
  warning,
  stacked = false,
}: {
  profile: GeneratedProfile;
  imageUrls?: string[];
  estimated?: boolean;
  warning?: string;
  stacked?: boolean;
}) {
  const hint: LayoutHint = stacked ? "top" : profile.layoutHint || "right";
  const img = hint === "inline" ? null : <ProfileImage imageUrls={imageUrls} name={profile.name} />;
  const text = <TextBlock profile={profile} estimated={estimated} warning={warning} />;

  if (hint === "inline" || !img) {
    return <div className="flex flex-col gap-8">{text}</div>;
  }

  if (hint === "top") {
    return (
      <div className="flex flex-col gap-8">
        <div className="mx-auto w-full max-w-sm">{img}</div>
        {text}
      </div>
    );
  }

  if (hint === "left") {
    return (
      <div className="flex w-full flex-col gap-8 md:flex-row md:items-start">
        <div className="mx-auto w-full max-w-[280px] shrink-0 md:mx-0">{img}</div>
        {text}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8 md:flex-row-reverse md:items-start">
      <div className="mx-auto w-full max-w-[280px] shrink-0 md:mx-0">{img}</div>
      {text}
    </div>
  );
}

/** 스마트 미리보기 — 사이트 공통 프리미엄 프로필 카드 */
export default function CharacterProfileCard({
  profile,
  imageUrls,
  imageUrl,
  estimated,
  warning,
  compact,
  stacked,
}: {
  profile: GeneratedProfile;
  imageUrls?: string[];
  /** @deprecated imageUrls 사용 */
  imageUrl?: string | null;
  estimated?: boolean;
  warning?: string;
  compact?: boolean;
  /** 미리보기 팝업 — 이미지 상단·본문 전체 너비 */
  stacked?: boolean;
}) {
  const urls = imageUrls?.length ? imageUrls : imageUrl?.trim() ? [imageUrl] : [];
  return (
    <article
      className={`${profileTypography.card} w-full ${compact ? "p-5" : "p-6 sm:p-8"}`}
    >
      <div className={profileTypography.cardGlow} aria-hidden />
      <LayoutBody
        profile={profile}
        imageUrls={urls}
        estimated={estimated}
        warning={warning}
        stacked={stacked}
      />
    </article>
  );
}
