import Link from "next/link";

import { characterCardHref } from "@/lib/chatLinks";

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
  likes: number;
  /** 누적 대화 턴 (전체 유저 합) */
  total_turns: number;
  /** 이용 유저 수 (DISTINCT user_id) */
  chats_count: number;
  created_at: string;
  audience?: string;
  images?: string;
};

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

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#131626]">
      <Link href={href} className="flex flex-col">
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
            <div className="flex items-center justify-between gap-1 text-[10px] font-semibold tabular-nums text-white/90">
              <span title="좋아요">❤️ {fmt(c.likes)}</span>
              <span title="누적 대화 턴">💬 {fmt(c.total_turns ?? 0)}</span>
              {(c.chats_count ?? 0) > 0 ? (
                <span title="이용 유저 수">👥 {fmt(c.chats_count)}</span>
              ) : (
                <span className="invisible">—</span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1 p-2.5 sm:space-y-1.5 sm:p-3">
          <h3 className="line-clamp-1 text-sm font-bold text-white group-hover:text-violet-300">
            {c.name}
          </h3>
          {displayTagline ? (
            <p className="line-clamp-2 min-h-[2.4rem] text-xs leading-relaxed text-zinc-400">
              {displayTagline}
            </p>
          ) : (
            <p className="min-h-[2.4rem] text-xs text-zinc-600">한 줄 소개 없음</p>
          )}
        </div>
      </Link>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-2.5 pt-0 sm:px-3 sm:pb-3">
          {tags.slice(0, 3).map((t) => (
            <Link
              key={t}
              href={`/search?q=${encodeURIComponent(t)}`}
              className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-zinc-400 transition hover:bg-violet-600/20 hover:text-violet-200"
            >
              #{t}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}
