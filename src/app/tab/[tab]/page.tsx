import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import CharacterCard, { type CharacterRow, CHARACTER_THUMB_ASPECT } from "@/components/CharacterCard";
import StudioButton from "@/components/studio/StudioButton";
import { CHARACTER_GENRES, genreJsonLikePattern, type CharacterGenre } from "@/lib/characterGenres";
import { listableWhere } from "@/lib/characterVisibility";
import { characterCardHref } from "@/lib/chatLinks";
import {
  fetchCharacterRanking,
  parseRankingPeriod,
  RANKING_PERIODS,
  rankingPeriodDesc,
  rankingPeriodLabel,
  type RankedCharacter,
} from "@/lib/characterRanking";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

const GENRE_TABS = ["전체", ...CHARACTER_GENRES] as const;

function ChipLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-10 items-center rounded-xl px-3.5 text-sm font-semibold transition",
        active
          ? "bg-violet-600 text-white"
          : "border border-white/10 bg-[#161922] text-zinc-400 hover:border-white/20 hover:text-zinc-200",
      )}
    >
      {children}
    </Link>
  );
}

export default async function TabPage({
  params,
  searchParams,
}: {
  params: Promise<{ tab: string }>;
  searchParams: Promise<{ g?: string; p?: string }>;
}) {
  const { tab } = await params;
  const { g, p } = await searchParams;
  const db = getDb();
  const user = await getSessionUser();
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
  const loggedIn = !!user;

  const buildFilter = (colPrefix = "") => {
    const conds: string[] = [];
    const params: string[] = [];
    if (user?.pref === "female" || user?.pref === "male") {
      conds.push(`(${colPrefix}audience='all' OR ${colPrefix}audience=?)`);
      params.push(user.pref);
    }
    if (blurNsfw) conds.push(`${colPrefix}nsfw=0`);
    const filter = conds.length ? `AND ${conds.join(" AND ")}` : "";
    return { filter, params };
  };
  const { filter, params: fparams } = buildFilter();

  let title = "";
  let chars: CharacterRow[] = [];
  let rankedChars: RankedCharacter[] = [];
  const rankingPeriod = parseRankingPeriod(p);

  switch (tab) {
    case "official":
      title = "공식 캐릭터";
      chars = db
        .prepare(`SELECT * FROM characters WHERE official=1 ${filter} ORDER BY likes DESC`)
        .all(...fparams) as CharacterRow[];
      break;
    case "new":
      title = "실시간 신작";
      chars = db
        .prepare(
          `SELECT * FROM characters WHERE ${listableWhere("official=0")} ${filter} ORDER BY created_at DESC, id DESC LIMIT 50`,
        )
        .all(...fparams) as CharacterRow[];
      break;
    case "ranking":
      title = "랭킹";
      {
        const { filter: rankFilter, params: rankParams } = buildFilter("c.");
        rankedChars = fetchCharacterRanking(db, rankingPeriod, rankFilter, rankParams);
      }
      break;
    case "genre":
      title = "장르별 탐색";
      if (g && g !== "전체" && CHARACTER_GENRES.includes(g as CharacterGenre)) {
        const like = genreJsonLikePattern(g as CharacterGenre);
        chars = db
          .prepare(
            `SELECT * FROM characters WHERE (genre=? OR genres LIKE ?) AND ${listableWhere()} ${filter} ORDER BY likes DESC`,
          )
          .all(g, like, ...fparams) as CharacterRow[];
      } else {
        chars = db
          .prepare(
            `SELECT * FROM characters WHERE ${listableWhere()} ${filter} ORDER BY genre, likes DESC`,
          )
          .all(...fparams) as CharacterRow[];
      }
      break;
    case "following":
      title = "팔로잉";
      if (!user) {
        return (
          <Empty
            title="팔로잉"
            message="로그인 후 크리에이터를 팔로우하면 여기에 표시됩니다."
            cta="/login"
            ctaLabel="로그인"
          />
        );
      }
      chars = db
        .prepare(
          `SELECT c.* FROM characters c
           JOIN follows f ON f.creator_id = c.creator_id
           WHERE f.user_id = ? AND c.creator_id IS NOT NULL AND c.visibility='public' AND c.moderation_status='approved'
           ORDER BY c.created_at DESC`,
        )
        .all(user.id) as CharacterRow[];
      break;
    case "likes":
      title = "좋아요한 캐릭터";
      if (!user) {
        return (
          <Empty
            title="좋아요"
            message="로그인 후 좋아요한 캐릭터가 여기에 표시됩니다."
            cta="/login"
            ctaLabel="로그인"
          />
        );
      }
      chars = db
        .prepare(
          "SELECT c.* FROM characters c JOIN likes l ON l.character_id=c.id WHERE l.user_id=? ORDER BY c.likes DESC",
        )
        .all(user.id) as CharacterRow[];
      break;
    default:
      notFound();
  }

  return (
    <div className="mt-2 pb-2">
      <h1 className={studioType.heading}>{title}</h1>
      {tab === "ranking" && (
        <>
          <p className={cn(studioType.helper, "mt-2")}>{rankingPeriodDesc(rankingPeriod)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {RANKING_PERIODS.map((period) => (
              <ChipLink
                key={period.id}
                href={`/tab/ranking?p=${period.id}`}
                active={rankingPeriod === period.id}
              >
                {period.label}
              </ChipLink>
            ))}
          </div>
        </>
      )}
      {tab === "genre" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {GENRE_TABS.map((genre) => (
            <ChipLink
              key={genre}
              href={`/tab/genre?g=${encodeURIComponent(genre)}`}
              active={(g || "전체") === genre}
            >
              {genre}
            </ChipLink>
          ))}
        </div>
      )}
      {tab === "ranking" ? (
        rankedChars.length > 0 ? (
          <ol className="mt-6 space-y-2">
            {rankedChars.map((c, i) => {
              const thumb = (JSON.parse(c.images || "[]") as string[])[0];
              const hidden = c.nsfw === 1 && blurNsfw;
              const href = characterCardHref({
                characterId: c.id,
                nsfw: c.nsfw === 1,
                blurNsfw,
                loggedIn,
              });
              return (
                <li key={c.id}>
                  <Link
                    href={href}
                    className={cn(
                      studioSurface.card,
                      "flex items-center gap-4 p-3 transition hover:border-white/20",
                    )}
                  >
                    <span
                      className={cn(
                        "w-8 shrink-0 text-center text-lg font-semibold tabular-nums",
                        i < 3 ? "text-violet-300" : "text-zinc-500",
                      )}
                    >
                      {i + 1}
                    </span>
                    <div
                      className={`relative ${CHARACTER_THUMB_ASPECT} w-14 shrink-0 overflow-hidden rounded-lg`}
                      style={{ background: `hsl(${c.hue} 60% 20%)` }}
                    >
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={thumb}
                          alt=""
                          className={`h-full w-full object-cover object-top ${hidden ? "blur-md" : ""}`}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-2xl">
                          {c.emoji}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-zinc-50">
                        {c.name}
                        {c.nsfw === 1 && (
                          <span className="ml-2 rounded bg-rose-600 px-1 text-[10px] font-bold text-white">
                            19
                          </span>
                        )}
                      </p>
                      <p className={cn(studioType.caption, "truncate")}>
                        {hidden
                          ? loggedIn
                            ? "성인인증 후 확인할 수 있습니다."
                            : "로그인 후 성인인증이 필요합니다."
                          : c.tagline}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-zinc-400">
                      💬 {c.period_chats.toLocaleString()}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={cn(studioType.helper, "mt-10 text-center")}>
            {rankingPeriod === "all"
              ? "표시할 캐릭터가 없습니다."
              : `${rankingPeriodLabel(rankingPeriod)} 기간에 대화가 시작된 캐릭터가 없습니다.`}
          </p>
        )
      ) : chars.length > 0 ? (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {chars.map((c) => (
            <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
          ))}
        </div>
      ) : (
        <p className={cn(studioType.helper, "mt-10 text-center")}>표시할 캐릭터가 없습니다.</p>
      )}
    </div>
  );
}

function Empty({
  title,
  message,
  cta,
  ctaLabel,
}: {
  title: string;
  message: string;
  cta: string;
  ctaLabel: string;
}) {
  return (
    <div className="mt-2">
      <h1 className={studioType.heading}>{title}</h1>
      <div className={cn(studioSurface.cardDashed, "mt-8 p-10 text-center")}>
        <p className={studioType.body}>{message}</p>
        <StudioButton href={cta} className="mt-5">
          {ctaLabel}
        </StudioButton>
      </div>
    </div>
  );
}
