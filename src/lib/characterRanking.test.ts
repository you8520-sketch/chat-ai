import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  DEFAULT_RANKING_PERIOD,
  fetchCharacterRanking,
  parseRankingPeriod,
  RANKING_PERIODS,
  rankingEmptyMessage,
  rankingMetric,
  rankingPeriodDesc,
  type RankingPeriod,
} from "@/lib/characterRanking";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

const NO_FILTER = { filter: "", params: [] as unknown[] };
const SFW_ONLY = { filter: "AND c.nsfw=0", params: [] as unknown[] };

function names(period: RankingPeriod, filter = NO_FILTER): string[] {
  return fetchCharacterRanking(getDb(), period, filter.filter, filter.params).map((c) => c.name);
}

function counts(period: RankingPeriod, filter = NO_FILTER): Record<string, number> {
  return Object.fromEntries(
    fetchCharacterRanking(getDb(), period, filter.filter, filter.params).map((c) => [c.name, c.period_chats]),
  );
}

describe("ranking default period", () => {
  it("falls back to the single canonical default for missing and unknown values", () => {
    assert.equal(DEFAULT_RANKING_PERIOD, "all");
    for (const raw of [undefined, "", "bogus", "ALL", "all ", "__proto__", "0"]) {
      assert.equal(parseRankingPeriod(raw), DEFAULT_RANKING_PERIOD, `raw=${String(raw)}`);
    }
  });

  it("keeps every explicit period id and lists the default first", () => {
    for (const id of ["realtime", "daily", "weekly", "monthly", "all"] as const) {
      assert.equal(parseRankingPeriod(id), id);
    }
    assert.deepEqual(
      RANKING_PERIODS.map((p) => p.id),
      ["all", "realtime", "daily", "weekly", "monthly"],
    );
    assert.equal(RANKING_PERIODS[0].id, DEFAULT_RANKING_PERIOD);
  });

  it("keeps the period descriptions and builds exact empty-state copy", () => {
    assert.equal(rankingPeriodDesc("all"), "누적 대화 턴");
    assert.equal(rankingPeriodDesc("realtime"), "최근 6시간 대화 시작 수");
    assert.equal(rankingEmptyMessage("realtime"), "최근 6시간 동안 대화가 시작된 캐릭터가 없습니다.");
    assert.equal(rankingEmptyMessage("daily"), "최근 24시간 동안 대화가 시작된 캐릭터가 없습니다.");
    assert.equal(rankingEmptyMessage("weekly"), "최근 7일 동안 대화가 시작된 캐릭터가 없습니다.");
    assert.equal(rankingEmptyMessage("monthly"), "최근 30일 동안 대화가 시작된 캐릭터가 없습니다.");
    assert.equal(rankingEmptyMessage("all"), "아직 랭킹에 표시할 캐릭터가 없습니다.");
  });
});

describe("ranking aggregation and visibility are unchanged", () => {
  let creatorId = 0;

  function insertCharacter(opts: {
    name: string;
    turns: number;
    visibility?: string;
    moderation?: string;
    nsfw?: number;
    official?: number;
    creator?: boolean;
  }): number {
    const info = getDb()
      .prepare(
        `INSERT INTO characters
          (name, tagline, description, greeting, system_prompt, genre, tags, nsfw, official,
           emoji, hue, creator_id, creator_name, visibility, moderation_status, total_turns)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        opts.name,
        "tag",
        "desc",
        "hi",
        "sys",
        "로맨스",
        "[]",
        opts.nsfw ?? 0,
        opts.official ?? 0,
        "✨",
        200,
        opts.creator === false ? null : creatorId,
        "제작자",
        opts.visibility ?? "public",
        opts.moderation ?? "approved",
        opts.turns,
      );
    return Number(info.lastInsertRowid);
  }

  function insertChat(characterId: number, ago: string) {
    getDb()
      .prepare(`INSERT INTO chats (user_id, character_id, created_at) VALUES (?, ?, datetime('now', ?))`)
      .run(creatorId, characterId, ago);
  }

  before(() => {
    installIsolatedTestDatabase();
    const db = getDb();
    creatorId = Number(
      db.prepare(`INSERT INTO users (email, nickname, pw_hash, points) VALUES ('rank@test.local', 'rank', 'x', 0)`).run()
        .lastInsertRowid,
    );
    const a = insertCharacter({ name: "공개A", turns: 40 });
    insertCharacter({ name: "공개B", turns: 7 });
    const c = insertCharacter({ name: "비공개C", turns: 999, visibility: "private" });
    const d = insertCharacter({ name: "대기D", turns: 500, moderation: "pending" });
    const e = insertCharacter({ name: "성인E", turns: 100, nsfw: 1 });
    const f = insertCharacter({ name: "공식F", turns: 3, official: 1, creator: false });
    insertChat(a, "-10 days");
    insertChat(c, "-1 hours");
    insertChat(d, "-1 hours");
    insertChat(e, "-1 hours");
    insertChat(f, "-2 hours");
  });

  after(() => {
    uninstallIsolatedTestDatabase();
  });

  it("all-time ranks by accumulated turns and hides private or unapproved characters", () => {
    assert.deepEqual(names("all"), ["성인E", "공개A", "공개B", "공식F"]);
    assert.deepEqual(counts("all"), { 성인E: 100, 공개A: 40, 공개B: 7, 공식F: 3 });
  });

  it("every period keeps the adult filter", () => {
    assert.deepEqual(names("all", SFW_ONLY), ["공개A", "공개B", "공식F"]);
    for (const period of ["realtime", "daily", "weekly", "monthly"] as const) {
      assert.ok(!names(period, SFW_ONLY).includes("성인E"), period);
    }
  });

  it("time windows count chat starts only and are empty when nothing started recently", () => {
    assert.deepEqual(counts("realtime"), { 성인E: 1, 공식F: 1 });
    assert.deepEqual(counts("daily"), { 성인E: 1, 공식F: 1 });
    assert.deepEqual(counts("weekly"), { 성인E: 1, 공식F: 1 });
    assert.deepEqual(counts("monthly"), { 성인E: 1, 공식F: 1, 공개A: 1 });
    assert.deepEqual(names("realtime", SFW_ONLY), ["공식F"]);
  });

  it("a window with no chat starts is empty while all-time still has rows", () => {
    getDb().prepare(`DELETE FROM chats WHERE created_at >= datetime('now', '-3 days')`).run();
    assert.deepEqual(names("realtime"), []);
    assert.deepEqual(names("daily"), []);
    assert.deepEqual(names("weekly"), []);
    assert.deepEqual(names("monthly"), ["공개A"]);
    assert.equal(names("all").length, 4);
  });

  it("returns nothing for any period when no character is listable", () => {
    getDb().prepare(`DELETE FROM characters`).run();
    for (const { id } of RANKING_PERIODS) {
      assert.deepEqual(names(id), [], id);
    }
  });
});

describe("rankingMetric", () => {
  it("labels all-time as cumulative turns and every window as chat starts", () => {
    assert.deepEqual(rankingMetric("all"), { label: "누적 대화", unit: "턴", basis: "누적 대화 턴 수 기준" });
    for (const { id, window } of RANKING_PERIODS) {
      if (id === "all") continue;
      const metric = rankingMetric(id);
      assert.equal(metric.label, "대화 시작", id);
      assert.equal(metric.unit, "회", id);
      assert.ok(metric.basis.includes(window), `${id}: ${metric.basis}`);
    }
  });
});
