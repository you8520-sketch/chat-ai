import Link from "next/link";
import type { CSSProperties } from "react";

import AdultContentBadge from "@/components/AdultContentBadge";
import CharacterCardCarousel from "@/components/CharacterCardCarousel";
import { characterCardHref } from "@/lib/chatLinks";
import { characterRevealAttrs } from "@/lib/characterReveal";
import { readPublicProfileFacts } from "@/lib/publicProfileFacts";
import { getCharacterRepresentativePublicUrls } from "@/lib/characterAssets";
import { characterHueAccent } from "@/lib/characterHueAccent";
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

/**
 * `default` is the shared card (search, ranking, creator, studio).
 * The other variants are home-only presentations of the same data and links.
 */
export type CardVariant = "default" | "editorial" | "exhibit" | "index";
type HomeCardVariant = Exclude<CardVariant, "default">;

type CardView = {
  tags: string[];
  hidden: boolean;
  urls: string[];
  thumb: string | undefined;
  href: string;
  displayTagline: string | undefined;
  overlayLabel: string;
  creatorName: string;
  creatorHref: string | null;
  creatorStyle: CreatorNameBadgeStyle;
  genreLabel: string;
};

function cardView(c: CharacterRow, blurNsfw: boolean, loggedIn: boolean): CardView {
  const hidden = c.nsfw === 1 && blurNsfw;
  const urls = getCharacterRepresentativePublicUrls(c.assets, c.images);
  return {
    tags: parseCardTags(c.tags),
    hidden,
    urls,
    thumb: urls[0],
    href: characterCardHref({ characterId: c.id, nsfw: c.nsfw === 1, blurNsfw, loggedIn }),
    displayTagline: hidden
      ? loggedIn
        ? "성인인증 후 확인할 수 있습니다."
        : "로그인 후 성인인증이 필요합니다."
      : c.tagline?.trim(),
    overlayLabel: loggedIn ? "성인인증 필요" : "로그인 · 성인인증 필요",
    creatorName: c.creator_name?.trim() || "",
    creatorHref: c.creator_id != null && Number(c.creator_id) > 0 ? `/creator/${c.creator_id}` : null,
    creatorStyle: c.creator_site_managed
      ? {
          byClassName: "text-violet-500/80",
          nameClassName: "font-semibold text-violet-200",
          label: "공식",
        }
      : creatorNameBadgeStyle(c.creator_tier_level),
    genreLabel: c.genre?.trim() || "",
  };
}

function revealAttrs(c: CharacterRow, view: CardView): Record<string, string> {
  return characterRevealAttrs({
    id: c.id,
    name: c.name,
    genre: view.genreLabel,
    tagline: c.tagline,
    tags: view.tags,
    facts: readPublicProfileFacts(c.id),
    href: view.href,
    hidden: view.hidden,
    hasThumb: Boolean(view.thumb),
  });
}

function CardBadges({ c }: { c: CharacterRow }) {
  return (
    <>
      {c.nsfw === 1 && <AdultContentBadge className="absolute right-2.5 top-2.5 z-[4] shadow-sm" />}
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
    </>
  );
}

function CreatorLine({ view, className }: { view: CardView; className?: string }) {
  if (!view.creatorName) return null;
  const { creatorStyle } = view;
  const inner = (
    <>
      {creatorStyle.medal && (
        <span className="mr-0.5" title={creatorStyle.label} aria-label={creatorStyle.label}>
          {creatorStyle.medal}
        </span>
      )}
      <span className={creatorStyle.byClassName}>by</span> {view.creatorName}
    </>
  );
  if (view.creatorHref) {
    return (
      <Link
        href={view.creatorHref}
        className={cn("line-clamp-1 text-[10px] transition hover:text-violet-200", creatorStyle.nameClassName, className)}
        title={`${view.creatorName} 프로필`}
      >
        {inner}
      </Link>
    );
  }
  return <p className={cn("line-clamp-1 text-[10px]", creatorStyle.nameClassName, className)}>{inner}</p>;
}

function CardTags({ tags, max, className, tagClassName }: { tags: string[]; max: number; className: string; tagClassName: string }) {
  if (tags.length === 0) return null;
  return (
    <div className={className}>
      {tags.slice(0, max).map((t) => (
        <Link key={t} href={`/search?q=${encodeURIComponent(t)}`} className={tagClassName}>
          #{t}
        </Link>
      ))}
    </div>
  );
}

function cardBackdrop(hue: number): CSSProperties {
  return { background: `linear-gradient(135deg, hsl(${hue} 50% 18%), hsl(${(hue + 40) % 360} 45% 10%))` };
}

const HOME_FRAME_RATIO: Record<HomeCardVariant, string> = {
  editorial: "aspect-[2/3]",
  exhibit: "aspect-[4/5]",
  index: "aspect-[3/4]",
};

type Props = {
  c: CharacterRow;
  blurNsfw: boolean;
  loggedIn?: boolean;
  /** Home presentations. Other routes keep the default card. */
  variant?: CardVariant;
  /** 1-based position, used by the home `exhibit` and `index` variants. */
  order?: number;
};

function HomeCard({
  c,
  view,
  variant,
  order,
}: {
  c: CharacterRow;
  view: CardView;
  variant: HomeCardVariant;
  order?: number;
}) {
  const accent = characterHueAccent(c.hue);
  const accentStyle = {
    "--card-keyline": accent.keyline,
    "--card-hover": accent.hover,
  } as CSSProperties;
  const orderLabel = order != null ? String(order).padStart(2, "0") : null;

  const media = (
    <div className="home-card-media">
      {view.thumb ? (
        <CharacterCardCarousel urls={view.urls} alt={c.name} hidden={view.hidden} />
      ) : (
        <span
          className={`flex h-full w-full items-center justify-center text-5xl sm:text-6xl ${view.hidden ? "blur-md" : ""}`}
        >
          {c.emoji}
        </span>
      )}
    </div>
  );

  const frame = (
    <div
      className={cn(
        "home-card-frame w-full",
        HOME_FRAME_RATIO[variant],
        variant === "exhibit" && "[clip-path:polygon(0_0,calc(100%-1.75rem)_0,100%_1.75rem,100%_100%,0_100%)]",
      )}
      style={cardBackdrop(c.hue)}
    >
      {media}
      <span aria-hidden className="home-card-sweep" />
      <CardBadges c={c} />
      {view.hidden && (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/55 px-2 text-center text-[11px] font-semibold text-white sm:text-xs">
          {view.overlayLabel}
        </div>
      )}
      {variant === "editorial" ? (
        <div className="home-card-cap pointer-events-none absolute inset-x-0 bottom-0 z-[4] bg-gradient-to-t from-black/95 via-black/55 to-transparent px-3 pb-3.5 pt-14">
          {view.genreLabel ? (
            <p className="line-clamp-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: accent.hover }}>
              {view.genreLabel}
            </p>
          ) : null}
          <h3 className="home-card-name mt-1 line-clamp-2 w-fit text-[19px] font-extrabold leading-[1.15] tracking-[-0.035em] text-white [overflow-wrap:anywhere]">
            {c.name}
          </h3>
        </div>
      ) : null}
    </div>
  );

  return (
    <article
      className={cn("home-card group/card flex h-full flex-col", `home-card--${variant}`)}
      style={accentStyle}
      {...revealAttrs(c, view)}
    >
      <Link href={view.href} className="home-card-link relative block">
        {frame}
        {variant === "exhibit" && orderLabel ? (
          <span
            aria-hidden
            className="relative z-[5] -mt-9 ml-2 block text-[3.25rem] font-black leading-none tracking-[-0.08em] text-white [text-shadow:0_2px_18px_rgba(0,0,0,.7)]"
          >
            {orderLabel}
          </span>
        ) : null}
        {variant !== "editorial" ? (
          <div className={cn("flex items-baseline gap-2 px-0.5", variant === "exhibit" ? "mt-1" : "mt-2.5")}>
            {variant === "index" && orderLabel ? (
              <span aria-hidden className="shrink-0 text-[10px] font-black tracking-[0.12em] text-violet-300">
                N.{orderLabel}
              </span>
            ) : null}
            <h3
              className={cn(
                "home-card-name line-clamp-2 min-w-0 font-extrabold leading-[1.15] tracking-[-0.035em] text-white [overflow-wrap:anywhere]",
                variant === "exhibit" ? "text-[22px]" : "text-[16px]",
              )}
            >
              {c.name}
            </h3>
          </div>
        ) : null}
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 px-0.5 pt-2.5">
        {variant !== "editorial" && view.genreLabel ? (
          <p className="line-clamp-1 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">{view.genreLabel}</p>
        ) : null}
        <CreatorLine view={view} />
        <Link href={view.href} className="min-w-0">
          {view.displayTagline ? (
            <p
              className={cn(
                "text-[12px] leading-5 text-zinc-300",
                variant === "index" ? "line-clamp-1" : "line-clamp-2 min-h-[2.5rem]",
              )}
            >
              {view.displayTagline}
            </p>
          ) : (
            <p className="min-h-[2.5rem] text-xs leading-5 text-zinc-600">한 줄 소개 없음</p>
          )}
        </Link>
        {variant !== "index" ? (
          <CardTags
            tags={view.tags}
            max={variant === "exhibit" ? 4 : 3}
            className="mt-auto flex max-h-[1.75rem] flex-wrap gap-x-2.5 gap-y-1 overflow-hidden pt-1"
            tagClassName="text-[11px] font-medium text-zinc-500 transition hover:text-zinc-100"
          />
        ) : null}
      </div>
    </article>
  );
}

const DEFAULT_CHROME = {
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
} as const;

export default function CharacterCard({ c, blurNsfw, loggedIn = false, variant = "default", order }: Props) {
  const view = cardView(c, blurNsfw, loggedIn);
  if (variant !== "default") {
    return <HomeCard c={c} view={view} variant={variant} order={order} />;
  }

  const chrome = DEFAULT_CHROME;
  return (
    <article className={chrome.frame} {...revealAttrs(c, view)}>
      <Link href={view.href} className="relative block">
        <div className={`relative ${CHARACTER_THUMB_ASPECT} w-full overflow-hidden`} style={cardBackdrop(c.hue)}>
          {view.thumb ? (
            <div className={chrome.media}>
              <CharacterCardCarousel urls={view.urls} alt={c.name} hidden={view.hidden} />
            </div>
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center text-5xl sm:text-6xl ${view.hidden ? "blur-md" : ""}`}
            >
              {c.emoji}
            </span>
          )}

          <span className={chrome.keyline} />
          <CardBadges c={c} />
          {view.hidden && <div className={chrome.overlay}>{view.overlayLabel}</div>}
        </div>
      </Link>

      <div className="flex min-h-[10.5rem] flex-1 flex-col gap-1.5 p-3.5">
        <Link href={view.href} className="min-w-0">
          <h3 className={chrome.name}>{c.name}</h3>
        </Link>
        <CreatorLine view={view} />
        <Link href={view.href} className="min-w-0">
          {view.displayTagline ? (
            <p className={cn(studioType.caption, "line-clamp-3 min-h-[3.75rem] text-[12px] leading-5 text-zinc-300")}>
              {view.displayTagline}
            </p>
          ) : (
            <p className="min-h-[3.75rem] text-xs leading-5 text-zinc-600">한 줄 소개 없음</p>
          )}
        </Link>
        <CardTags
          tags={view.tags}
          max={4}
          className="mt-auto flex max-h-[3.15rem] flex-wrap gap-1.5 overflow-hidden pt-1"
          tagClassName={chrome.tag}
        />
      </div>
    </article>
  );
}
