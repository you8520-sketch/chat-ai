export const SEARCH_QUERY_MAX = 40;

/** 통합 검색어 정규화 (태그·캐릭터명·제작자명) */
export function sanitizeSearchQuery(raw: string): string {
  return raw.trim().slice(0, SEARCH_QUERY_MAX).replace(/["\\%_]/g, "");
}

export function searchSqlLikePattern(query: string): string {
  return `%${sanitizeSearchQuery(query)}%`;
}

export function isValidSearchQuery(query: string): boolean {
  return sanitizeSearchQuery(query).length > 0;
}

/** @deprecated use sanitizeSearchQuery */
export const sanitizeTagQuery = sanitizeSearchQuery;

/** @deprecated use searchSqlLikePattern */
export const tagSqlLikePattern = searchSqlLikePattern;

/** @deprecated use isValidSearchQuery */
export const isValidTagQuery = isValidSearchQuery;

export type CharacterSearchFilters = {
  audiencePref?: "female" | "male";
  blurNsfw?: boolean;
};

/** 태그 · 캐릭터명 · 제작자명 통합 검색 SQL */
export function buildCharacterSearchSql(filter: CharacterSearchFilters) {
  const conds: string[] = [];
  if (filter.audiencePref === "female" || filter.audiencePref === "male") {
    conds.push("(audience='all' OR audience=?)");
  }
  if (filter.blurNsfw) conds.push("nsfw=0");
  const extraFilter = conds.length ? `AND ${conds.join(" AND ")}` : "";

  const listable =
    "(official=1 OR (visibility='public' AND moderation_status='approved' AND creator_id IS NOT NULL))";

  const tagMatch = `EXISTS (SELECT 1 FROM json_each(COALESCE(NULLIF(tags, ''), '[]')) je WHERE je.value LIKE ?)`;

  return {
    sql: `
      SELECT * FROM characters
      WHERE (name LIKE ? OR creator_name LIKE ? OR ${tagMatch})
        AND ${listable} ${extraFilter}
      ORDER BY
        (CASE WHEN name LIKE ? THEN 0 WHEN creator_name LIKE ? THEN 1 ELSE 2 END) ASC,
        likes DESC, id DESC
      LIMIT 60
    `,
    filterParams: filter.audiencePref === "female" || filter.audiencePref === "male" ? [filter.audiencePref] : [],
  };
}
