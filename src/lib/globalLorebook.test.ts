import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  buildGlobalLorebookPromptBlock,
  GLOBAL_LOREBOOK_HTML_TRIGGERS,
  GLOBAL_LOREBOOK_HTML_VISUAL_CARD_NAME,
  loadGlobalLorebookPromptBlock,
  matchGlobalLorebookEntries,
  rowToGlobalLorebookEntry,
  seedGlobalLorebookEntries,
} from "@/lib/globalLorebook";
import { HTML_OUTPUT_OWNERSHIP_BLOCK } from "@/lib/htmlVisualCardPolicy";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE global_lorebook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      triggers_json TEXT NOT NULL DEFAULT '[]',
      content TEXT NOT NULL,
      depth INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("globalLorebook", () => {
  it("matches HTML trigger only with explicit HTML output intent", () => {
    const entry = rowToGlobalLorebookEntry({
      id: 1,
      name: "test",
      triggers_json: JSON.stringify(["HTML"]),
      content: "rules",
      depth: 0,
      enabled: 1,
      sort_order: 0,
    });
    assert.deepEqual(
      matchGlobalLorebookEntries([entry], "HTML을 사용해서 맛집 TOP5를 띄워줘"),
      [entry]
    );
    assert.deepEqual(matchGlobalLorebookEntries([entry], "맛집 html 카드"), []);
    assert.deepEqual(matchGlobalLorebookEntries([entry], "일반 대화"), []);
  });

  it("buildGlobalLorebookPromptBlock wraps matched content", () => {
    const block = buildGlobalLorebookPromptBlock([
      {
        id: 1,
        name: GLOBAL_LOREBOOK_HTML_VISUAL_CARD_NAME,
        triggers: ["HTML"],
        content: HTML_OUTPUT_OWNERSHIP_BLOCK,
        depth: 0,
        enabled: true,
        sortOrder: 0,
      },
    ]);
    assert.match(block, /GLOBAL LOREBOOK/);
    assert.match(block, /HTML OUTPUT OWNERSHIP/);
  });

  it("seedGlobalLorebookEntries creates single unified HTML entry", () => {
    const db = createTestDb();
    db.prepare(
      `INSERT INTO global_lorebook_entries (name, triggers_json, content, depth, enabled, sort_order)
       VALUES ('HTML Smartphone Messenger', '[]', 'legacy', 0, 1, 1)`
    ).run();
    seedGlobalLorebookEntries(db);
    seedGlobalLorebookEntries(db);
    const count = db
      .prepare("SELECT COUNT(*) AS c FROM global_lorebook_entries")
      .get() as { c: number };
    assert.equal(count.c, 1);
    const htmlRow = db
      .prepare("SELECT triggers_json, depth, content FROM global_lorebook_entries WHERE name = ?")
      .get(GLOBAL_LOREBOOK_HTML_VISUAL_CARD_NAME) as {
      triggers_json: string;
      depth: number;
      content: string;
    };
    assert.deepEqual(JSON.parse(htmlRow.triggers_json), GLOBAL_LOREBOOK_HTML_TRIGGERS);
    assert.equal(htmlRow.depth, 0);
    assert.match(htmlRow.content, /HTML OUTPUT OWNERSHIP/);
    assert.doesNotMatch(htmlRow.content, /HTML OUTPUT MODE/);
  });

  it("does not inject without explicit HTML output request", () => {
    const db = createTestDb();
    seedGlobalLorebookEntries(db);
    assert.equal(loadGlobalLorebookPromptBlock(db, "맛집 TOP5 카드로 보여줘"), "");
    assert.equal(loadGlobalLorebookPromptBlock(db, "카톡 대화 내역 보여줘"), "");
    assert.equal(loadGlobalLorebookPromptBlock(db, "경고창 띄워줘"), "");
  });

  it("injects server-only HTML block for explicit HTML requests", () => {
    const db = createTestDb();
    seedGlobalLorebookEntries(db);

    const restaurant = loadGlobalLorebookPromptBlock(
      db,
      "HTML을 사용해서 맛집 TOP5를 띄워줘",
      "HTML을 사용해서 맛집 TOP5를 띄워줘"
    );
    assert.match(restaurant, /HTML OUTPUT OWNERSHIP/);
    assert.match(restaurant, /Never generate/);
    assert.doesNotMatch(restaurant, /상태창 템플릿/);
    assert.doesNotMatch(restaurant, /REFERENCE TEMPLATE/);
    assert.doesNotMatch(restaurant, /HTML OUTPUT MODE/);
    assert.doesNotMatch(restaurant, /매 assistant reply마다/);

    const messenger = loadGlobalLorebookPromptBlock(
      db,
      "HTML을 사용해서 카톡 내역을 출력해줘",
      "HTML을 사용해서 카톡 내역을 출력해줘"
    );
    assert.match(messenger, /Never generate/);

    const alert = loadGlobalLorebookPromptBlock(
      db,
      "HTML을 사용해서 경고창을 표기해줘",
      "HTML을 사용해서 경고창을 표기해줘"
    );
    assert.match(alert, /Never generate/);
  });

  it("loadGlobalLorebookPromptBlock injects when scan text contains HTML output intent", () => {
    const db = createTestDb();
    seedGlobalLorebookEntries(db);
    const block = loadGlobalLorebookPromptBlock(db, "ooc: HTML 카드로 출력");
    assert.match(block, /HTML OUTPUT OWNERSHIP/);
    assert.equal(loadGlobalLorebookPromptBlock(db, "안녕"), "");
  });
});
