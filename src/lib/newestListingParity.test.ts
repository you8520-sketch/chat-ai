import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

type HomeSections = typeof import("@/lib/homeSections");
let getDb: typeof import("@/lib/db").getDb;
let sections: HomeSections;
let creatorId: number;

type Seed = {
  name: string;
  official?: number;
  visibility?: string;
  moderation?: string;
  nsfw?: number;
  audience?: string;
  createdAt: string;
  creator?: number | null;
};

function insertCharacter(seed: Seed): number {
  const db = getDb();
  const creator = seed.creator === undefined ? creatorId : seed.creator;
  const info = db
    .prepare(
      `INSERT INTO characters
        (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official, audience,
         emoji, hue, creator_id, creator_name, visibility, moderation_status, images, assets, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      seed.name, "tag", "d", "hi", "s", "로맨스", "[]", seed.nsfw ?? 0, seed.official ?? 0,
      seed.audience ?? "all", "✨", 260, creator, "제작자", seed.visibility ?? "public",
      seed.moderation ?? "approved", "[]", "[]", seed.createdAt
    );
  return Number(info.lastInsertRowid);
}

function clearCharacters() {
  getDb().exec("DELETE FROM characters");
}

function homeNewest(user: { pref?: string | null } | null, blurNsfw: boolean): string[] {
  return sections
    .fetchNewestCharacters(getDb(), sections.buildHomeListFilter(user, blurNsfw))
    .map((c) => c.name);
}

describe("home 신규 캐릭터 and /tab/new share one exposure rule", () => {
  before(async () => {
    installIsolatedTestDatabase();
    ({ getDb } = await import("@/lib/db"));
    sections = await import("@/lib/homeSections");
    const info = getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash) VALUES ('newest-parity@example.com', 'parity', 'x')")
      .run();
    creatorId = Number(info.lastInsertRowid);
  });
  after(() => uninstallIsolatedTestDatabase());

  it("lists official and ordinary public characters newest first, excluding private and pending", () => {
    clearCharacters();
    insertCharacter({ name: "일반-오래됨", createdAt: "2026-01-01 00:00:00" });
    insertCharacter({ name: "공식-최신", official: 1, createdAt: "2026-03-01 00:00:00" });
    insertCharacter({ name: "일반-중간", createdAt: "2026-02-01 00:00:00" });
    insertCharacter({ name: "비공개", visibility: "private", createdAt: "2026-04-01 00:00:00" });
    insertCharacter({ name: "검수대기", moderation: "pending", createdAt: "2026-04-02 00:00:00" });
    insertCharacter({ name: "제작자없음-비공식", creator: null, createdAt: "2026-04-03 00:00:00" });
    assert.deepEqual(homeNewest(null, false), ["공식-최신", "일반-중간", "일반-오래됨"]);
  });

  it("keeps adult and taste filters for official and ordinary characters alike", () => {
    clearCharacters();
    insertCharacter({ name: "공식-성인", official: 1, nsfw: 1, createdAt: "2026-03-01 00:00:00" });
    insertCharacter({ name: "일반-성인", nsfw: 1, createdAt: "2026-03-02 00:00:00" });
    insertCharacter({ name: "공식-남성향", official: 1, audience: "male", createdAt: "2026-03-03 00:00:00" });
    insertCharacter({ name: "일반-전체", createdAt: "2026-03-04 00:00:00" });
    assert.deepEqual(homeNewest(null, true), ["일반-전체", "공식-남성향"]);
    assert.deepEqual(homeNewest({ pref: "female" }, true), ["일반-전체"]);
    assert.deepEqual(homeNewest({ pref: "male" }, false), ["일반-전체", "공식-남성향", "일반-성인", "공식-성인"]);
  });

  it("handles zero, one and many characters, honoring the larger /tab/new limit", () => {
    clearCharacters();
    assert.deepEqual(homeNewest(null, false), []);
    insertCharacter({ name: "단독", official: 1, createdAt: "2026-03-01 00:00:00" });
    assert.deepEqual(homeNewest(null, false), ["단독"]);
    clearCharacters();
    for (let i = 0; i < 60; i += 1) {
      insertCharacter({
        name: `c${String(i).padStart(2, "0")}`,
        official: i % 2,
        createdAt: `2026-03-01 00:${String(i).padStart(2, "0")}:00`,
      });
    }
    const db = getDb();
    const filter = sections.buildHomeListFilter(null, false);
    const home = sections.fetchNewestCharacters(db, filter);
    const tab = sections.fetchNewestCharacters(db, filter, 50);
    assert.equal(home.length, 25);
    assert.equal(tab.length, 50);
    assert.deepEqual(tab.slice(0, 25).map((c) => c.id), home.map((c) => c.id));
    assert.ok(tab.some((c) => c.official === 1) && tab.some((c) => c.official === 0));
  });

  it("serves /tab/new from the same owner instead of a separate official-excluding query", () => {
    const tabPage = fs.readFileSync(path.join(process.cwd(), "src/app/tab/[tab]/page.tsx"), "utf8");
    const newCase = tabPage.slice(tabPage.indexOf('case "new":'), tabPage.indexOf('case "ranking":'));
    assert.match(newCase, /fetchNewestCharacters\(/);
    assert.match(newCase, /buildHomeListFilter\(user, blurNsfw\)/);
    assert.doesNotMatch(newCase, /official\s*=\s*0/);
  });
});
