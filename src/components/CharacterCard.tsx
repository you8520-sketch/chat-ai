import Link from "next/link";
import type { CSSProperties } from "react";

import AdultContentBadge from "@/components/AdultContentBadge";
import CardTagScrollRow from "@/components/CardTagScrollRow";
import CharacterCardCarousel from "@/components/CharacterCardCarousel";
import { characterCardHref } from "@/lib/chatLinks";
import { characterRevealAttrs } from "@/lib/characterReveal";
import { readPublicDossier } from "@/lib/characterPublicDossier";
import { getCharacterRepresentativePublicUrls } from "@/lib/characterAssets";
import { characterHueAccent } from "@/lib/characterHueAccent";
import type { CreatorTierLevel } from "@/lib/creatorShared";
import { cn } from "@/lib/studioDesign";

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
  gender?: string | null;
  gender_public?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  world_public_name?: string | null;
  world_public?: number | null;
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
        byClassName: "text-emerald-500",
        nameClassName: "font-medium text-emerald-400/90",
        label: "새싹 크리에이터",
      };
    case "standard":
      return {
        byClassName: "text-zinc-400",
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
        byClassName: "text-zinc-400/80",
        nameClassName: "font-medium text-zinc-400",
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
          byClassName: "text-violet-400/90",
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
    href: view.href,
    hidden: view.hidden,
    hasThumb: Boolean(view.thumb),
    dossier: readPublicDossier(c),
  });
}

const HOME_OFFICIAL_BADGE =
  "rounded-md border border-white/10 bg-violet-600/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-sm backdrop-blur";
const HOME_SIMULATION_BADGE =
  "rounded-md border border-white/10 bg-cyan-700/90 px-1.5 py-1 text-[9px] font-bold leading-none text-white shadow-sm backdrop-blur";
const HOME_BADGE_GROUP = "absolute left-2.5 top-2.5 z-[4] flex flex-wrap gap-1";

type BadgeChrome = { official: string; simulation: string; group: string; groupWithAdult?: string; adult?: string };

const HOME_BADGES: BadgeChrome = {
  official: HOME_OFFICIAL_BADGE,
  simulation: HOME_SIMULATION_BADGE,
  group: HOME_BADGE_GROUP,
};

function CardBadges({ c, chrome = HOME_BADGES }: { c: CharacterRow; chrome?: BadgeChrome }) {
  return (
    <>
      {c.nsfw === 1 && <AdultContentBadge className={cn("absolute right-2.5 top-2.5 z-[4] shadow-sm", chrome.adult)} />}
      <div className={cn(chrome.group, c.nsfw === 1 && chrome.groupWithAdult)}>
        {c.official === 1 && <span className={chrome.official}>공식</span>}
        {c.content_kind === "simulation" && <span className={chrome.simulation}>다인 시뮬</span>}
      </div>
    </>
  );
}

function CreatorLine({
  view,
  className,
  byClassName,
  linkClassName = "line-clamp-1 text-[11px]",
}: {
  view: CardView;
  className?: string;
  byClassName?: string;
  linkClassName?: string;
}) {
  if (!view.creatorName) return null;
  const { creatorStyle } = view;
  const inner = (
    <>
      {creatorStyle.medal && (
        <span className="mr-0.5" title={creatorStyle.label} aria-label={creatorStyle.label}>
          {creatorStyle.medal}
        </span>
      )}
      <span className={byClassName ?? creatorStyle.byClassName}>by</span> {view.creatorName}
    </>
  );
  if (view.creatorHref) {
    return (
      <Link
        href={view.creatorHref}
        className={cn(linkClassName, "transition hover:text-violet-200", creatorStyle.nameClassName, className)}
        title={`${view.creatorName} 프로필`}
      >
        {inner}
      </Link>
    );
  }
  return <p className={cn(linkClassName, creatorStyle.nameClassName, className)}>{inner}</p>;
}

function CardTags({
  tags,
  max,
  className,
  tagClassName,
  scrollRow = false,
}: {
  tags: string[];
  max: number;
  className: string;
  tagClassName: string;
  scrollRow?: boolean;
}) {
  if (tags.length === 0) return null;
  const links = tags.slice(0, max).map((t) => (
    <Link key={t} href={`/search?q=${encodeURIComponent(t)}`} className={tagClassName}>
      #{t}
    </Link>
  ));
  return scrollRow ? <CardTagScrollRow className={className}>{links}</CardTagScrollRow> : <div className={className}>{links}</div>;
}

function CardEmoji({ emoji, hidden }: { emoji: string; hidden: boolean }) {
  return (
    <span className={`flex h-full w-full items-center justify-center text-5xl sm:text-6xl ${hidden ? "blur-md" : ""}`}>
      {emoji}
    </span>
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
        <CharacterCardCarousel
          urls={view.urls}
          alt={c.name}
          hidden={view.hidden}
          fallback={<CardEmoji emoji={c.emoji} hidden={view.hidden} />}
        />
      ) : (
        <CardEmoji emoji={c.emoji} hidden={view.hidden} />
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
          <h3 className="home-card-name mt-1 line-clamp-2 w-fit break-keep text-[19px] font-extrabold leading-[1.15] tracking-[-0.035em] text-white [overflow-wrap:anywhere]">
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
                "home-card-name line-clamp-2 min-w-0 break-keep font-extrabold leading-[1.15] tracking-[-0.035em] text-white [overflow-wrap:anywhere]",
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
          <p className="line-clamp-1 text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-400">{view.genreLabel}</p>
        ) : null}
        <CreatorLine view={view} />
        <Link href={view.href} className="min-w-0">
          {view.displayTagline ? (
            <p
              className={cn(
                "break-keep text-[12px] leading-5 text-zinc-300",
                variant === "index" ? "line-clamp-1" : "line-clamp-2 min-h-[2.5rem]",
              )}
            >
              {view.displayTagline}
            </p>
          ) : (
            <p className="min-h-[2.5rem] text-xs leading-5 text-zinc-400">한 줄 소개 없음</p>
          )}
        </Link>
        {variant !== "index" ? (
          <CardTags
            tags={view.tags}
            max={variant === "exhibit" ? 4 : 3}
            className="mt-auto flex max-h-[1.75rem] flex-wrap gap-x-2.5 gap-y-1 overflow-hidden pt-1"
            tagClassName="text-[11px] font-medium text-zinc-400 transition hover:text-zinc-100"
          />
        ) : null}
      </div>
    </article>
  );
}

const FOCUS = "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300/80";

const DEFAULT_CHROME = {
  frame:
    "group/card relative flex h-full flex-col overflow-hidden rounded-[1.15rem] border border-indigo-200/[0.09] bg-[#0f1124] shadow-[inset_0_1px_0_rgba(255,255,255,.06),0_18px_44px_-20px_rgba(6,4,28,.95)] transition duration-300 hover:-translate-y-1 hover:border-violet-300/30 hover:shadow-[inset_0_1px_0_rgba(255,255,255,.08),0_26px_56px_-22px_rgba(139,92,246,.42)] focus-within:border-violet-300/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  media: "h-full w-full transition duration-500 group-hover/card:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover/card:scale-100",
  fade: "pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[34%] bg-gradient-to-t from-[#0f1124] via-[#0f1124]/45 to-transparent",
  keyline: "pointer-events-none absolute inset-0 z-[2] rounded-t-[1.15rem] border-x border-t border-white/[0.08]",
  overlay:
    "absolute inset-0 z-[3] flex items-center justify-center bg-[#07081a]/65 px-2 text-center text-[11px] font-semibold text-white sm:text-xs",
  badges: {
    official:
      "rounded-md border border-violet-200/25 bg-[#241a52]/85 px-2 py-[3px] text-[10.5px] font-bold leading-none text-violet-100 shadow-sm backdrop-blur",
    simulation:
      "rounded-md border border-white/10 bg-cyan-700/90 px-2 py-[3px] text-[10.5px] font-bold leading-none text-white shadow-sm backdrop-blur",
    group: HOME_BADGE_GROUP,
    groupWithAdult: "max-w-[calc(100%-5rem)]",
  } satisfies BadgeChrome,
  // Links own their vertical padding (no flex gap) so the 24px+ targets touch instead of overlapping.
  body: "relative z-[2] -mt-7 flex min-h-[9.5rem] flex-1 flex-col px-3.5 pb-3.5",
  eyebrow: "line-clamp-1 pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-200/80",
  nameLink: "block min-w-0 py-1",
  name: "line-clamp-2 break-keep text-[17px] font-bold leading-[1.22] tracking-[-0.03em] text-white transition group-hover/card:text-violet-100 [overflow-wrap:anywhere]",
  creatorLink: "block truncate py-1 text-[12.5px] leading-4",
  creatorBy: "text-zinc-400",
  taglineLink: "block min-w-0 py-1",
  tagline: "line-clamp-2 min-h-[2.4rem] text-[13px] leading-[1.45] text-zinc-300/90 [overflow-wrap:anywhere]",
  emptyTagline: "min-h-[2.4rem] text-[13px] leading-[1.45] text-zinc-400",
  // One swipeable row: every tag stays reachable and focusable, and the card height does not depend on tag count.
  tagsWrap:
    "scrollbar-hide -mx-3.5 mt-auto flex flex-nowrap gap-1.5 overflow-x-auto overscroll-x-contain scroll-px-3.5 px-3.5 pt-2 [mask-image:linear-gradient(to_right,#000_calc(100%-14px),transparent)]",
  tag: "block h-6 max-w-[11rem] shrink-0 truncate rounded-full bg-white/[0.05] px-2.5 text-[12px] font-medium leading-6 text-zinc-300 outline-none ring-1 ring-inset ring-white/10 transition hover:bg-violet-400/20 hover:text-white hover:ring-violet-300/30 focus-visible:ring-2 focus-visible:ring-violet-300/80",
} as const;

function DefaultCard({ c, view }: { c: CharacterRow; view: CardView }) {
  const chrome = DEFAULT_CHROME;
  return (
    <article className={chrome.frame} {...revealAttrs(c, view)}>
      <Link href={view.href} className={cn("relative block", FOCUS)}>
        <div className={cn("relative w-full overflow-hidden", CHARACTER_THUMB_ASPECT)} style={cardBackdrop(c.hue)}>
          {view.thumb ? (
            <div className={chrome.media}>
              <CharacterCardCarousel
                urls={view.urls}
                alt={c.name}
                hidden={view.hidden}
                fallback={<CardEmoji emoji={c.emoji} hidden={view.hidden} />}
              />
            </div>
          ) : (
            <CardEmoji emoji={c.emoji} hidden={view.hidden} />
          )}
          <span aria-hidden className={chrome.fade} />
          <span aria-hidden className={chrome.keyline} />
          <CardBadges c={c} chrome={chrome.badges} />
          {view.hidden && <div className={chrome.overlay}>{view.overlayLabel}</div>}
        </div>
      </Link>

      <div className={chrome.body}>
        {view.genreLabel ? <p className={chrome.eyebrow}>{view.genreLabel}</p> : null}
        <Link href={view.href} className={cn(chrome.nameLink, FOCUS)}>
          <h3 className={chrome.name}>{c.name}</h3>
        </Link>
        <CreatorLine
          view={view}
          byClassName={chrome.creatorBy}
          linkClassName={cn(chrome.creatorLink, view.creatorHref && FOCUS)}
        />
        <Link href={view.href} className={cn(chrome.taglineLink, FOCUS)}>
          {view.displayTagline ? (
            <p className={chrome.tagline}>{view.displayTagline}</p>
          ) : (
            <p className={chrome.emptyTagline}>한 줄 소개 없음</p>
          )}
        </Link>
        <CardTags tags={view.tags} max={4} className={chrome.tagsWrap} tagClassName={chrome.tag} scrollRow />
      </div>
    </article>
  );
}

export default function CharacterCard({ c, blurNsfw, loggedIn = false, variant = "default", order }: Props) {
  const view = cardView(c, blurNsfw, loggedIn);
  if (variant !== "default") {
    return <HomeCard c={c} view={view} variant={variant} order={order} />;
  }
  return <DefaultCard c={c} view={view} />;
}
