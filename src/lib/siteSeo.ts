import type { Metadata } from "next";
import type Database from "better-sqlite3";
import { SERVICE_PUBLIC_ORIGIN } from "@/lib/businessIdentity";
import { listableWhere } from "@/lib/characterVisibility";
import { listPublicNoticeSitemapRows } from "@/lib/notices";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME, SITE_PAGE_TITLE } from "@/lib/siteBrand";

/** Published site origin for search canonicals. OAuth origin stays in publicOrigin.ts. */
export const SEO_CANONICAL_ORIGIN = SERVICE_PUBLIC_ORIGIN;

export const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/search",
  "/tab/new",
  "/tab/ranking",
  "/tab/official",
  "/tab/genre",
  "/terms",
  "/privacy",
  "/refund",
  "/board/notice",
  "/widgets",
] as const;

/**
 * Crawl blocks for login-gated, personal, admin, token, and unlisted-share paths.
 * robots disallow limits fetching; it is not the same as HTML `noindex`.
 * `/login`, `/signup`, `/tab/following`, `/tab/likes` stay out of this list so bots can
 * fetch them and read `noindex` metadata. They remain out of the sitemap.
 * `/creator$` is the login-only studio route (including `/creator?tab=…`). Public profiles stay at `/creator/{id}`.
 * `/signup/` blocks token subpaths such as `/signup/verify` without blocking `/signup`.
 * TRPG routes are left untouched.
 */
export const ROBOTS_DISALLOW_PATHS = [
  "/api/",
  "/admin/",
  "/albums",
  "/bookmarks",
  "/c/",
  "/character/",
  "/chat/",
  "/chats",
  "/create",
  "/creator$",
  "/events/",
  "/lorebook",
  "/my-characters",
  "/notifications",
  "/onboarding",
  "/payments",
  "/persona",
  "/points",
  "/settings",
  "/signup/",
  "/simulation",
  "/studio",
  "/verify",
  "/widget/",
  "/world",
] as const;

export const ROBOTS_ALLOW_PATHS = ["/", "/creator/"] as const;

export type SeoSitemapEntry = {
  url: string;
  lastModified?: Date;
};

export function absoluteSeoUrl(path: string): string {
  if (path === "/") return `${SEO_CANONICAL_ORIGIN}/`;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${SEO_CANONICAL_ORIGIN}${normalized}`;
}

export function publicPageMetadata(input: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: absoluteSeoUrl(input.path) },
    robots: { index: true, follow: true },
  };
}

export function privatePageMetadata(input: { title: string; description: string }): Metadata {
  return {
    title: input.title,
    description: input.description,
    robots: { index: false, follow: false },
  };
}

export function homeMetadata(): Metadata {
  return publicPageMetadata({
    title: SITE_PAGE_TITLE,
    description: SITE_DESCRIPTION,
    path: "/",
  });
}

export function searchMetadata(): Metadata {
  return publicPageMetadata({
    title: `검색 · ${SITE_DISPLAY_NAME}`,
    description: "이름, 태그, 장르로 공개 캐릭터를 찾습니다.",
    path: "/search",
  });
}

type DiscoveryTab = "official" | "new" | "ranking" | "genre" | "following" | "likes";

function isDiscoveryTab(tab: string): tab is DiscoveryTab {
  return (
    tab === "official" ||
    tab === "new" ||
    tab === "ranking" ||
    tab === "genre" ||
    tab === "following" ||
    tab === "likes"
  );
}

export function tabMetadata(tab: string): Metadata | null {
  if (!isDiscoveryTab(tab)) return null;
  switch (tab) {
    case "official":
      return publicPageMetadata({
        title: `공식 캐릭터 · ${SITE_DISPLAY_NAME}`,
        description: "하브 공식 캐릭터입니다.",
        path: "/tab/official",
      });
    case "new":
      return publicPageMetadata({
        title: `실시간 신작 · ${SITE_DISPLAY_NAME}`,
        description: "새로 공개된 캐릭터입니다.",
        path: "/tab/new",
      });
    case "ranking":
      return publicPageMetadata({
        title: `랭킹 · ${SITE_DISPLAY_NAME}`,
        description: "공개 캐릭터의 대화 순위입니다.",
        path: "/tab/ranking",
      });
    case "genre":
      return publicPageMetadata({
        title: `장르별 탐색 · ${SITE_DISPLAY_NAME}`,
        description: "장르로 나누어 공개 캐릭터를 살펴봅니다.",
        path: "/tab/genre",
      });
    case "following":
      return privatePageMetadata({
        title: `북마크/팔로잉 · ${SITE_DISPLAY_NAME}`,
        description: "로그인한 계정의 북마크와 팔로잉입니다.",
      });
    case "likes":
      return privatePageMetadata({
        title: `북마크한 캐릭터 · ${SITE_DISPLAY_NAME}`,
        description: "로그인한 계정의 북마크입니다.",
      });
    default: {
      const unreachable: never = tab;
      return unreachable;
    }
  }
}

export function noticeBoardMetadata(): Metadata {
  return publicPageMetadata({
    title: `공지사항 · ${SITE_DISPLAY_NAME}`,
    description: "하브 운영 공지입니다.",
    path: "/board/notice",
  });
}

export function noticeDetailMetadata(notice: { id: number; title: string }): Metadata {
  const title = notice.title.trim() || "공지";
  return publicPageMetadata({
    title: `${title} · ${SITE_DISPLAY_NAME}`,
    description: "하브 운영 공지입니다.",
    path: `/notices/${notice.id}`,
  });
}

export function creatorProfileMetadata(
  creator: { id: number; nickname: string },
  indexable: boolean
): Metadata {
  const title = `${creator.nickname} · ${SITE_DISPLAY_NAME}`;
  const description = `${creator.nickname}의 공개 캐릭터`;
  if (!indexable) return privatePageMetadata({ title, description });
  return publicPageMetadata({
    title,
    description,
    path: `/creator/${creator.id}`,
  });
}

export function widgetsMetadata(): Metadata {
  return publicPageMetadata({
    title: "공유 상태창",
    description: "커뮤니티에 공개된 상태창입니다.",
    path: "/widgets",
  });
}

export function loginMetadata(): Metadata {
  return privatePageMetadata({
    title: `로그인 · ${SITE_DISPLAY_NAME}`,
    description: "하브 계정 로그인",
  });
}

export function signupMetadata(): Metadata {
  return privatePageMetadata({
    title: `회원가입 · ${SITE_DISPLAY_NAME}`,
    description: "하브 계정 만들기",
  });
}

export function buildRobots(): {
  rules: { userAgent: string; allow: string[]; disallow: string[] };
  sitemap: string;
  host: string;
} {
  return {
    rules: {
      userAgent: "*",
      allow: [...ROBOTS_ALLOW_PATHS],
      disallow: [...ROBOTS_DISALLOW_PATHS],
    },
    sitemap: absoluteSeoUrl("/sitemap.xml"),
    host: SEO_CANONICAL_ORIGIN,
  };
}

/**
 * Creator profiles that have a listable non-adult work.
 * Adult-only catalogs stay out until an indexing policy exists.
 * The visibility predicate is listableWhere(), matching the creator page.
 */
const INDEXABLE_CREATOR_WHERE = `
  characters.nsfw = 0
  AND (
    (users.site_managed = 1 AND ${listableWhere()})
    OR (IFNULL(users.site_managed, 0) = 0 AND characters.official = 0 AND ${listableWhere()})
  )
`;

export function isSearchIndexableCreator(db: Database.Database, creatorId: number): boolean {
  if (!Number.isInteger(creatorId) || creatorId <= 0) return false;
  const row = db
    .prepare(
      `SELECT 1 AS ok
       FROM characters
       JOIN users ON users.id = characters.creator_id
       WHERE characters.creator_id = ?
         AND ${INDEXABLE_CREATOR_WHERE}
       LIMIT 1`
    )
    .get(creatorId) as { ok: number } | undefined;
  return row?.ok === 1;
}

export function sqliteTimestampToDate(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    const date = new Date(trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/.exec(trimmed);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function buildSitemap(db: Database.Database): SeoSitemapEntry[] {
  const entries: SeoSitemapEntry[] = PUBLIC_SITEMAP_PATHS.map((path) => ({
    url: absoluteSeoUrl(path),
  }));

  for (const notice of listPublicNoticeSitemapRows(db)) {
    const lastModified = sqliteTimestampToDate(notice.created_at);
    entries.push({
      url: absoluteSeoUrl(`/notices/${notice.id}`),
      ...(lastModified ? { lastModified } : {}),
    });
  }

  const creators = db
    .prepare(
      `SELECT characters.creator_id AS creator_id, MAX(characters.created_at) AS updated_at
       FROM characters
       JOIN users ON users.id = characters.creator_id
       WHERE ${INDEXABLE_CREATOR_WHERE}
       GROUP BY characters.creator_id
       ORDER BY characters.creator_id ASC`
    )
    .all() as { creator_id: number; updated_at: string | null }[];

  for (const creator of creators) {
    const lastModified = creator.updated_at ? sqliteTimestampToDate(creator.updated_at) : undefined;
    entries.push({
      url: absoluteSeoUrl(`/creator/${creator.creator_id}`),
      ...(lastModified ? { lastModified } : {}),
    });
  }

  return entries;
}
