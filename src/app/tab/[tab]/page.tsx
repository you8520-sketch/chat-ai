import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import UserPreferenceControls from "@/components/UserPreferenceControls";
import StudioButton from "@/components/studio/StudioButton";
import { CHARACTER_GENRES, genreFilterSql, type CharacterGenre } from "@/lib/characterGenres";
import { listableWhere } from "@/lib/characterVisibility";
import { buildHomeListFilter, fetchNewestCharacters } from "@/lib/homeSections";
import {
  fetchCharacterRanking,
  parseRankingPeriod,
  rankingEmptyMessage,
  type RankedCharacter,
} from "@/lib/characterRanking";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import { canAccessAdultContent, shouldHideAdultListings } from "@/lib/adultVerification";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";
import { RankingList, RankingPeriodNav } from "./RankingView";

export const dynamic = "force-dynamic";

/** 홈 '신규 캐릭터'(25)의 '더보기'이므로 홈보다 넓게 보여준다. */
const NEW_TAB_LIMIT = 50;

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
  const blurNsfw = shouldHideAdultListings(user);
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
  let bookmarkedChars: CharacterRow[] = [];
  let followingCreatorChars: CharacterRow[] = [];
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
      chars = fetchNewestCharacters(db, buildHomeListFilter(user, blurNsfw), NEW_TAB_LIMIT);
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
        const genreClause = genreFilterSql(g as CharacterGenre);
        chars = db
          .prepare(
            `SELECT * FROM characters WHERE ${genreClause.sql} AND ${listableWhere()} ${filter} ORDER BY likes DESC`,
          )
          .all(...genreClause.params, ...fparams) as CharacterRow[];
      } else {
        chars = db
          .prepare(
            `SELECT * FROM characters WHERE ${listableWhere()} ${filter} ORDER BY genre, likes DESC`,
          )
          .all(...fparams) as CharacterRow[];
      }
      break;
    case "following":
      title = "북마크/팔로잉";
      if (!user) {
        return (
          <Empty
            title="북마크/팔로잉"
            message="로그인 후 캐릭터를 북마크하거나 크리에이터를 팔로우하면 여기에 표시됩니다."
            cta="/login"
            ctaLabel="로그인"
          />
        );
      }
      bookmarkedChars = db
        .prepare(
          `SELECT c.* FROM characters c
           JOIN likes l ON l.character_id = c.id
           WHERE l.user_id = ? AND c.visibility='public' AND c.moderation_status='approved'
           ORDER BY c.created_at DESC`,
        )
        .all(user.id) as CharacterRow[];
      {
        const bookmarkedIds = new Set(bookmarkedChars.map((c) => c.id));
        followingCreatorChars = (
          db
            .prepare(
              `SELECT c.* FROM characters c
               JOIN follows f ON f.creator_id = c.creator_id
               WHERE f.user_id = ? AND c.creator_id IS NOT NULL AND c.visibility='public' AND c.moderation_status='approved'
               ORDER BY c.created_at DESC`,
            )
            .all(user.id) as CharacterRow[]
        ).filter((c) => !bookmarkedIds.has(c.id));
      }
      break;
    case "likes":
      title = "북마크한 캐릭터";
      if (!user) {
        return (
          <Empty
            title="북마크"
            message="로그인 후 북마크한 캐릭터가 여기에 표시됩니다."
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

  // `new` comes from fetchNewestCharacters, which already decorates creator tiers.
  if (tab !== "new") chars = decorateCharactersWithCreatorTiers(db, chars);
  bookmarkedChars = decorateCharactersWithCreatorTiers(db, bookmarkedChars);
  followingCreatorChars = decorateCharactersWithCreatorTiers(db, followingCreatorChars);

  return (
    <div className="mt-2 pb-2">
      <h1 className={studioType.heading}>{title}</h1>
      {tab === "ranking" && (
        <>
          <RankingPeriodNav period={rankingPeriod} />
          <div className="mt-5 border-t border-white/10 pt-4">
            <UserPreferenceControls
              isAdult={!!user?.is_adult}
              canDisableSafetyFilter={canAccessAdultContent(user)}
              nsfwOn={!!user?.nsfw_on}
              pref={(user?.pref as "female" | "male" | null) ?? null}
              loggedIn={loggedIn}
              variant="homeRow"
            />
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
          <RankingList ranked={rankedChars} period={rankingPeriod} blurNsfw={blurNsfw} loggedIn={loggedIn} />
        ) : (
          <EmptyPanel
            className="mt-6"
            message={rankingEmptyMessage(rankingPeriod)}
            cta={rankingPeriod === "all" ? "/" : "/tab/ranking?p=all"}
            ctaLabel={rankingPeriod === "all" ? "홈으로" : "전체 랭킹 보기"}
          />
        )
      ) : tab === "following" ? (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className={studioType.sectionTitle}>북마크한 캐릭터</h2>
            {bookmarkedChars.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {bookmarkedChars.map((c) => (
                  <CharacterCard key={`bm-${c.id}`} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
                ))}
              </div>
            ) : (
              <p className={cn(studioType.helper, "mt-3")}>
                아직 북마크한 캐릭터가 없습니다. 캐릭터 페이지에서 🔖 북마크를 눌러 주세요.
              </p>
            )}
          </section>
          <section>
            <h2 className={studioType.sectionTitle}>팔로우한 크리에이터</h2>
            {followingCreatorChars.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {followingCreatorChars.map((c) => (
                  <CharacterCard key={`fl-${c.id}`} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
                ))}
              </div>
            ) : (
              <p className={cn(studioType.helper, "mt-3")}>
                팔로우한 크리에이터의 공개 캐릭터가 없습니다.
              </p>
            )}
          </section>
        </div>
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
      <EmptyPanel className="mt-8" message={message} cta={cta} ctaLabel={ctaLabel} />
    </div>
  );
}

function EmptyPanel({
  message,
  cta,
  ctaLabel,
  className,
}: {
  message: string;
  cta: string;
  ctaLabel: string;
  className?: string;
}) {
  return (
    <div className={cn(studioSurface.cardDashed, "p-10 text-center", className)}>
      <p className={cn(studioType.body, "break-keep")}>{message}</p>
      <StudioButton href={cta} className="mt-5">
        {ctaLabel}
      </StudioButton>
    </div>
  );
}
