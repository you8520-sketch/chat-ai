import type Database from "better-sqlite3";
import type { CharacterRow } from "@/components/CharacterCard";
import { listableWhere } from "@/lib/characterVisibility";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";

/** lg:grid-cols-5 기준 한 줄 카드 수 */
export const HOME_CARDS_PER_ROW = 5;
export const HOME_NEWEST_ROW_COUNT = 5;
/** 상단 가로 스크롤 — 좋아요·대화·채팅방·클릭 기반 추천 */
export const HOME_RECOMMENDED_COUNT = 10;
/** 상단 가로 스크롤 — 관리자가 선정한 공모전 캐릭터 */
export const HOME_CONTEST_COUNT = 20;

export type HomeListFilter = {
  filterSql: string;
  params: unknown[];
};

export type HomeSections = {
  /** 최상단 가로 스크롤 — 유저 행동 시그널 기반 추천 */
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

function bumpTaste(
  taste: TasteSignals,
  row: { genre: string; genres: string; tags: string },
  genreWeight: number,
  tagWeight: number
) {
  for (const g of parseGenres(row.genres, row.genre)) {
    if (!g) continue;
    taste.genres.set(g, (taste.genres.get(g) ?? 0) + genreWeight);
  }
  for (const t of parseTags(row.tags)) {
    if (!t) continue;
    taste.tags.set(t, (taste.tags.get(t) ?? 0) + tagWeight);
  }
}

/**
 * Taste seeds for home "추천 캐릭터":
 * - likes (hearts)
 * - heavy chat volume (user messages)
 * - open chat rooms
 * - character clicks / page opens
 */
export function collectTasteSignals(db: Database.Database, userId: number): TasteSignals {
  const taste: TasteSignals = { genres: new Map(), tags: new Map() };

  // Open chat rooms + conversation volume (user messages).
  const chatted = db
    .prepare(
      `SELECT c.genre, c.genres, c.tags,
              COUNT(DISTINCT ch.id) AS room_count,
              COALESCE(SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END), 0) AS user_msgs
       FROM chats ch
       JOIN characters c ON c.id = ch.character_id
       LEFT JOIN messages m ON m.chat_id = ch.id
       WHERE ch.user_id = ?
       GROUP BY c.id
       ORDER BY user_msgs DESC, MAX(ch.created_at) DESC
       LIMIT 40`
    )
    .all(userId) as Array<{
    genre: string;
    genres: string;
    tags: string;
    room_count: number;
    user_msgs: number;
  }>;

  for (const row of chatted) {
    const rooms = Math.max(1, Number(row.room_count) || 1);
    const msgs = Math.max(0, Number(row.user_msgs) || 0);
    // Open room base + heavier weight for frequent chats.
    const volumeBoost = Math.min(8, Math.log10(msgs + 1) * 4);
    const genreW = 2.5 * rooms + volumeBoost;
    const tagW = 1.5 * rooms + volumeBoost * 0.6;
    bumpTaste(taste, row, genreW, tagW);
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
    bumpTaste(taste, row, 4, 2.5);
  }

  const clicked = db
    .prepare(
      `SELECT c.genre, c.genres, c.tags, cc.click_count,
              CASE WHEN cc.last_clicked_at >= datetime('now', '-14 days') THEN 1 ELSE 0 END AS recent
       FROM character_clicks cc
       JOIN characters c ON c.id = cc.character_id
       WHERE cc.user_id = ?
       ORDER BY cc.last_clicked_at DESC
       LIMIT 40`
    )
    .all(userId) as Array<{
    genre: string;
    genres: string;
    tags: string;
    click_count: number;
    recent: number;
  }>;

  for (const row of clicked) {
    const clicks = Math.max(1, Number(row.click_count) || 1);
    const recentBoost = row.recent ? 1.4 : 1;
    const genreW = (1.2 + Math.min(3, Math.log10(clicks + 1) * 2)) * recentBoost;
    const tagW = genreW * 0.65;
    bumpTaste(taste, row, genreW, tagW);
  }

  return taste;
}

/** Characters the user already engages with — excluded from discovery recommendations. */
export function collectEngagedCharacterIds(db: Database.Database, userId: number): number[] {
  const ids = new Set<number>();
  for (const row of db
    .prepare("SELECT character_id AS id FROM likes WHERE user_id=?")
    .all(userId) as Array<{ id: number }>) {
    ids.add(row.id);
  }
  for (const row of db
    .prepare("SELECT DISTINCT character_id AS id FROM chats WHERE user_id=?")
    .all(userId) as Array<{ id: number }>) {
    ids.add(row.id);
  }
  return [...ids];
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

function fetchPopularCharacters(
  db: Database.Database,
  filter: HomeListFilter,
  excludeIds: number[],
  limit: number
): CharacterRow[] {
  const { sql: excludeSql, params: excludeParams } = excludeIdsClause(excludeIds);
  return db
    .prepare(
      `SELECT * FROM characters
       WHERE ${listableWhere()} ${filter.filterSql} ${excludeSql}
       ORDER BY likes DESC, total_turns DESC, created_at DESC
       LIMIT ?`
    )
    .all(...filter.params, ...excludeParams, limit) as CharacterRow[];
}

function pickByTasteFromPool(
  pool: CharacterRow[],
  taste: TasteSignals,
  userPref: string | null | undefined,
  limit: number
): CharacterRow[] {
  return pool
    .map((c) => ({ c, score: scoreByTaste(c, taste, userPref) }))
    .sort((a, b) => b.score - a.score || b.c.likes - a.c.likes)
    .slice(0, limit)
    .map(({ c }) => c);
}

/**
 * 홈 추천 캐릭터 — 좋아요·대화량·채팅방·클릭 시그널로 비슷한 캐릭터 노출.
 * 이미 좋아요/대화한 캐릭터는 우선 제외(디스커버리)하되,
 * 후보가 부족하면 인기 캐릭터로 채워 추천 줄이 통째로 사라지지 않게 한다.
 */
export function fetchRecommendedCharacters(
  db: Database.Database,
  user: { id?: number; pref?: string | null } | null | undefined,
  filter: HomeListFilter,
  limit = HOME_CARDS_PER_ROW,
  excludeIds: number[] = []
): CharacterRow[] {
  const engagedIds =
    user?.id != null ? collectEngagedCharacterIds(db, user.id) : [];
  const discoveryExclude = [...new Set([...excludeIds, ...engagedIds])];

  let picked: CharacterRow[] = [];

  if (user?.id != null) {
    const taste = collectTasteSignals(db, user.id);
    const hasTaste = taste.genres.size > 0 || taste.tags.size > 0;

    if (hasTaste) {
      const { sql: excludeSql, params: excludeParams } = excludeIdsClause(discoveryExclude);
      const pool = db
        .prepare(
          `SELECT * FROM characters
           WHERE ${listableWhere()} ${filter.filterSql} ${excludeSql}
           ORDER BY likes DESC, total_turns DESC
           LIMIT 100`
        )
        .all(...filter.params, ...excludeParams) as CharacterRow[];

      picked = pickByTasteFromPool(pool, taste, user.pref, limit);
    }
  }

  if (picked.length < limit) {
    const already = new Set(picked.map((c) => c.id));
    const need = limit - picked.length;
    // 아직 안 본 인기 캐릭터로만 보충 (참여 캐릭터는 여기선 넣지 않음)
    const fill = fetchPopularCharacters(db, filter, discoveryExclude, need).filter(
      (c) => !already.has(c.id)
    );
    picked = [...picked, ...fill].slice(0, limit);
  }

  // 디스커버리 후보가 전무하면(대부분 좋아요/대화함) 참여 캐릭터라도 노출 — 추천 줄 숨김 방지
  if (picked.length === 0) {
    picked = fetchPopularCharacters(db, filter, excludeIds, limit);
  }

  return decorateCharactersWithCreatorTiers(db, picked);
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
  // 신작·공모전 행에서 서로 제외해 빈 화면이 되는 문제를 방지 (행 간 중복 노출은 정상)
  const recommended = fetchRecommendedCharacters(db, user, filter, HOME_RECOMMENDED_COUNT);
  const contest = fetchContestCharacters(db, filter, HOME_CONTEST_COUNT);
  const newest = fetchNewestCharacters(db, filter, HOME_CARDS_PER_ROW * HOME_NEWEST_ROW_COUNT);

  return { recommended, contest, newest };
}
