import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { insertParticipant } from "./store";
import { ensureTrpgTables } from "./schema";
import { DEFAULT_TRPG_STAT_DEFS, defsFromKeys, floorStats } from "./stats";
import { TRPG_MAX_BOTS, TRPG_ROUND_PHASES } from "./types";
import {
  computeResolutionOrder,
  parseResolutionOrder,
  pickInitiativeStat,
  sortByResolutionOrder,
} from "./initiative";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "장면"): string {
  return `<<<NARRATION>>>
${narration}
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"다음","campaign_finished":false}`;
}

describe("TRPG initiative resolution order", () => {
  it("prefers spd, then dex, then slotIndex, high value first", () => {
    const withSpd = pickInitiativeStat({ spd: 14, dex: 9 }, defsFromKeys(["spd", "dex"]));
    assert.equal(withSpd.statKey, "spd");
    assert.equal(withSpd.statValue, 14);
    const withDex = pickInitiativeStat({ dex: 12, str: 8 }, DEFAULT_TRPG_STAT_DEFS);
    assert.equal(withDex.statKey, "dex");
    assert.equal(withDex.statLabel, "민첩");
    const fallback = pickInitiativeStat({ str: 8 }, []);
    assert.equal(fallback.statKey, null);
    assert.equal(fallback.statValue, 0);

    const order = computeResolutionOrder(
      [
        { participantId: 1, name: "이현", slotIndex: 0, stats: { spd: 9 } },
        { participantId: 2, name: "렌", slotIndex: 1, stats: { spd: 14 } },
        { participantId: 3, name: "태현", slotIndex: 2, stats: { spd: 14 } },
      ],
      defsFromKeys(["spd"])
    );
    assert.deepEqual(
      order.map((row) => row.participantId),
      [2, 3, 1]
    );
  });

  it("does not change input generation order and keeps bot #2 seeing bot #1", async () => {
    const db = memoryDb();
    const botUsers: string[] = [];
    let botCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async ({ user }) => {
        if (user.includes("화물칸을 연다")) {
          assert.match(user, /\[RESOLUTION ORDER\]/);
          assert.match(user, /카이 — 속도 15/);
          assert.match(user, /유나 — 속도 8/);
        }
        return { text: gmText("순서") };
      },
      botCall: async (_system, user) => {
        botCalls += 1;
        botUsers.push(user);
        if (user.includes("[NAME]\n유나")) return { text: "유나-먼저" };
        return { text: "카이-다음" };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: { ...floorStats(DEFAULT_TRPG_STAT_DEFS), dex: 6 } });
    const yuna = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    const kai = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "카이",
    });
    writeSheet(db, campaignId, yuna, "유나", { ...EVEN_STATS, spd: 8 }, "");
    writeSheet(db, campaignId, kai, "카이", { ...EVEN_STATS, spd: 15 }, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "화물칸을 연다." });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(TRPG_MAX_BOTS, 2);
    assert.equal(botCalls, 2);
    assert.equal(botUsers.length, 2);
    assert.match(botUsers[0] ?? "", /\[NAME\]\n유나/);
    assert.doesNotMatch(botUsers[0] ?? "", /유나-먼저/);
    assert.match(botUsers[1] ?? "", /\[NAME\]\n카이/);
    assert.match(botUsers[1] ?? "", /유나-먼저/);
    assert.deepEqual(
      (after.resolutionOrder ?? []).map((row) => row.name),
      ["카이", "유나", "렌"]
    );
    const snap = db
      .prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { input_snapshot_json: string };
    const firstOrder = parseResolutionOrder(JSON.parse(snap.input_snapshot_json));
    assert.deepEqual(
      firstOrder.map((row) => row.name),
      ["카이", "유나", "렌"]
    );
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const again = db
      .prepare(`SELECT input_snapshot_json FROM trpg_rounds WHERE campaign_id=? AND round_number=1`)
      .get(campaignId) as { input_snapshot_json: string };
    assert.deepEqual(parseResolutionOrder(JSON.parse(again.input_snapshot_json)), firstOrder);
    assert.ok(TRPG_ROUND_PHASES.includes("ACTION_INPUT"));
    assert.ok(TRPG_ROUND_PHASES.includes("BOT_ACTION"));
    assert.equal(after.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("keeps the existing d20 result formula and only reorders display", async () => {
    const db = memoryDb();
    const rolls = [18, 7];
    let i = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => rolls[i++] ?? 10,
      gmCall: async () => ({ text: gmText() }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const camp = (await import("./store")).loadCampaign(db, campaignId)!;
    const { joinTrpgCampaign } = await import("./engineCreate");
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "태현" });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: { ...floorStats(DEFAULT_TRPG_STAT_DEFS), dex: 7 } });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "태현", stats: { ...floorStats(DEFAULT_TRPG_STAT_DEFS), dex: 14 } });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 어깨로 민다.", actionType: "attack" });
    submitTrpgAction(db, { campaignId, userId: 2, body: "그늘에 숨는다.", actionType: "stealth" });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const resolved = after.log.find((row) => row.roundNumber === 1);
    assert.equal(resolved?.rolls[0]?.name, "태현");
    assert.equal(resolved?.rolls[1]?.name, "렌");
    const byName = new Map((resolved?.rolls ?? []).map((row) => [row.name, row]));
    assert.equal(byName.get("렌")?.d20, 18);
    assert.equal(byName.get("태현")?.d20, 7);
    db.close();
  });

  it("sorts an existing list by stored resolution order", () => {
    const sorted = sortByResolutionOrder(
      [{ participantId: 1 }, { participantId: 3 }, { participantId: 2 }],
      [
        { participantId: 3, name: "a", slotIndex: 2, statKey: "spd", statLabel: "속도", statValue: 15 },
        { participantId: 1, name: "b", slotIndex: 0, statKey: "spd", statLabel: "속도", statValue: 10 },
        { participantId: 2, name: "c", slotIndex: 1, statKey: "spd", statLabel: "속도", statValue: 8 },
      ]
    );
    assert.deepEqual(
      sorted.map((row) => row.participantId),
      [3, 1, 2]
    );
  });
});
