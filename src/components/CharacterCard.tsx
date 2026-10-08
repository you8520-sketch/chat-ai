import Link from "next/link";
import type { CSSProperties } from "react";

import AdultContentBadge from "@/components/AdultContentBadge";
import CharacterCardCarousel from "@/components/CharacterCardCarousel";
import { characterCardHref } from "@/lib/chatLinks";
import { getCharacterRepresentativePublicUrls } from "@/lib/characterAssets";
import { homePresentationAccent } from "@/lib/homeStagePresentation";
import type { CreatorTierLevel } from "@/lib/creatorShared";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export type CharacterRow = {
  id: number;
  name: string;
  tagline: string;
  genre: string;
  tags: string;
  nsfw: number;
  official: number;
  emoji: string;
  hue: number;
  creator_name: string;
  creator_id?: number | null;
  creator_tier_level?: CreatorTierLevel | null;
  /** Account-level site-managed studio (not characters.official). */
  creator_site_managed?: boolean;
  likes: number;
  /** 누적 대화 턴 (전체 유저 합) */
  total_turns: number;
  /** 누적 이용 유저 수 (character_chat_users ledger) */
  chats_count: number;
  created_at: string;
  audience?: string;
  images?: string;
  assets?: string;
  content_kind?: "character" | "simulation" | string;
};


type CreatorNameBadgeStyle = {
  byClassName: string;
  nameClassName: string;
  medal?: string;
  label?: string;
};

function creatorNameBadgeStyle(tier: CreatorTierLevel | null | undefined): CreatorNameBadgeStyle {
  switch (tier) {
    case "sprout":
      return {
        byClassName: "text-emerald-600/80",
        nameClassName: "font-medium text-emerald-400/90",
        label: "새싹 크리에이터",
      };
    case "standard":
      return {
        byClassName: "text-zinc-500",
        nameClassName: "font-semibold text-zinc-300",
      };
    case "pro":
      return {
        byClassName: "text-slate-400",
        nameClassName: "font-extrabold text-slate-100 drop-shadow-[0_0_7px_rgba(226,232,240,0.42)]",
        medal: "🥈",
        label: "프로 크리에이터",
      };
    default:
      return {
        byClassName: "text-zinc-600",
        nameClassName: "font-medium text-zinc-500",
      };
  }
}

function parseCardTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 캐릭터 일러스트 표준 비율 (693×1024 ≈ 2:3 세로) */
export const CHARACTER_THUMB_ASPECT = "aspect-[2/3]" as const;

type CardVariant = "default" | "editorial";

type CardChrome = {
  frame: string;
  media: string;
  keyline: string;
  overlay: string;
  name: string;
  tag: string;
};

function cardChrome(variant: CardVariant): CardChrome {
  switch (variant) {
    case "editorial":
      return {
        frame:
          "home-editorial-card group/card flex h-full flex-col overflow-hidden border border-white/10 bg-[#0c0e12]",
        media: "home-editorial-media h-full w-full",
        keyline: "",
        overlay:
          "absolute inset-0 z-[3] flex items-center justify-center bg-black/55 px-2 text-center text-[11px] font-semibold text-white sm:text-xs",
        name: "home-editorial-name line-clamp-1 text-[15px] font-semibold tracking-[-0.02em] text-zinc-50",
        tag: "border border-white/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition duration-200 hover:border-white/25 hover:text-zinc-100",
      };
    case "default":
      return {
        frame: cn(
          studioSurface.card,
          "group/card flex h-full flex-col overflow-hidden rounded-2xl bg-[#11141f] shadow-[0_18px_50px_rgba(0,0,0,.18)] transition duration-300 hover:-translate-y-1.5 hover:border-violet-400/40 hover:shadow-[0_22px_60px_rgba(0,0,0,.34)]",
        ),
        media: "h-full w-full transition duration-500 group-hover/card:scale-[1.045]",
        keyline:
          "pointer-events-none absolute inset-2.5 z-[2] rounded-[0.55rem] border border-white/15 transition duration-300 group-hover/card:border-violet-200/30",
        overlay:
          "absolute inset-0 flex items-center justify-center bg-black/55 px-2 text-center text-[11px] font-semibold text-white sm:text-xs",
        name: "line-clamp-1 text-[15px] font-semibold tracking-[-0.02em] text-zinc-50 transition group-hover/card:text-violet-200",
        tag: "rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:border-violet-400/20 hover:bg-violet-600/15 hover:text-violet-200",
      };
    default: {
      const unreachable: never = variant;
      return unreachable;
    }
  }
}

type Props = {
  c: CharacterRow;
  blurNsfw: boolean;
  loggedIn?: boolean;
  /** Home archive presentation. Other routes keep the default card. */
  variant?: CardVariant;
};

export default function CharacterCard({ c, blurNsfw, loggedIn = false, variant = "default" }: Props) {
  const chrome = cardChrome(variant);
  const accent = variant === "editorial" ? homePresentationAccent(c.id) : null;
  const accentStyle: CSSProperties | undefined = accent
    ? ({
        "--card-keyline": accent.wash,
        "--card-hover": accent.wash,
      } as CSSProperties)
    : undefined;
  const tags = parseCardTags(c.tags);
  const hidden = c.nsfw === 1 && blurNsfw;
  const representativeUrls = getCharacterRepresentativePublicUrls(c.assets, c.images);
  const thumb = representativeUrls[0];
  const href = characterCardHref({
    characterId: c.id,
    nsfw: c.nsfw === 1,
    blurNsfw,
    loggedIn,
  });
  const displayTagline = hidden
    ? loggedIn
      ? "성인인증 후 확인할 수 있습니다."
      : "로그인 후 성인인증이 필요합니다."
    : c.tagline?.trim();
  const overlayLabel = loggedIn ? "성인인증 필요" : "로그인 · 성인인증 필요";
  const creatorName = c.creator_name?.trim() || "";
  const creatorHref =
    c.creator_id != null && Number(c.creator_id) > 0
      ? `/creator/${c.creator_id}`
      : null;
  const creatorStyle = c.creator_site_managed
    ? {
        byClassName: "text-violet-500/80",
        nameClassName: "font-semibold text-violet-200",
        label: "공식",
      }
    : creatorNameBadgeStyle(c.creator_tier_level);

  const genreLabel = c.genre?.trim() || "";

  return (
    <article className={chrome.frame} style={accentStyle}>
      <Link href={href} className="relative block">
        <div
          className={`relative ${CHARACTER_THUMB_ASPECT} w-full overflow-hidden`}
          style={{
            background: `linear-gradient(135deg, hsl(${c.hue} 50% 18%), hsl(${(c.hue + 40) % 360} 45% 10%))`,
          }}
        >
          {thumb ? (
            <div className={chrome.media}>
              <CharacterCardCarousel urls={representativeUrls} alt={c.name} hidden={hidden} />
            </div>
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center text-5xl sm:text-6xl ${hidden ? "blur-md" : ""}`}
            >
              {c.emoji}
            </span>
          )}

          {accent ? (
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 top-0 z-[1] w-0.5"
              style={{ backgroundColor: accent.wash }}
            />
          ) : null}

          {chrome.keyline ? <span className={chrome.keyline} /> : null}

          {c.nsfw === 1 && (
            <AdultContentBadge className="absolute right-2.5 top-2.5 z-[4] shadow-sm" />
          )}
          <div className="absolute left-2.5 top-2.5 z-[4] flex flex-wrap gap-1">
            {c.official === 1 && (
              <span className="rounded-md border border-white/10 bg-violet-600/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-sm backdrop-blur">
                공식
              </span>
            )}
            {c.content_kind === "simulation" && (
              <span className="rounded-md border border-white/10 bg-cyan-700/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-sm backdrop-blur">
                다인 시뮬
              </span>
            )}
          </div>

          {hidden && <div className={chrome.overlay}>{overlayLabel}</div>}
        </div>
      </Link>

      <div
        className={cn(
          "flex min-h-[10.5rem] flex-1 flex-col gap-1.5 p-3.5",
          variant === "editorial" && "border-t border-white/10",
        )}
      >
        {variant === "editorial" && genreLabel ? (
          <p className="line-clamp-1 text-[10px] font-medium tracking-[0.14em]" style={{ color: accent?.wash }}>
            {genreLabel}
          </p>
        ) : null}
        <Link href={href} className="min-w-0">
          <h3 className={chrome.name}>{c.name}</h3>
        </Link>

        {creatorName ? (
          creatorHref ? (
            <Link
              href={creatorHref}
              className={cn("line-clamp-1 text-[10px] transition hover:text-violet-200", creatorStyle.nameClassName)}
              title={`${creatorName} 프로필`}
            >
              {creatorStyle.medal && (
                <span className="mr-0.5" title={creatorStyle.label} aria-label={creatorStyle.label}>
                  {creatorStyle.medal}
                </span>
              )}
              <span className={creatorStyle.byClassName}>by</span> {creatorName}
            </Link>
          ) : (
            <p className={cn("line-clamp-1 text-[10px]", creatorStyle.nameClassName)}>
              {creatorStyle.medal && (
                <span className="mr-0.5" title={creatorStyle.label} aria-label={creatorStyle.label}>
                  {creatorStyle.medal}
                </span>
              )}
              <span className={creatorStyle.byClassName}>by</span> {creatorName}
            </p>
          )
        ) : null}

        <Link href={href} className="min-w-0">
          {displayTagline ? (
            <p className={cn(studioType.caption, "line-clamp-3 min-h-[3.75rem] text-[12px] leading-5 text-zinc-300")}>
              {displayTagline}
            </p>
          ) : (
            <p className="min-h-[3.75rem] text-xs leading-5 text-zinc-600">한 줄 소개 없음</p>
          )}
        </Link>

        {tags.length > 0 && (
          <div className="mt-auto flex max-h-[3.15rem] flex-wrap gap-1.5 overflow-hidden pt-1">
            {tags.slice(0, 4).map((t) => (
              <Link
                key={t}
                href={`/search?q=${encodeURIComponent(t)}`}
                className={chrome.tag}
              >
                #{t}
              </Link>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
