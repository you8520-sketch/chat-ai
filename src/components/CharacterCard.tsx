import Link from "next/link";

import AdultContentBadge from "@/components/AdultContentBadge";
import { characterCardHref } from "@/lib/chatLinks";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import type { CreatorTierLevel } from "@/lib/creatorShared";

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
  likes: number;
  /** 누적 대화 턴 (전체 유저 합) */
  total_turns: number;
  /** 이용 유저 수 (DISTINCT user_id) */
  chats_count: number;
  created_at: string;
  audience?: string;
  images?: string;
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
    case "plus":
      return {
        byClassName: "text-violet-500/80",
        nameClassName: "font-bold text-violet-300 drop-shadow-[0_0_6px_rgba(167,139,250,0.35)]",
      };
    case "pro":
      return {
        byClassName: "text-slate-400",
        nameClassName: "font-extrabold text-slate-100 drop-shadow-[0_0_7px_rgba(226,232,240,0.42)]",
        medal: "🥈",
        label: "프로 크리에이터",
      };
    case "partner":
    case "exclusive":
      return {
        byClassName: "text-amber-500/80",
        nameClassName: "font-black text-amber-200 drop-shadow-[0_0_9px_rgba(251,191,36,0.55)]",
        medal: tier === "exclusive" ? "🏆" : "🥇",
        label: tier === "exclusive" ? "전속 크리에이터" : "파트너 크리에이터",
      };
    default:
      return {
        byClassName: "text-zinc-600",
        nameClassName: "font-medium text-zinc-500",
      };
  }
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K` : String(n);
}

function ChatMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m7-2a8 8 0 0 1-8 8 8.7 8.7 0 0 1-3.5-.74L4 20l.9-3.62A8 8 0 1 1 20 12Z" />
    </svg>
  );
}

function UserMetricIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20m5.75-8.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Zm7.5.5a2.75 2.75 0 0 0 0-5.5m2.75 13v-1.25a3 3 0 0 0-2.5-2.96" />
    </svg>
  );
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

type Props = {
  c: CharacterRow;
  blurNsfw: boolean;
  loggedIn?: boolean;
};

export default function CharacterCard({ c, blurNsfw, loggedIn = false }: Props) {
  const tags = parseCardTags(c.tags);
  const hidden = c.nsfw === 1 && blurNsfw;
  let thumb: string | undefined;
  try {
    const parsed = JSON.parse(c.images || "[]") as unknown;
    thumb = Array.isArray(parsed) && typeof parsed[0] === "string" ? parsed[0] : undefined;
  } catch {
    thumb = undefined;
  }
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
  const creatorStyle = creatorNameBadgeStyle(c.creator_tier_level);

  return (
    <article
      className={cn(
        studioSurface.card,
        "group/card flex h-full flex-col overflow-hidden rounded-2xl bg-[#11141f] shadow-[0_18px_50px_rgba(0,0,0,.18)] transition duration-300 hover:-translate-y-1.5 hover:border-violet-400/40 hover:shadow-[0_22px_60px_rgba(0,0,0,.34)]",
      )}
    >
      <Link href={href} className="relative block">
        <div
          className={`relative ${CHARACTER_THUMB_ASPECT} w-full overflow-hidden`}
          style={{
            background: `linear-gradient(135deg, hsl(${c.hue} 50% 18%), hsl(${(c.hue + 40) % 360} 45% 10%))`,
          }}
        >
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumb}
              alt={c.name}
              className={`h-full w-full object-cover object-top transition duration-500 group-hover/card:scale-[1.045] ${hidden ? "blur-md" : ""}`}
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center text-5xl sm:text-6xl ${hidden ? "blur-md" : ""}`}
            >
              {c.emoji}
            </span>
          )}

          <span className="pointer-events-none absolute inset-2.5 z-[2] rounded-[0.55rem] border border-white/15 transition duration-300 group-hover/card:border-violet-200/30" />

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

          {hidden && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-2 text-center text-[11px] font-semibold text-white sm:text-xs">
              {overlayLabel}
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-2.5 pt-10">
            <div className="flex items-center justify-end gap-3 text-[10px] font-semibold tabular-nums text-white/90">
              <span className="flex items-center gap-1" title="누적 대화 턴" aria-label={`누적 대화 ${fmt(c.total_turns ?? 0)}`}>
                <ChatMetricIcon />
                {fmt(c.total_turns ?? 0)}
              </span>
              {(c.chats_count ?? 0) > 0 ? (
                <span className="flex items-center gap-1" title="이용 유저 수" aria-label={`이용자 ${fmt(c.chats_count)}`}>
                  <UserMetricIcon />
                  {fmt(c.chats_count)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </Link>

      <div className="flex min-h-[10.5rem] flex-1 flex-col gap-1.5 p-3.5">
        <Link href={href} className="min-w-0">
          <h3 className="line-clamp-1 text-[15px] font-semibold tracking-[-0.02em] text-zinc-50 transition group-hover/card:text-violet-200">
            {c.name}
          </h3>
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
                className="rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:border-violet-400/20 hover:bg-violet-600/15 hover:text-violet-200"
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
