import Link from "next/link";

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
};


type CreatorNameBadgeStyle = {
  byClassName: string;
  nameClassName: string;
  medal?: string;
  label?: string;
};

function creatorNameBadgeStyle(tier: CreatorTierLevel | null | undefined): CreatorNameBadgeStyle {
  switch (tier) {
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
  const thumb: string | undefined = (JSON.parse(c.images || "[]") as string[])[0];
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
        "group flex flex-col overflow-hidden transition hover:border-white/20",
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
              className={`h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.02] ${hidden ? "blur-md" : ""}`}
            />
          ) : (
            <span
              className={`flex h-full w-full items-center justify-center text-5xl sm:text-6xl ${hidden ? "blur-md" : ""}`}
            >
              {c.emoji}
            </span>
          )}

          {c.nsfw === 1 && (
            <span className="absolute right-2 top-2 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
              19+
            </span>
          )}
          {c.official === 1 && (
            <span className="absolute left-2 top-2 rounded-md bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white shadow-sm">
              공식
            </span>
          )}

          {hidden && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 px-2 text-center text-[11px] font-semibold text-white sm:text-xs">
              {overlayLabel}
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2 pb-2 pt-6">
            <div className="flex items-center justify-center gap-3 text-[10px] font-semibold tabular-nums text-white/90">
              <span title="누적 대화 턴">💬 {fmt(c.total_turns ?? 0)}</span>
              {(c.chats_count ?? 0) > 0 ? (
                <span title="이용 유저 수">👥 {fmt(c.chats_count)}</span>
              ) : null}
            </div>
          </div>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <Link href={href} className="min-w-0">
          <h3 className="line-clamp-1 text-sm font-semibold text-zinc-50 transition group-hover:text-violet-300">
            {c.name}
          </h3>
        </Link>

        {creatorName ? (
          creatorHref ? (
            <Link
              href={creatorHref}
              className={cn("line-clamp-1 text-[11px] transition hover:text-violet-200", creatorStyle.nameClassName)}
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
            <p className={cn("line-clamp-1 text-[11px]", creatorStyle.nameClassName)}>
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
            <p className={cn(studioType.caption, "line-clamp-2 min-h-[2.4rem]")}>
              {displayTagline}
            </p>
          ) : (
            <p className="min-h-[2.4rem] text-xs text-zinc-600">한 줄 소개 없음</p>
          )}
        </Link>

        {tags.length > 0 && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-0.5">
            {tags.slice(0, 3).map((t) => (
              <Link
                key={t}
                href={`/search?q=${encodeURIComponent(t)}`}
                className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition hover:bg-violet-600/15 hover:text-violet-200"
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
