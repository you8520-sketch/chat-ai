import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  SEARCH_QUERY_MAX,
  SEARCH_RESULT_LIMIT,
  buildCharacterSearchSql,
  isValidSearchQuery,
  normalizeCatalogSearchQuery,
  sanitizeSearchQuery,
  searchSqlLikePattern,
} from "./tagSearch";
import { searchTrpgCharacters } from "./trpg/characterSearch";

function createCatalog() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      creator_id INTEGER,
      creator_name TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public',
      moderation_status TEXT NOT NULL DEFAULT 'approved',
      official INTEGER NOT NULL DEFAULT 0,
      nsfw INTEGER NOT NULL DEFAULT 0,
      audience TEXT NOT NULL DEFAULT 'all',
      trpg_reuse_allowed INTEGER NOT NULL DEFAULT 0,
      emoji TEXT NOT NULL DEFAULT '✨',
      likes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const insert = db.prepare(
    `INSERT INTO characters (name, tags, creator_id, creator_name, visibility, moderation_status, official, nsfw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insert.run("공개캐릭터", JSON.stringify(["아포칼립스"]), 1, "제작자", "public", "approved", 0, 0);
  insert.run("비공개캐릭터", JSON.stringify(["아포칼립스"]), 2, "제작자", "private", "approved", 0, 0);
  insert.run("검수대기캐릭터", JSON.stringify(["아포칼립스"]), 3, "제작자", "public", "pending", 0, 0);
  insert.run("성인캐릭터", JSON.stringify(["아포칼립스"]), 4, "제작자", "public", "approved", 0, 1);
  insert.run("개발자", JSON.stringify(["C# 개발"]), 5, "샵", "public", "approved", 0, 0);
  return db;
}

function searchNames(db: Database.Database, rawQuery: string, blurNsfw: boolean): string[] {
  const query = normalizeCatalogSearchQuery(rawQuery);
  if (!isValidSearchQuery(query)) return [];
  const like = searchSqlLikePattern(query);
  const built = buildCharacterSearchSql({ blurNsfw });
  const rows = db
    .prepare(built.sql)
    .all(like, like, like, like, like, ...built.filterParams) as { name: string }[];
  return rows.map((r) => r.name);
}

describe("normalizeCatalogSearchQuery", () => {
  it("strips a leading hash tag notation so typed input equals the chip query", () => {
    for (const typed of ["#아포칼립스", " #아포칼립스 ", "##아포칼립스", "# 아포칼립스", "#%아포칼립스"]) {
      assert.equal(normalizeCatalogSearchQuery(typed), "아포칼립스", typed);
    }
    assert.equal(normalizeCatalogSearchQuery("아포칼립스"), "아포칼립스");
  });

  it("keeps meaningful hashes and ordinary text", () => {
    assert.equal(normalizeCatalogSearchQuery("C# 개발자"), "C# 개발자");
    assert.equal(normalizeCatalogSearchQuery("태그#뒤"), "태그#뒤");
    assert.equal(normalizeCatalogSearchQuery("#"), "#");
    assert.equal(normalizeCatalogSearchQuery("##"), "##");
    assert.equal(normalizeCatalogSearchQuery("공개캐릭터"), "공개캐릭터");
  });

  it("handles blank, special characters and the length limit", () => {
    assert.equal(normalizeCatalogSearchQuery(""), "");
    assert.equal(normalizeCatalogSearchQuery("   "), "");
    assert.equal(normalizeCatalogSearchQuery('%_\\"'), "");
    assert.equal(normalizeCatalogSearchQuery("#%_"), "#");
    const longTag = "가".repeat(SEARCH_QUERY_MAX + 20);
    assert.equal(normalizeCatalogSearchQuery(longTag).length, SEARCH_QUERY_MAX);
    assert.equal(normalizeCatalogSearchQuery(`#${longTag}`), normalizeCatalogSearchQuery(longTag));
  });

  it("leaves the shared sanitizer contract untouched for TRPG search", () => {
    assert.equal(sanitizeSearchQuery("#아포칼립스"), "#아포칼립스");
    assert.equal(sanitizeSearchQuery(" #a "), "#a");
  });
});

describe("catalog search results", () => {
  it("returns the same results for the tag chip and typed #tag", () => {
    const db = createCatalog();
    const chip = searchNames(db, "아포칼립스", false);
    assert.deepEqual(chip, ["성인캐릭터", "공개캐릭터"].sort((a, b) => chip.indexOf(a) - chip.indexOf(b)));
    for (const typed of ["#아포칼립스", " #아포칼립스 ", "##아포칼립스", "# 아포칼립스"]) {
      assert.deepEqual(searchNames(db, typed, false), chip, typed);
    }
    db.close();
  });

  it("keeps private, pending and adult listings out of tag results", () => {
    const db = createCatalog();
    assert.deepEqual(searchNames(db, "#아포칼립스", true), ["공개캐릭터"]);
    const all = searchNames(db, "#아포칼립스", false);
    assert.ok(!all.includes("비공개캐릭터"));
    assert.ok(!all.includes("검수대기캐릭터"));
    db.close();
  });

  it("keeps name, creator and inner-hash searches working", () => {
    const db = createCatalog();
    assert.deepEqual(searchNames(db, "공개캐릭터", false), ["공개캐릭터"]);
    assert.deepEqual(searchNames(db, "샵", false), ["개발자"]);
    assert.deepEqual(searchNames(db, "C# 개발", false), ["개발자"]);
    assert.deepEqual(searchNames(db, "#C# 개발", false), ["개발자"]);
    assert.deepEqual(searchNames(db, "없는검색어", false), []);
    assert.deepEqual(searchNames(db, "   ", false), []);
    db.close();
  });
});

describe("catalog search result limit", () => {
  it("caps results at the displayed limit so the page can say it is truncated", () => {
    assert.equal(SEARCH_RESULT_LIMIT, 60);
    const db = createCatalog();
    const insert = db.prepare(
      `INSERT INTO characters (name, tags, creator_id, creator_name, visibility, moderation_status, official, nsfw)
       VALUES (?, ?, 9, '제작자', 'public', 'approved', 0, 0)`
    );
    for (let i = 0; i < SEARCH_RESULT_LIMIT + 5; i++) insert.run(`대량${i}`, JSON.stringify(["대량태그"]));
    assert.equal(searchNames(db, "대량태그", false).length, SEARCH_RESULT_LIMIT);
    assert.match(buildCharacterSearchSql({ blurNsfw: false }).sql, new RegExp(`LIMIT ${SEARCH_RESULT_LIMIT}\\b`));
  });
});

describe("TRPG character search keeps the shared sanitizer semantics", () => {
  it("does not search tags and still matches by name or creator", () => {
    const db = createCatalog();
    db.prepare("UPDATE characters SET trpg_reuse_allowed=1").run();
    const opts = { viewerUserId: 99, scope: "search" as const };
    assert.deepEqual(
      searchTrpgCharacters(db, { ...opts, query: "공개캐릭터" }).map((c) => c.name),
      ["공개캐릭터"]
    );
    assert.deepEqual(searchTrpgCharacters(db, { ...opts, query: "#아포칼립스" }), []);
    assert.deepEqual(searchTrpgCharacters(db, { ...opts, query: "아포칼립스" }), []);
    db.close();
  });
});
