import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import {
  setTrpgInventoryEquipped,
  TRPG_INVENTORY_EQUIP_INVALID_MESSAGE,
  TRPG_INVENTORY_EQUIP_NOT_FOUND_MESSAGE,
  TRPG_INVENTORY_EQUIP_NOT_STARTED_MESSAGE,
} from "./engineInventory";
import { persistSheetInventory } from "./engineSheets";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import {
  addInventoryItem,
  consumeInventoryItem,
  createInventoryEntryId,
  inventoryFromUnits,
  parseStoredInventory,
  serializeInventory,
} from "./inventory";
import { ensureTrpgTables } from "./schema";
import { insertParticipant, loadCampaign } from "./store";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function startDeps(): TrpgEngineDeps {
  return {
    skipBilling: true,
    rollD20: () => 12,
    gmCall: async () => ({
      text: buildTrpgGmStructuredWireText("문이 열린다. 당신은 다음 한 수를 고른다.", {
        players: [],
        location: "문턱",
        next_round_context: "들어갈지",
        campaign_finished: false,
      }),
    }),
    botCall: async () => ({ text: "조심스럽게 문틀을 짚는다." }),
  };
}

async function startedSolo(db: Database.Database) {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps: startDeps() });
  const snap = loadTrpgSnapshot(db, campaignId, 1);
  assert.ok(snap);
  const participantId = snap.viewerParticipantId;
  assert.ok(participantId);
  return { campaignId, participantId };
}

function seedInventory(db: Database.Database, campaignId: number, participantId: number, units: string[]) {
  persistSheetInventory(db, {
    campaignId,
    participantId,
    inventory: inventoryFromUnits(units),
  });
}

function storedInventory(db: Database.Database, participantId: number) {
  const row = db
    .prepare(`SELECT inventory_json FROM trpg_character_sheets WHERE participant_id=?`)
    .get(participantId) as { inventory_json: string };
  return parseStoredInventory(row.inventory_json);
}

describe("TRPG live inventory equipped mutation", () => {
  it("rejects setup-only campaigns and does not reuse /sheet save", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const id = createInventoryEntryId("검");
    assert.throws(
      () => setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId: id, equipped: true }),
      new RegExp(TRPG_INVENTORY_EQUIP_NOT_STARTED_MESSAGE)
    );
    const sheet = readFileSync("src/lib/trpg/engineCreate.ts", "utf8");
    const route = readFileSync("src/app/api/trpg/campaigns/[id]/inventory/route.ts", "utf8");
    assert.match(sheet, /능력치는 시작 전에만 정할 수 있습니다/);
    assert.match(route, /setTrpgInventoryEquipped/);
    assert.doesNotMatch(route, /saveTrpgSheet/);
    db.close();
  });

  it("C/E/Y. SET true persists, reloads, and replays as true", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await startedSolo(db);
    seedInventory(db, campaignId, participantId, ["검", "검"]);
    const entryId = createInventoryEntryId("검");
    const first = setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: true });
    assert.equal(first.sheets.find((card) => card.isSelf)?.sheet.inventory[0]?.equipped, true);
    assert.equal(storedInventory(db, participantId)[0]?.equipped, true);
    const replay = setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: true });
    assert.equal(replay.sheets.find((card) => card.isSelf)?.sheet.inventory[0]?.equipped, true);
    db.close();
  });

  it("D/F. SET false persists and replays as false", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await startedSolo(db);
    seedInventory(db, campaignId, participantId, ["검"]);
    const entryId = createInventoryEntryId("검");
    setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: true });
    const off = setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: false });
    assert.equal(off.sheets.find((card) => card.isSelf)?.sheet.inventory[0]?.equipped, false);
    const replay = setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: false });
    assert.equal(replay.sheets.find((card) => card.isSelf)?.sheet.inventory[0]?.equipped, false);
    db.close();
  });

  it("G. unknown entry id is rejected with no mutation", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await startedSolo(db);
    seedInventory(db, campaignId, participantId, ["검"]);
    assert.throws(
      () => setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId: "inv_missing", equipped: true }),
      new RegExp(TRPG_INVENTORY_EQUIP_NOT_FOUND_MESSAGE)
    );
    assert.equal(storedInventory(db, participantId)[0]?.equipped, false);
    assert.throws(
      () => setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId: createInventoryEntryId("검"), equipped: "true" }),
      new RegExp(TRPG_INVENTORY_EQUIP_INVALID_MESSAGE)
    );
    db.close();
  });

  it("H. another human cannot mutate this sheet", async () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const camp = loadCampaign(db, campaignId)!;
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "미라" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "미라", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: startDeps() });
    const host = loadTrpgSnapshot(db, campaignId, 1);
    const hostParticipantId = host?.viewerParticipantId;
    assert.ok(hostParticipantId);
    seedInventory(db, campaignId, hostParticipantId, ["검"]);
    const entryId = createInventoryEntryId("검");
    assert.throws(
      () => setTrpgInventoryEquipped(db, { campaignId, userId: 2, entryId, equipped: true }),
      new RegExp(TRPG_INVENTORY_EQUIP_NOT_FOUND_MESSAGE)
    );
    assert.equal(storedInventory(db, hostParticipantId)[0]?.equipped, false);
    db.close();
  });

  it("J. AI companion inventory is not user-mutable", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await startedSolo(db);
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    writeSheet(db, campaignId, botId, "유나", EVEN_STATS, "폐역", ["전용유물"]);
    const relicId = createInventoryEntryId("전용유물");
    assert.throws(
      () => setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId: relicId, equipped: true }),
      new RegExp(TRPG_INVENTORY_EQUIP_NOT_FOUND_MESSAGE)
    );
    assert.equal(storedInventory(db, botId)[0]?.equipped, false);
    assert.equal(storedInventory(db, participantId).some((entry) => entry.name === "전용유물"), false);
    db.close();
  });

  it("K/L/M/N/O. add/remove/consume preserve equipped until the stack is gone", async () => {
    const db = memoryDb();
    const { campaignId, participantId } = await startedSolo(db);
    seedInventory(db, campaignId, participantId, ["검", "검", "검"]);
    const entryId = createInventoryEntryId("검");
    setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: true });
    persistSheetInventory(db, {
      campaignId,
      participantId,
      inventory: addInventoryItem(storedInventory(db, participantId), "검"),
    });
    assert.equal(storedInventory(db, participantId)[0]?.equipped, true);
    assert.equal(storedInventory(db, participantId)[0]?.quantity, 4);
    persistSheetInventory(db, {
      campaignId,
      participantId,
      inventory: consumeInventoryItem(storedInventory(db, participantId), "검").next,
    });
    assert.equal(storedInventory(db, participantId)[0]?.equipped, true);
    assert.equal(storedInventory(db, participantId)[0]?.quantity, 3);
    persistSheetInventory(db, {
      campaignId,
      participantId,
      inventory: inventoryFromUnits(["검"]),
    });
    setTrpgInventoryEquipped(db, { campaignId, userId: 1, entryId, equipped: true });
    persistSheetInventory(db, {
      campaignId,
      participantId,
      inventory: consumeInventoryItem(storedInventory(db, participantId), "검").next,
    });
    assert.deepEqual(storedInventory(db, participantId), []);
    persistSheetInventory(db, {
      campaignId,
      participantId,
      inventory: addInventoryItem([], "검"),
    });
    assert.equal(storedInventory(db, participantId)[0]?.equipped, false);
    db.close();
  });

  it("U. JSX/sandbox expose no inventory mutation bridge", () => {
    const sandbox = readFileSync("src/lib/jsxComponent/sandboxRuntime.ts", "utf8");
    const bridge = readFileSync("src/lib/jsxComponent/hostBridge.ts", "utf8");
    const dock = readFileSync("src/app/trpg/TrpgCommandDock.tsx", "utf8");
    for (const src of [sandbox, bridge]) {
      assert.doesNotMatch(src, /setInventory|setEquipped|mutateItem/);
    }
    assert.doesNotMatch(dock, /setInventory\(|mutateItem\(|function setEquipped/);
    const dice = readFileSync("src/lib/trpg/dice.ts", "utf8");
    const adj = readFileSync("src/lib/trpg/roundAdjudication.ts", "utf8");
    assert.doesNotMatch(dice, /equipment_modifier/);
    assert.doesNotMatch(adj, /equipment_modifier/);
    assert.match(readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8"), /\/inventory`, \{ entryId, equipped \}/);
    assert.match(serializeInventory(inventoryFromUnits(["검"])), /"equipped":false/);
  });
});
