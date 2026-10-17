import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  PUBLIC_SITEMAP_PATHS,
  ROBOTS_ALLOW_PATHS,
  ROBOTS_DISALLOW_PATHS,
  SEO_CANONICAL_ORIGIN,
  buildRobots,
  buildSitemap,
  creatorProfileMetadata,
  homeMetadata,
  isSearchIndexableCreator,
  loginMetadata,
  searchMetadata,
  signupMetadata,
  tabMetadata,
} from "@/lib/siteSeo";

/** Test-only robots path match (Google: rule applies to URL path; query is not part of the path). */
function robotsPathname(input: string): string {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return new URL(input).pathname;
  }
  const q = input.indexOf("?");
  return (q === -1 ? input : input.slice(0, q)) || "/";
}

function ruleMatches(rule: string, pathname: string): boolean {
  const endAnchored = rule.endsWith("$");
  const prefix = endAnchored ? rule.slice(0, -1) : rule;
  if (!prefix.startsWith("/")) return false;
  if (endAnchored) return pathname === prefix;
  return pathname.startsWith(prefix);
}

/** Longest rule wins; equal length keeps allow. Mirrors the published allow/disallow lists only. */
function robotsCrawlAllowed(input: string): boolean {
  const pathname = robotsPathname(input);
  const rules: Array<{ kind: "allow" | "disallow"; rule: string }> = [
    ...ROBOTS_ALLOW_PATHS.map((rule) => ({ kind: "allow" as const, rule })),
    ...ROBOTS_DISALLOW_PATHS.map((rule) => ({ kind: "disallow" as const, rule })),
  ];
  let winnerKind: "allow" | "disallow" | null = null;
  let winnerLength = -1;
  for (const entry of rules) {
    if (!ruleMatches(entry.rule, pathname)) continue;
    const length = entry.rule.length;
    if (winnerKind == null || length > winnerLength || (length === winnerLength && entry.kind === "allow")) {
      winnerKind = entry.kind;
      winnerLength = length;
    }
  }
  return winnerKind == null || winnerKind === "allow";
}

function metaNoindex(path: string): boolean {
  if (path === "/login" || path.startsWith("/login?")) return loginMetadata().robots?.index === false;
  if (path === "/signup" || path.startsWith("/signup?")) return signupMetadata().robots?.index === false;
  if (path.startsWith("/tab/following")) return tabMetadata("following")?.robots?.index === false;
  if (path.startsWith("/tab/likes")) return tabMetadata("likes")?.robots?.index === false;
  return false;
}

function fixtureDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      site_managed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      creator_id INTEGER,
      official INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'private',
      moderation_status TEXT NOT NULL DEFAULT 'pending',
      nsfw INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-02 03:04:05'
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      board TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '2026-02-03 04:05:06'
    );
  `);
  return db;
}

function user(db: Database.Database, id: number, siteManaged = 0) {
  db.prepare("INSERT INTO users (id, site_managed) VALUES (?, ?)").run(id, siteManaged);
}

function character(
  db: Database.Database,
  input: {
    id: number;
    creatorId: number | null;
    official?: number;
    visibility?: string;
    moderation?: string;
    nsfw?: number;
    createdAt?: string;
  }
) {
  db.prepare(
    `INSERT INTO characters
      (id, creator_id, official, visibility, moderation_status, nsfw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.id,
    input.creatorId,
    input.official ?? 0,
    input.visibility ?? "public",
    input.moderation ?? "approved",
    input.nsfw ?? 0,
    input.createdAt ?? "2026-01-02 03:04:05"
  );
}

function urls(db: Database.Database): string[] {
  return buildSitemap(db).map((entry) => entry.url);
}

describe("site SEO", () => {
  it("uses the published origin for canonicals without reading OAuth env", () => {
    assert.equal(SEO_CANONICAL_ORIGIN, "https://hav.chat");
    assert.equal(homeMetadata().title, "하브 - AI 캐릭터 채팅");
    assert.equal(homeMetadata().description, "AI 캐릭터와 대화하는 채팅 플랫폼");
    assert.equal(homeMetadata().alternates?.canonical, "https://hav.chat/");
    assert.equal(searchMetadata().title, "검색 · 하브");
    assert.equal(searchMetadata().description, "이름, 태그, 장르로 공개 캐릭터를 찾습니다.");
    assert.equal(searchMetadata().alternates?.canonical, "https://hav.chat/search");
    assert.equal(tabMetadata("ranking")?.title, "랭킹 · 하브");
    assert.equal(tabMetadata("ranking")?.description, "공개 캐릭터의 대화 순위입니다.");
    assert.equal(tabMetadata("ranking")?.alternates?.canonical, "https://hav.chat/tab/ranking");
    assert.deepEqual(tabMetadata("following")?.robots, { index: false, follow: false });
    assert.equal(tabMetadata("following")?.alternates, undefined);
    assert.deepEqual(tabMetadata("likes")?.robots, { index: false, follow: false });
    assert.equal(tabMetadata("nope"), null);
    assert.deepEqual(loginMetadata().robots, { index: false, follow: false });
    assert.equal(loginMetadata().alternates, undefined);
    const hidden = creatorProfileMetadata({ id: 4, nickname: "비공개" }, false);
    assert.deepEqual(hidden.robots, { index: false, follow: false });
    assert.equal(hidden.alternates, undefined);
    const shown = creatorProfileMetadata({ id: 4, nickname: "공개" }, true);
    assert.equal(shown.alternates?.canonical, "https://hav.chat/creator/4");
  });

  it("separates robots crawl allow, noindex metadata, and sitemap membership", () => {
    const robots = buildRobots();
    assert.equal(robots.sitemap, "https://hav.chat/sitemap.xml");
    assert.equal(ROBOTS_DISALLOW_PATHS.includes("/trpg" as never), false);

    const noindexEntryPaths = ["/login", "/signup", "/tab/following", "/tab/likes"];
    for (const path of noindexEntryPaths) {
      assert.equal(robotsCrawlAllowed(path), true, `crawl ${path}`);
      assert.equal(metaNoindex(path), true, `noindex ${path}`);
      assert.equal(robotsCrawlAllowed(`${path}?redirect=/`), true, `crawl ${path}?`);
      assert.equal(metaNoindex(`${path}?redirect=/`), true, `noindex ${path}?`);
    }

    assert.equal(robotsCrawlAllowed("/creator"), false);
    assert.equal(robotsCrawlAllowed("/creator?tab=overview"), false);
    assert.equal(robotsCrawlAllowed("https://hav.chat/creator?tab=overview"), false);
    assert.equal(robotsCrawlAllowed("/creator/8"), true);

    assert.equal(robotsCrawlAllowed("/signup/verify"), false);
    assert.equal(robotsCrawlAllowed("/signup"), true);

    for (const path of [
      "/",
      "/search",
      "/tab/ranking",
      "/creator/8",
      "/terms",
      "/widgets",
    ]) {
      assert.equal(robotsCrawlAllowed(path), true, path);
    }

    for (const path of [
      "/points",
      "/chat/3",
      "/admin/ops",
      "/api/chat",
      "/character/2",
      "/widget/apply/token",
      "/world/apply/token",
      "/notifications",
      "/verify",
    ]) {
      assert.equal(robotsCrawlAllowed(path), false, path);
    }

    const db = fixtureDb();
    user(db, 1);
    character(db, { id: 1, creatorId: 1 });
    const sitemapPaths = urls(db);
    for (const path of noindexEntryPaths) {
      assert.equal(
        sitemapPaths.some((url) => url.endsWith(path) || url.includes(`${path}?`)),
        false,
        `sitemap ${path}`
      );
    }
    db.close();
  });

  it("fails crawl when query is left on the path (regression for studio URLs)", () => {
    const pathnameIfQueryNotStripped = "/creator?tab=overview";
    assert.equal(ruleMatches("/creator$", pathnameIfQueryNotStripped), false);
    assert.equal(robotsCrawlAllowed(pathnameIfQueryNotStripped), false);
  });

  it("lists only listable non-adult public URLs from an isolated fixture", () => {
    const db = fixtureDb();
    user(db, 1);
    character(db, { id: 1, creatorId: 1, createdAt: "2026-03-04 05:06:07" });
    character(db, { id: 2, creatorId: 1, visibility: "private" });

    user(db, 2);
    character(db, { id: 3, creatorId: 2, visibility: "private" });

    user(db, 3);
    character(db, { id: 4, creatorId: 3, moderation: "pending" });

    user(db, 4);
    character(db, { id: 5, creatorId: 4, moderation: "rejected" });

    user(db, 5);
    character(db, { id: 6, creatorId: 5, visibility: "link" });

    user(db, 6);
    character(db, { id: 7, creatorId: 6, nsfw: 1 });

    user(db, 7);
    character(db, { id: 8, creatorId: 7, official: 1 });

    user(db, 8, 1);
    character(db, { id: 9, creatorId: 8, official: 1, createdAt: "2026-04-05 06:07:08" });

    user(db, 9, 1);
    character(db, { id: 10, creatorId: 9, official: 1, nsfw: 1 });

    character(db, { id: 11, creatorId: null, official: 1 });

    user(db, 10);
    character(db, { id: 12, creatorId: 10, nsfw: 1 });
    character(db, { id: 13, creatorId: 10 });

    db.prepare("INSERT INTO posts (id, board, created_at) VALUES (50, 'notice', '2026-05-06 07:08:09')").run();
    db.prepare("INSERT INTO posts (id, board, created_at) VALUES (51, 'secret', '2026-05-06 07:08:09')").run();

    const entries = buildSitemap(db);
    const found = entries.map((entry) => entry.url);

    for (const path of PUBLIC_SITEMAP_PATHS) {
      const expected = path === "/" ? "https://hav.chat/" : `https://hav.chat${path}`;
      assert.equal(found.includes(expected), true, expected);
    }
    assert.equal(found.includes("https://hav.chat/notices/50"), true);
    assert.equal(found.includes("https://hav.chat/creator/1"), true);
    assert.equal(found.includes("https://hav.chat/creator/8"), true);
    assert.equal(found.includes("https://hav.chat/creator/10"), true);

    for (const creatorId of [2, 3, 4, 5, 6, 7, 9]) {
      assert.equal(found.includes(`https://hav.chat/creator/${creatorId}`), false, String(creatorId));
      assert.equal(isSearchIndexableCreator(db, creatorId), false, String(creatorId));
    }

    for (const url of found) {
      assert.equal(url.includes("?"), false, url);
      for (const blocked of [
        "/chat",
        "/points",
        "/admin",
        "/character/",
        "/c/",
        "/trpg",
        "/api/",
        "/login",
        "/signup",
        "/tab/following",
        "/tab/likes",
      ]) {
        assert.equal(url.includes(blocked), false, `${url} ${blocked}`);
      }
    }
    db.close();
  });
});
