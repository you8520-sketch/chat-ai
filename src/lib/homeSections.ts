import type Database from "better-sqlite3";
import type { CharacterRow } from "@/components/CharacterCard";
import { listableWhere } from "@/lib/characterVisibility";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";

/** lg:grid-cols-5 기준 한 줄 카드 수 */
export const HOME_CARDS_PER_ROW = 5;
export const HOME_NEWEST_ROW_COUNT = 5;
/** 상단 가로 스크롤 — 평소 대화·좋아요 기반 추천 */
export const HOME_RECOMMENDED_COUNT = 10;
/** 상단 가로 스크롤 — 관리자가 선정한 공모전 캐릭터 */
export const HOME_CONTEST_COUNT = 20;
/** /tab/likes — 좋아요한 캐릭터와 비슷한 계열 추천 */
export const LIKES_SIMILAR_COUNT = 12;

export type HomeListFilter = {
  filterSql: string;
  params: unknown[];
};

export type HomeSections = {
  /** 최상단 가로 스크롤 — 유저 대화·좋아요·취향(pref) 기반 추천 */
  recommended: CharacterRow[];
  /** 관리자가 선정한 공모전 캐릭터 — 공모전 진행 전에는 항상 빈 배열 */
  contest: CharacterRow[];
  /** 신작 최신순 — 데스크톱 기준 약 5줄(5×5) */
  newest: CharacterRow[];
};

function buildAudienceNsfwFilter(
  user: { pref?: string | null } | null | undefined,
  blurNsfw: boolean,
  colPrefix = ""
): HomeListFilter {
  const conds: string[] = [];
  const params: unknown[] = [];
  if (user?.pref === "female" || user?.pref === "male") {
    conds.push(`(${colPrefix}audience='all' OR ${colPrefix}audience=?)`);
    params.push(user.pref);
  }
  if (blurNsfw) conds.push(`${colPrefix}nsfw=0`);
  const filterSql = conds.length ? `AND ${conds.join(" AND ")}` : "";
  return { filterSql, params };
}

export function buildHomeListFilter(
  user: { pref?: string | null } | null | undefined,
  blurNsfw: boolean
): HomeListFilter {
  return buildAudienceNsfwFilter(user, blurNsfw);
}

type TasteSignals = {
  genres: Map<string, number>;
  tags: Map<string, number>;
};

function parseTags(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseGenres(raw: string | null | undefined, legacyGenre: string): string[] {
  const fromJson = parseTags(raw);
  if (fromJson.length > 0) return fromJson;
  return legacyGenre ? [legacyGenre] : [];
}

function collectTasteSignals(db: Database.Database, userId: number): TasteSignals {
  const genres = new Map<string, number>();
  const tags = new Map<string, number>();

  const bump = (map: Map<string, number>, key: string, weight: number) => {
    if (!key) return;
    map.set(key, (map.get(key) ?? 0) + weight);
  };

  const chatted = db
    .prepare(
      `SELECT c.genre, c.genres, c.tags
       FROM chats ch
       JOIN characters c ON c.id = ch.character_id
       WHERE ch.user_id = ?
       GROUP BY c.id
       ORDER BY MAX(ch.created_at) DESC
       LIMIT 25`
    )
    .all(userId) as { genre: string; genres: string; tags: string }[];

  for (const row of chatted) {
    for (const g of parseGenres(row.genres, row.genre)) bump(genres, g, 3);
    for (const t of parseTags(row.tags)) bump(tags, t, 2);
  }

  const liked = db
    .prepare(
      `SELECT c.genre, c.genres, c.tags
       FROM likes l
       JOIN characters c ON c.id = l.character_id
       WHERE l.user_id = ?`
    )
    .all(userId) as { genre: string; genres: string; tags: string }[];

  for (const row of liked) {
    for (const g of parseGenres(row.genres, row.genre)) bump(genres, g, 2);
    for (const t of parseTags(row.tags)) bump(tags, t, 1);
  }

  return { genres, tags };
}

function scoreByTaste(c: CharacterRow, taste: TasteSignals, userPref: string | null | undefined): number {
  let score = 0;
  for (const g of parseGenres((c as CharacterRow & { genres?: string }).genres, c.genre)) {
    score += taste.genres.get(g) ?? 0;
  }
  for (const t of parseTags(c.tags)) {
    score += taste.tags.get(t) ?? 0;
  }
  if (userPref === "female" && (c.audience === "female" || parseTags(c.tags).some((t) => /여성|여성향|GL|로맨스|순애/.test(t)))) {
    score += 1;
  }
  if (userPref === "male" && (c.audience === "male" || parseTags(c.tags).some((t) => /남성|남성향|BL|액션/.test(t)))) {
    score += 1;
  }
  score += Math.log10(Math.max(c.total_turns ?? 0, 1) + 1);
  score += Math.log10(Math.max(c.likes, 1) + 1) * 0.5;
  return score;
}

function excludeIdsClause(excludeIds: number[]): { sql: string; params: unknown[] } {
  if (excludeIds.length === 0) return { sql: "", params: [] };
  const placeholders = excludeIds.map(() => "?").join(", ");
  return { sql: `AND id NOT IN (${placeholders})`, params: [...excludeIds] };
}

/** 1행: 유저 대화·좋아요·취향(pref) 기반 추천 */
export function fetchRecommendedCharacters(
  db: Database.Database,
  user: { id?: number; pref?: string | null } | null | undefined,
  filter: HomeListFilter,
  limit = HOME_CARDS_PER_ROW,
  excludeIds: number[] = []
): CharacterRow[] {
  const { sql: excludeSql, params: excludeParams } = excludeIdsClause(excludeIds);
  const baseWhere = `${listableWhere()} ${filter.filterSql} ${excludeSql}`;

  if (user?.id != null) {
    const taste = collectTasteSignals(db, user.id);
    const hasTaste = taste.genres.size > 0 || taste.tags.size > 0;

    if (hasTaste) {
      const pool = db
        .prepare(
          `SELECT * FROM characters
           WHERE ${baseWhere}
           ORDER BY likes DESC, total_turns DESC
           LIMIT 80`
        )
        .all(...filter.params, ...excludeParams) as CharacterRow[];

      const picked = pool
        .map((c) => ({ c, score: scoreByTaste(c, taste, user.pref) }))
        .sort((a, b) => b.score - a.score || b.c.likes - a.c.likes)
        .slice(0, limit)
        .map(({ c }) => c);
      return decorateCharactersWithCreatorTiers(db, picked);
    }
  }

  const rows = db
    .prepare(
      `SELECT * FROM characters
       WHERE ${baseWhere}
       ORDER BY likes DESC, total_turns DESC, created_at DESC
       LIMIT ?`
    )
    .all(...filter.params, ...excludeParams, limit) as CharacterRow[];
  return decorateCharactersWithCreatorTiers(db, rows);
}

/** 2행: 최근 등록 + 최근 7일 대화·좋아요 등 engagement가 높은 신작 */
export function fetchHotNewCharacters(
  db: Database.Database,
  user: { pref?: string | null } | null | undefined,
  blurNsfw: boolean,
  limit = HOME_CARDS_PER_ROW,
  excludeIds: number[] = []
): CharacterRow[] {
  const filter = buildAudienceNsfwFilter(user, blurNsfw, "c.");
  const excludeParams = excludeIds.length ? [...excludeIds] : [];
  const excludeAliased = excludeIds.length
    ? `AND c.id NOT IN (${excludeIds.map(() => "?").join(", ")})`
    : "";

  const rows = db
    .prepare(
      `SELECT c.*
       FROM characters c
       LEFT JOIN (
         SELECT character_id, COUNT(*) AS recent_chats
         FROM chats
         WHERE created_at >= datetime('now', '-7 days')
         GROUP BY character_id
       ) rc ON rc.character_id = c.id
       WHERE ${listableWhere("c.created_at >= datetime('now', '-30 days')")} ${filter.filterSql} ${excludeAliased}
       ORDER BY
         COALESCE(rc.recent_chats, 0) DESC,
         c.total_turns DESC,
         c.likes DESC,
         c.created_at DESC
       LIMIT ?`
    )
    .all(...filter.params, ...excludeParams, limit) as CharacterRow[];
  return decorateCharactersWithCreatorTiers(db, rows);
}

/** 2행: 관리자가 선정한 공모전 캐릭터 — contest_pick=1인 캐릭터만 (공모전 진행 전엔 빈 배열) */
export function fetchContestCharacters(
  db: Database.Database,
  filter: HomeListFilter,
  limit = HOME_CONTEST_COUNT,
  excludeIds: number[] = []
): CharacterRow[] {
  const { sql: excludeSql, params: excludeParams } = excludeIdsClause(excludeIds);

  const rows = db
    .prepare(
      `SELECT * FROM characters
       WHERE contest_pick = 1 AND ${listableWhere()} ${filter.filterSql} ${excludeSql}
       ORDER BY contest_rank DESC, likes DESC, created_at DESC
       LIMIT ?`
    )
    .all(...filter.params, ...excludeParams, limit) as CharacterRow[];
  return decorateCharactersWithCreatorTiers(db, rows);
}

/** 3행~: 신작만 최신순 (약 5줄 분량) */
export function fetchNewestCharacters(
  db: Database.Database,
  filter: HomeListFilter,
  limit = HOME_CARDS_PER_ROW * HOME_NEWEST_ROW_COUNT,
  excludeIds: number[] = []
): CharacterRow[] {
  const { sql: excludeSql, params: excludeParams } = excludeIdsClause(excludeIds);

  const rows = db
    .prepare(
      `SELECT * FROM characters
       WHERE ${listableWhere()} ${filter.filterSql} ${excludeSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...filter.params, ...excludeParams, limit) as CharacterRow[];
  return decorateCharactersWithCreatorTiers(db, rows);
}

export function fetchUserCreatedCharacters(
  db: Database.Database,
  userId: number,
  limit = 10
): CharacterRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM characters WHERE creator_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(userId, limit) as CharacterRow[];
  return decorateCharactersWithCreatorTiers(db, rows);
}

export function fetchHomeSections(
  db: Database.Database,
  user: { id?: number; pref?: string | null } | null | undefined,
  blurNsfw: boolean
): HomeSections {
  const filter = buildHomeListFilter(user, blurNsfw);

  // 각 행은 독립적으로 채운다 — 캐릭터 수가 적을 때 추천 행이 전부 가져가면
  // 신규·공모전 행에서 서로 제외해 빈 화면이 되는 문제를 방지 (행 간 중복 노출은 정상)
  const recommended = fetchRecommendedCharacters(db, user, filter, HOME_RECOMMENDED_COUNT);
  const contest = fetchContestCharacters(db, filter, HOME_CONTEST_COUNT);
  const newest = fetchNewestCharacters(db, filter, HOME_CARDS_PER_ROW * HOME_NEWEST_ROW_COUNT);

  return { recommended, contest, newest };
}

/**
 * Likes tab: characters similar to ones the user already liked.
 * Excludes already-liked IDs. Empty when the user has no likes yet.
 */
export function fetchSimilarToLikedCharacters(
  db: Database.Database,
  user: { id: number; pref?: string | null },
  blurNsfw: boolean,
  limit = LIKES_SIMILAR_COUNT
): CharacterRow[] {
  const likedIds = (
    db.prepare("SELECT character_id FROM likes WHERE user_id=?").all(user.id) as Array<{
      character_id: number;
    }>
  ).map((r) => r.character_id);
  if (likedIds.length === 0) return [];

  const filter = buildHomeListFilter(user, blurNsfw);
  return fetchRecommendedCharacters(db, user, filter, limit, likedIds);
}
