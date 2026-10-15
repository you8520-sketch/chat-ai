import { AppPageShell } from "@/components/AppPageShell";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import TagSearchBar from "@/components/TagSearchBar";
import ChipRail from "./ChipRail";
import {
  ActiveFilters,
  FilterLabel,
  GenreChip,
  SearchEmpty,
  SearchGuide,
  SearchResultsSummary,
  TagChip,
  searchHref,
} from "./SearchParts";
import { shouldHideAdultListings } from "@/lib/adultVerification";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listableWhere } from "@/lib/characterVisibility";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";
import {
  CHARACTER_GENRES,
  genreFilterSql,
  isCharacterGenre,
  type CharacterGenre,
} from "@/lib/characterGenres";
import {
  buildCharacterSearchSql,
  isValidSearchQuery,
  normalizeCatalogSearchQuery,
  SEARCH_RESULT_LIMIT,
  searchSqlLikePattern,
} from "@/lib/tagSearch";

export const dynamic = "force-dynamic";

function collectPopularTags(rows: { tags: string }[], limit = 16): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    try {
      const tags = JSON.parse(row.tags || "[]") as string[];
      for (const tag of tags) {
        const t = tag.trim();
        if (!t) continue;
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    } catch {
      /* ignore */
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))
    .slice(0, limit)
    .map(([tag]) => tag);
}

function matchKind(c: CharacterRow, query: string): "name" | "creator" | "tag" | null {
  const q = query.toLowerCase();
  if (c.name.toLowerCase().includes(q)) return "name";
  if (c.creator_name.toLowerCase().includes(q)) return "creator";
  try {
    const tags = JSON.parse(c.tags || "[]") as string[];
    if (tags.some((t) => t.toLowerCase().includes(q))) return "tag";
  } catch {
    /* ignore */
  }
  return null;
}

const MATCH_LABEL = {
  name: "캐릭터명",
  creator: "제작자",
  tag: "태그",
} as const;

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; g?: string }>;
}) {
  const { q: rawQ, g: rawG } = await searchParams;
  const query = normalizeCatalogSearchQuery(rawQ ?? "");
  const genre =
    rawG && isCharacterGenre(rawG.trim()) ? (rawG.trim() as CharacterGenre) : null;
  const db = getDb();
  const user = await getSessionUser();
  const blurNsfw = shouldHideAdultListings(user);
  const loggedIn = !!user;

  const audiencePref =
    user?.pref === "female" || user?.pref === "male" ? user.pref : undefined;

  const conds: string[] = [];
  const fparams: unknown[] = [];
  if (audiencePref) {
    conds.push("(audience='all' OR audience=?)");
    fparams.push(audiencePref);
  }
  if (blurNsfw) conds.push("nsfw=0");
  const filter = conds.length ? `AND ${conds.join(" AND ")}` : "";

  let chars: CharacterRow[] = [];
  const hasQuery = isValidSearchQuery(query);

  if (hasQuery) {
    const like = searchSqlLikePattern(query);
    if (genre) {
      const genreClause = genreFilterSql(genre);
      chars = decorateCharactersWithCreatorTiers(
        db,
        db
          .prepare(
            `
            SELECT * FROM characters
            WHERE (name LIKE ? OR creator_name LIKE ? OR EXISTS (
              SELECT 1 FROM json_each(COALESCE(NULLIF(tags, ''), '[]')) je WHERE je.value LIKE ?
            ))
              AND ${listableWhere()} ${filter}
              AND ${genreClause.sql}
            ORDER BY
              (CASE WHEN name LIKE ? THEN 0 WHEN creator_name LIKE ? THEN 1 ELSE 2 END) ASC,
              likes DESC, id DESC
            LIMIT ${SEARCH_RESULT_LIMIT}
          `
          )
          .all(like, like, like, ...fparams, ...genreClause.params, like, like) as CharacterRow[]
      );
    } else {
      const { sql, filterParams } = buildCharacterSearchSql({ audiencePref, blurNsfw });
      chars = decorateCharactersWithCreatorTiers(
        db,
        db.prepare(sql).all(like, like, like, ...filterParams, like, like) as CharacterRow[]
      );
    }
  } else if (genre) {
    const genreClause = genreFilterSql(genre);
    chars = decorateCharactersWithCreatorTiers(
      db,
      db
        .prepare(
          `SELECT * FROM characters
           WHERE ${genreClause.sql} AND ${listableWhere()} ${filter}
           ORDER BY likes DESC, id DESC
           LIMIT ${SEARCH_RESULT_LIMIT}`
        )
        .all(...genreClause.params, ...fparams) as CharacterRow[]
    );
  }

  const popularSource = db
    .prepare(`SELECT tags FROM characters WHERE ${listableWhere()} ${filter} ORDER BY likes DESC LIMIT 80`)
    .all(...fparams) as { tags: string }[];
  const popularTags = collectPopularTags(popularSource);

  const showingResults = hasQuery || Boolean(genre);

  return (
    <AppPageShell
      title="검색"
      description="캐릭터명 · 제작자명 · 태그로 찾고, 장르로 좁혀 보세요."
      className="mt-6"
    >
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3 sm:p-5">
        <div className="max-w-2xl">
          <TagSearchBar defaultQuery={query} genre={genre} />
        </div>

        {hasQuery || genre ? (
          <div className="mt-3">
            <ActiveFilters query={hasQuery ? query : ""} genre={genre} />
          </div>
        ) : null}

        <div className="mt-4">
          <FilterLabel>장르 카테고리</FilterLabel>
          <ChipRail label="장르 카테고리">
            <GenreChip href={searchHref({ q: query || undefined })} active={!genre}>
              전체
            </GenreChip>
            {CHARACTER_GENRES.map((g) => (
              <GenreChip key={g} href={searchHref({ q: query || undefined, g })} active={genre === g}>
                {g}
              </GenreChip>
            ))}
          </ChipRail>
        </div>

        {popularTags.length > 0 && (
          <div className="mt-3">
            <FilterLabel>인기 태그</FilterLabel>
            <ChipRail label="인기 태그">
              {popularTags.map((tag) => (
                <TagChip key={tag} href={searchHref({ q: tag, g: genre ?? undefined })} active={query === tag}>
                  {tag}
                </TagChip>
              ))}
            </ChipRail>
          </div>
        )}
      </div>

      {showingResults ? (
        <section className="mt-7" aria-label="검색 결과">
          <SearchResultsSummary query={hasQuery ? query : ""} genre={genre} count={chars.length} limit={SEARCH_RESULT_LIMIT} />
          {chars.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-5">
              {chars.map((c) => {
                const kind = hasQuery ? matchKind(c, query) : null;
                return (
                  <div key={c.id} className="min-w-0">
                    <CharacterCard c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
                    {kind && (
                      <p className="mt-2 inline-flex rounded-md bg-violet-500/10 px-1.5 py-0.5 text-xs font-medium text-violet-200">
                        {MATCH_LABEL[kind]} 일치
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <SearchEmpty query={hasQuery ? query : ""} genre={genre} />
          )}
        </section>
      ) : (
        <SearchGuide />
      )}
    </AppPageShell>
  );
}
