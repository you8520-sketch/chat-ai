export const SEARCH_QUERY_MAX = 40;

/** 통합 검색어 정규화 (태그·캐릭터명·제작자명) */
export function sanitizeSearchQuery(raw: string): string {
  return raw.trim().slice(0, SEARCH_QUERY_MAX).replace(/["\\%_]/g, "");
}

/**
 * 캐릭터 통합 검색(캐릭터명·제작자명·태그) 입력용 정규화.
 * 선행 `#`는 태그 표기이고 인기 태그 칩은 `#` 없이 `q=태그`로 이동하므로, 같은 검색어가 되도록 제거한다.
 * 중간 `#`("C# 개발자")와 `#`만 입력한 경우는 유지한다.
 * 공유 `sanitizeSearchQuery`는 TRPG 캐릭터 검색에서도 쓰이므로 계약을 바꾸지 않는다.
 */
export function normalizeCatalogSearchQuery(raw: string): string {
  return sanitizeSearchQuery(raw.replace(/["\\%_]/g, "").trim().replace(/^#+\s*(?=[^#\s])/, ""));
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
