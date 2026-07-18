import Link from "next/link";
import { AppPageShell } from "@/components/AppPageShell";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import TagSearchBar from "@/components/TagSearchBar";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { cn, studioType } from "@/lib/studioDesign";
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
  sanitizeSearchQuery,
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

function searchHref(opts: { q?: string; g?: string }): string {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  if (opts.g) params.set("g", opts.g);
  const qs = params.toString();
  return qs ? `/search?${qs}` : "/search";
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; g?: string }>;
}) {
  const { q: rawQ, g: rawG } = await searchParams;
  const query = sanitizeSearchQuery(rawQ ?? "");
  const genre =
    rawG && isCharacterGenre(rawG.trim()) ? (rawG.trim() as CharacterGenre) : null;
  const db = getDb();
  const user = await getSessionUser();
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
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
            LIMIT 60
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
           LIMIT 60`
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
      description="캐릭터명 · 제작자명 · 태그 · 장르로 작품을 찾아보세요."
      className="mt-6"
    >
      <div className="max-w-xl">
        <TagSearchBar defaultQuery={query} genre={genre} />
      </div>

      <div className="mt-5">
        <p className={cn(studioType.caption, "mb-2 font-semibold")}>장르 카테고리</p>
        <div className="flex flex-wrap gap-2">
          <Link
            href={searchHref({ q: query || undefined })}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              !genre
                ? "border-violet-500/40 bg-violet-600 text-white"
                : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
            }`}
          >
            전체
          </Link>
          {CHARACTER_GENRES.map((g) => (
            <Link
              key={g}
              href={searchHref({ q: query || undefined, g })}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                genre === g
                  ? "border-violet-500/40 bg-violet-600 text-white"
                  : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
              }`}
            >
              {g}
            </Link>
          ))}
        </div>
      </div>

      {popularTags.length > 0 && (
        <div className="mt-5">
          <p className={cn(studioType.caption, "mb-2 font-semibold")}>인기 태그</p>
          <div className="flex flex-wrap gap-2">
            {popularTags.map((tag) => (
              <Link
                key={tag}
                href={searchHref({ q: tag, g: genre ?? undefined })}
                className={`rounded-full border px-3 py-1 text-sm transition ${
                  query === tag
                    ? "border-violet-500/40 bg-violet-600 text-white"
                    : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-zinc-50"
                }`}
              >
                #{tag}
              </Link>
            ))}
          </div>
        </div>
      )}

      {showingResults ? (
        <>
          <p className={cn(studioType.body, "mt-6")}>
            {hasQuery ? (
              <>
                <span className="font-semibold text-violet-300">「{query}」</span>
                {genre ? (
                  <>
                    {" "}
                    · <span className="font-semibold text-violet-300">{genre}</span>
                  </>
                ) : null}{" "}
                검색 결과{" "}
              </>
            ) : (
              <>
                <span className="font-semibold text-violet-300">{genre}</span> 장르{" "}
              </>
            )}
            <span className="text-zinc-50">{chars.length}</span>건
          </p>
          {chars.length > 0 ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {chars.map((c) => {
                const kind = hasQuery ? matchKind(c, query) : null;
                return (
                  <div key={c.id} className="relative">
                    {kind && (
                      <span className="absolute right-2 top-2 z-10 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                        {MATCH_LABEL[kind]}
                      </span>
                    )}
                    <CharacterCard c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-10 text-center text-zinc-400">
              {hasQuery
                ? `「${query}」에 해당하는 결과가 없습니다.`
                : `「${genre}」 장르에 해당하는 캐릭터가 없습니다.`}
            </p>
          )}
        </>
      ) : (
        <p className="mt-10 text-center text-sm text-zinc-400">
          검색어를 입력하거나 위 장르·인기 태그를 눌러보세요.
        </p>
      )}
    </AppPageShell>
  );
}
