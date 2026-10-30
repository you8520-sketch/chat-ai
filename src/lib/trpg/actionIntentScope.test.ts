import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { loadCampaignContext, persistCampaignContext } from "./campaignContext";
import { loadCampaignLedger, persistCampaignLedger } from "./campaignLedger";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { inventoryUnits, parseStoredInventory, type TrpgInventoryEntry } from "./inventory";
import { TRPG_MECHANICS_REFEREE_ENABLED_ENV } from "./mechanicsTypes";
import { loadFrozenAdjudicationDecision } from "./roundAdjudication";
import { ensureTrpgTables } from "./schema";

function gmText(narration = "폐허가 고요하다. 바람만 분다."): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: [],
    location: "폐허",
    next_round_context: "다음을 고른다",
    campaign_finished: false,
  });
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function withReferee<T>(fn: () => Promise<T>): Promise<T> {
  const key = TRPG_MECHANICS_REFEREE_ENABLED_ENV;
  const prev = process.env[key];
  process.env[key] = "0";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

function hostSheet(db: Database.Database, campaignId: number): {
  id: number;
  hp: number;
  inventory: TrpgInventoryEntry[];
} {
  const row = db
    .prepare(
      `SELECT participant_id AS id, hp, inventory_json AS inventoryJson
       FROM trpg_character_sheets WHERE campaign_id=? ORDER BY id ASC LIMIT 1`
    )
    .get(campaignId) as { id: number; hp: number; inventoryJson: string };
  return { id: row.id, hp: row.hp, inventory: parseStoredInventory(row.inventoryJson) };
}

function pinHost(db: Database.Database, hostId: number, hp: number, inventory: readonly string[]): void {
  db.prepare(`UPDATE trpg_character_sheets SET hp=?, max_hp=?, inventory_json=? WHERE participant_id=?`).run(
    hp,
    25,
    JSON.stringify(inventory),
    hostId
  );
}

type StoredAction = {
  id: number;
  round_id: number;
  action_type: string;
  selected_stat: string | null;
  body: string;
};

function latestAction(db: Database.Database, campaignId: number): StoredAction {
  const row = db
    .prepare(
      `SELECT s.id, s.round_id, s.action_type, s.selected_stat, s.body
       FROM trpg_action_submissions s
       JOIN trpg_rounds r ON r.id = s.round_id
       WHERE r.campaign_id=?
       ORDER BY s.id DESC LIMIT 1`
    )
    .get(campaignId) as StoredAction | undefined;
  assert.ok(row);
  return row;
}

function rollRows(db: Database.Database, submissionId: number): Array<{ stat_key: string; d20: number }> {
  return db.prepare(`SELECT stat_key, d20 FROM trpg_dice_rolls WHERE submission_id=?`).all(submissionId) as Array<{
    stat_key: string;
    d20: number;
  }>;
}

async function openTable(): Promise<{
  db: Database.Database;
  campaignId: number;
  hostId: number;
  users: string[];
  deps: TrpgEngineDeps;
}> {
  const db = memoryDb();
  const users: string[] = [];
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 16,
    rollDie: () => 4,
    gmCall: async ({ user }) => {
      users.push(user);
      const narration =
        users.length === 1
          ? "문이 보인다."
          : users.length % 2 === 0
            ? "장면이 이어진다. 바람만 분다."
            : "같은 결과가 다른 말로 남는다. 바람만 분다.";
      return { text: gmText(narration) };
    },
  };
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  const hostId = hostSheet(db, campaignId).id;
  return { db, campaignId, hostId, users, deps };
}

describe("committed-clause adjudication through submit, dice, inventory, and GM wire", () => {
  it("reading a potion's instructions does not spend it or change HP, and a real use does", async () => {
    await withReferee(async () => {
      const table = await openTable();
      pinHost(table.db, table.hostId, 10, ["회복약"]);
      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "회복약 사용법을 읽는다",
        actionType: "use_item",
        selectedStat: "cha",
      });
      const read = latestAction(table.db, table.campaignId);
      assert.equal(read.action_type, "free");
      assert.equal(read.selected_stat, null);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const readWire = table.users.at(-1) ?? "";
      assert.match(readWire, /회복약 사용법을 읽는다/);
      assert.match(readWire, /no_check/);
      assert.doesNotMatch(readWire, /ordinary_item_use/);
      assert.doesNotMatch(readWire, /check_required/);
      assert.equal(loadFrozenAdjudicationDecision(table.db, read.round_id, read.id)?.needsCheck, false);
      assert.equal(rollRows(table.db, read.id).length, 0);
      const afterRead = hostSheet(table.db, table.campaignId);
      assert.equal(afterRead.hp, 10);
      assert.deepEqual(inventoryUnits(afterRead.inventory), ["회복약"]);

      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "회복약을 사용한다",
        actionType: "free",
        selectedStat: "str",
      });
      const used = latestAction(table.db, table.campaignId);
      assert.equal(used.action_type, "use_item");
      assert.equal(used.selected_stat, null);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const useWire = table.users.at(-1) ?? "";
      assert.match(useWire, /ordinary_item_use/);
      assert.match(useWire, /회복약을 사용한다/);
      assert.equal(rollRows(table.db, used.id).length, 0);
      const afterUse = hostSheet(table.db, table.campaignId);
      assert.equal(afterUse.hp, 14);
      assert.deepEqual(inventoryUnits(afterUse.inventory), []);

      pinHost(table.db, table.hostId, 10, ["회복약"]);
      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "회복약을 사용한다. 고개를 끄덕인다.",
        actionType: "attack",
        selectedStat: "str",
      });
      const nodUse = latestAction(table.db, table.campaignId);
      assert.equal(nodUse.action_type, "use_item");
      assert.equal(nodUse.selected_stat, null);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const nodWire = table.users.at(-1) ?? "";
      assert.match(nodWire, /ordinary_item_use/);
      assert.match(nodWire, /회복약을 사용한다/);
      assert.equal(rollRows(table.db, nodUse.id).length, 0);
      const afterNodUse = hostSheet(table.db, table.campaignId);
      assert.equal(afterNodUse.hp, 14);
      assert.deepEqual(inventoryUnits(afterNodUse.inventory), []);

      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "회복약을 사용하지 않는다. 고개를 끄덕인다.",
      });
      const refusedUse = latestAction(table.db, table.campaignId);
      assert.equal(refusedUse.action_type, "free");
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      assert.doesNotMatch(table.users.at(-1) ?? "", /ordinary_item_use/);
      const afterRefused = hostSheet(table.db, table.campaignId);
      assert.equal(afterRefused.hp, 14);
      assert.deepEqual(inventoryUnits(afterRefused.inventory), []);

      await regenerateTrpgNarration(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const regenWire = table.users.at(-1) ?? "";
      assert.match(regenWire, /회복약을 사용한다/);
      assert.match(regenWire, /d20=none/);
      const afterRegen = hostSheet(table.db, table.campaignId);
      assert.equal(afterRegen.hp, 14);
      assert.deepEqual(inventoryUnits(afterRegen.inventory), []);
      assert.equal(rollRows(table.db, used.id).length, 0);
      table.db.close();
    });
  });

  it("spends only the item named in the consumption clause, and does not let the GM close an unrolled attack", async () => {
    await withReferee(async () => {
      const cases: Array<{ body: string; inventory: string[]; potion: number; bandage: number; hp: number }> = [
        { body: "회복약을 살펴본다. 붕대를 사용한다.", inventory: ["회복약", "붕대"], potion: 1, bandage: 0, hp: 14 },
        { body: "회복약을 살펴본다. 붕대를 사용한다.", inventory: ["붕대", "회복약"], potion: 1, bandage: 0, hp: 14 },
        { body: "회복약을 사용한다. 붕대를 살펴본다.", inventory: ["붕대", "회복약"], potion: 0, bandage: 1, hp: 14 },
        { body: "붕대를 사용하지 않는다. 회복약을 사용한다.", inventory: ["회복약", "붕대"], potion: 0, bandage: 1, hp: 14 },
        { body: "회복약 사용법을 읽는다. 붕대를 사용한다.", inventory: ["붕대", "회복약"], potion: 1, bandage: 0, hp: 14 },
        { body: "회복약을 바라보면서 붕대를 사용한다.", inventory: ["회복약", "붕대"], potion: 1, bandage: 0, hp: 14 },
        { body: "회복약을 바라보면서 붕대를 사용한다.", inventory: ["붕대", "회복약"], potion: 1, bandage: 0, hp: 14 },
      ];
      for (const sample of cases) {
        const table = await openTable();
        pinHost(table.db, table.hostId, 10, sample.inventory);
        submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body: sample.body });
        const stored = latestAction(table.db, table.campaignId);
        assert.equal(stored.action_type, "use_item", sample.body);
        assert.equal(stored.selected_stat, null);
        await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
        const after = hostSheet(table.db, table.campaignId);
        const units = inventoryUnits(after.inventory);
        assert.equal(units.filter((name) => name === "회복약").length, sample.potion, sample.body);
        assert.equal(units.filter((name) => name === "붕대").length, sample.bandage, sample.body);
        assert.equal(after.hp, sample.hp, sample.body);
        assert.equal(rollRows(table.db, stored.id).length, 0);
        table.db.close();
      }

      const table = await openTable();
      pinHost(table.db, table.hostId, 10, ["회복약"]);
      const body = "회복약을 사용한다. 경비를 공격한다.";
      submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body });
      const stored = latestAction(table.db, table.campaignId);
      assert.equal(stored.action_type, "use_item");
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const wire = table.users.at(-1) ?? "";
      assert.match(wire, /ordinary_item_use/);
      assert.match(wire, /AUTHORITATIVE HUMAN PC ACTION/);
      assert.match(wire, /회복약을 사용한다\. 경비를 공격한다\./);
      assert.match(wire, /unadjudicated=경비를 공격한다/);
      assert.doesNotMatch(wire, /check_required/);
      assert.equal(rollRows(table.db, stored.id).length, 0);
      const after = hostSheet(table.db, table.campaignId);
      assert.equal(after.hp, 14);
      assert.deepEqual(inventoryUnits(after.inventory), []);
      await regenerateTrpgNarration(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const regen = table.users.at(-1) ?? "";
      assert.match(regen, /unadjudicated=경비를 공격한다/);
      assert.match(regen, /ordinary_item_use|d20=none/);
      const afterRegen = hostSheet(table.db, table.campaignId);
      assert.equal(afterRegen.hp, 14);
      assert.deepEqual(inventoryUnits(afterRegen.inventory), []);

      const door = await openTable();
      pinHost(door.db, door.hostId, 10, ["회복약", "붕대"]);
      const doorBody = "회복약을 사용한다. 잠긴 철문을 힘껏 부순다.";
      submitTrpgAction(door.db, { campaignId: door.campaignId, userId: 1, body: doorBody });
      const doorStored = latestAction(door.db, door.campaignId);
      assert.equal(doorStored.action_type, "use_item");
      assert.equal(doorStored.selected_stat, null);
      await advanceTrpgCampaign(door.db, { campaignId: door.campaignId, userId: 1, deps: door.deps });
      const doorAfter = hostSheet(door.db, door.campaignId);
      assert.equal(doorAfter.hp, 14);
      assert.deepEqual(inventoryUnits(doorAfter.inventory), ["붕대"]);
      assert.equal(rollRows(door.db, doorStored.id).length, 0);
      const doorWire = door.users.at(-1) ?? "";
      assert.match(doorWire, /ordinary_item_use/);
      assert.match(doorWire, /unadjudicated=잠긴 철문을 힘껏 부순다/);
      assert.doesNotMatch(doorWire, /check_required/);
      await regenerateTrpgNarration(door.db, { campaignId: door.campaignId, userId: 1, deps: door.deps });
      const doorRegen = door.users.at(-1) ?? "";
      assert.match(doorRegen, /unadjudicated=잠긴 철문을 힘껏 부순다/);
      const doorAfterRegen = hostSheet(door.db, door.campaignId);
      assert.equal(doorAfterRegen.hp, 14);
      assert.deepEqual(inventoryUnits(doorAfterRegen.inventory), ["붕대"]);
      assert.equal(rollRows(door.db, doorStored.id).length, 0);
      door.db.close();
      table.db.close();
    });
  });

  it("a refused or quoted persuade does not roll, and a real persuade rolls charm", async () => {
    await withReferee(async () => {
      const table = await openTable();
      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "상대방을 설득하지 않는다",
        actionType: "persuade",
        selectedStat: "cha",
      });
      const refused = latestAction(table.db, table.campaignId);
      assert.equal(refused.action_type, "free");
      assert.equal(refused.selected_stat, null);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const refusedWire = table.users.at(-1) ?? "";
      assert.match(refusedWire, /reason=declined_act/);
      assert.match(refusedWire, /\[UNCOMMITTED /);
      assert.doesNotMatch(refusedWire, /check_required/);
      assert.equal(loadFrozenAdjudicationDecision(table.db, refused.round_id, refused.id)?.reason, "declined_act");
      assert.equal(rollRows(table.db, refused.id).length, 0);

      submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body: "「지금 공격하고 설득한다」" });
      const quoted = latestAction(table.db, table.campaignId);
      assert.equal(quoted.action_type, "free");
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      assert.equal(rollRows(table.db, quoted.id).length, 0);
      assert.equal(loadFrozenAdjudicationDecision(table.db, quoted.round_id, quoted.id)?.reason, "talk");
      assert.match(table.users.at(-1) ?? "", /「지금 공격하고 설득한다」/);
      assert.doesNotMatch(table.users.at(-1) ?? "", /uncommitted=quoted speech/);
      assert.match(table.users.at(-1) ?? "", /reason=talk/);
      assert.doesNotMatch(table.users.at(-1) ?? "", /check_required/);

      submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body: "상대방을 말로 설득한다" });
      const talk = latestAction(table.db, table.campaignId);
      assert.equal(talk.action_type, "persuade");
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const talkWire = table.users.at(-1) ?? "";
      assert.match(talkWire, /check_required/);
      assert.match(talkWire, /stat=(?:cha|.*\(cha\))/);
      const rolled = rollRows(table.db, talk.id);
      assert.equal(rolled.length, 1);
      assert.equal(rolled[0]?.stat_key, "cha");
      table.db.close();
    });
  });

  it("chases only the committed attack, and an unconfirmed door condition stays held", async () => {
    await withReferee(async () => {
      const table = await openTable();
      const ctx = loadCampaignContext(table.db, table.campaignId);
      assert.ok(ctx);
      ctx.localSceneProgress = { ...ctx.localSceneProgress, remainingBlockers: ["잠긴 문"] };
      persistCampaignContext(table.db, ctx);
      const ledger = loadCampaignLedger(table.db, table.campaignId);
      ledger.worldFlags = [...ledger.worldFlags, "문이 잠겨 있다"];
      const state = table.db
        .prepare(`SELECT round_number FROM trpg_campaign_state WHERE campaign_id=?`)
        .get(table.campaignId) as { round_number: number };
      persistCampaignLedger(table.db, table.campaignId, state.round_number, ledger);
      assert.ok(loadCampaignLedger(table.db, table.campaignId).worldFlags.includes("문이 잠겨 있다"));

      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "만약 적이 도망치면 쫓는다. 지금은 경비를 공격한다.",
      });
      const attack = latestAction(table.db, table.campaignId);
      assert.equal(attack.action_type, "attack");
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const attackRoll = rollRows(table.db, attack.id);
      assert.equal(attackRoll.length, 1);
      assert.equal(attackRoll[0]?.stat_key, "str");
      assert.match(table.users.at(-1) ?? "", /stat=(?:str|.*\(str\))/);
      const attackWire = table.users.at(-1) ?? "";
      assert.match(attackWire, /check_required/);
      assert.match(attackWire, /\[UNCOMMITTED uncommitted=만약 적이 도망치면 쫓는다/);
      assert.equal(loadFrozenAdjudicationDecision(table.db, attack.round_id, attack.id)?.needsCheck, true);

      await regenerateTrpgNarration(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const regen = table.users.at(-1) ?? "";
      assert.match(regen, /\[UNCOMMITTED uncommitted=만약 적이 도망치면 쫓는다/);
      assert.match(regen, /d20=16/);
      assert.equal(rollRows(table.db, attack.id).length, 1);

      submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body: "문이 잠겨 있으면 힘으로 부순다." });
      const held = latestAction(table.db, table.campaignId);
      assert.equal(held.action_type, "free");
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      assert.equal(rollRows(table.db, held.id).length, 0);
      assert.equal(loadFrozenAdjudicationDecision(table.db, held.round_id, held.id)?.reason, "conditional_hold");
      assert.match(table.users.at(-1) ?? "", /conditional_hold/);
      assert.doesNotMatch(table.users.at(-1) ?? "", /check_required/);

      submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body: "잠긴 문을 힘으로 부순다" });
      const smash = latestAction(table.db, table.campaignId);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      const smashRoll = rollRows(table.db, smash.id);
      assert.equal(smashRoll.length, 1);
      assert.equal(smashRoll[0]?.stat_key, "str");
      assert.match(table.users.at(-1) ?? "", /check_required/);
      table.db.close();
    });
  });

  it("a previously locked selected_stat still wins, and a new submit stores null", async () => {
    await withReferee(async () => {
      const table = await openTable();
      submitTrpgAction(table.db, {
        campaignId: table.campaignId,
        userId: 1,
        body: "검으로 벤다.",
        selectedStat: "cha",
        actionType: "free",
      });
      const fresh = latestAction(table.db, table.campaignId);
      assert.equal(fresh.action_type, "attack");
      assert.equal(fresh.selected_stat, null);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      assert.equal(rollRows(table.db, fresh.id)[0]?.stat_key, "str");

      submitTrpgAction(table.db, { campaignId: table.campaignId, userId: 1, body: "검으로 벤다." });
      const legacy = latestAction(table.db, table.campaignId);
      table.db.prepare(`UPDATE trpg_action_submissions SET selected_stat=? WHERE id=?`).run("cha", legacy.id);
      await advanceTrpgCampaign(table.db, { campaignId: table.campaignId, userId: 1, deps: table.deps });
      assert.equal(rollRows(table.db, legacy.id)[0]?.stat_key, "cha");
      assert.equal(latestAction(table.db, table.campaignId).selected_stat, "cha");
      table.db.close();
    });
  });
});
