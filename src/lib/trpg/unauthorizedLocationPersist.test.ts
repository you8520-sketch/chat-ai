import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadCampaignLedger } from "./campaignLedger";
import { loadSheetSnapshots } from "./engineSheets";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadCampaign } from "./store";
import { ensureTrpgTables } from "./schema";

const DOCK = "회린 부두";
const TAVERN = "회린 주점";
const MOON = "달을 주머니에 넣는다.";

/** Exact #1468 case F GM delta (public fields only). */
const CASE_F_DELTA = {
  players: [
    {
      participantId: 1,
      hp: 40,
      conditions: [],
      inventoryAdd: [],
      inventoryRemove: [],
      location: TAVERN,
    },
  ],
  location: TAVERN,
  next_round_context:
    "한결은 회린의 낡은 주점 안으로 들어섰다. 침묵하는 주인 갈대와 벽가의 손님들이 있고, 바깥으로는 성소로 향하는 어두운 골목길이 이어진다.",
  campaign_finished: false,
  storyPhase: "탐색",
  endingConditionId: "",
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmWire(narration: string, delta: Record<string, unknown>): string {
  return buildTrpgGmStructuredWireText(narration, delta);
}

async function startAtDock(db: Database.Database, gmResolveText: string): Promise<{
  campaignId: number;
  deps: TrpgEngineDeps;
}> {
  let gmCalls = 0;
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 10,
    gmCall: async () => {
      gmCalls += 1;
      if (gmCalls === 1) {
        return {
          text: gmWire("부두에 안개가 끼어 있다. 달이 하늘에 있다.", {
            players: [{ participantId: 1, location: DOCK, hp: 40, conditions: [] }],
            location: DOCK,
            next_round_context: "다음 행동은 플레이어가 고른다.",
            campaign_finished: false,
          }),
        };
      }
      return { text: gmResolveText };
    },
  };
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "한결", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "한결", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  const opened = loadCampaignLedger(db, campaignId);
  assert.equal(opened.location, DOCK);
  return { campaignId, deps };
}

describe("TRPG #1462 unauthorized location persist", () => {
  it("fail-before #1468 F: undeclared dock-to-tavern GM delta must not become ledger/sheet location", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("달은 하늘에 남고 한결은 주점 문을 열고 들어갔다.", CASE_F_DELTA)
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: MOON });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const ledger = loadCampaignLedger(db, campaignId);
    const sheet = loadSheetSnapshots(db, campaignId)[0];
    assert.equal(ledger.location, DOCK);
    assert.equal(sheet?.location, DOCK);
    assert.doesNotMatch(ledger.nextRoundContext, /주점 안/);
    db.close();
  });

  it("explicit declared traversal still persists the GM location", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("한결이 주점 문턱을 넘었다.", {
        players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
        location: TAVERN,
        next_round_context: "주점 안에서 다음을 고른다.",
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: "주점으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const ledger = loadCampaignLedger(db, campaignId);
    assert.equal(ledger.location, TAVERN);
    assert.equal(loadSheetSnapshots(db, campaignId)[0]?.location, TAVERN);
    db.close();
  });

  it("걸어간다 naming the destination still persists — existing verb list misses 걷", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("한결이 주점으로 걸어 들어갔다.", {
        players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
        location: TAVERN,
        next_round_context: "주점 안.",
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: "주점으로 걸어간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadCampaignLedger(db, campaignId).location, TAVERN);
    db.close();
  });

  it("does not relocate a second PC who did not declare movement", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "한결", viewerUserId: 1 });
    const camp = loadCampaign(db, campaignId)!;
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "미르" });
    const ids = db
      .prepare(`SELECT id, user_id AS userId FROM trpg_participants WHERE campaign_id=? AND kind='human'`)
      .all(campaignId) as Array<{ id: number; userId: number }>;
    const hangId = ids.find((row) => row.userId === 1)?.id;
    const mirId = ids.find((row) => row.userId === 2)?.id;
    assert.ok(hangId && mirId);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 10,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) {
          return {
            text: gmWire("두 사람이 부두에 서 있다.", {
              players: [
                { participantId: hangId, location: DOCK, hp: 40, conditions: [] },
                { participantId: mirId, location: DOCK, hp: 40, conditions: [] },
              ],
              location: DOCK,
              next_round_context: "다음.",
              campaign_finished: false,
            }),
          };
        }
        return {
          text: gmWire("둘 다 주점에 있다.", {
            players: [
              { participantId: hangId, location: TAVERN, hp: 40, conditions: [] },
              { participantId: mirId, location: TAVERN, hp: 40, conditions: [] },
            ],
            location: TAVERN,
            next_round_context: "주점.",
            campaign_finished: false,
          }),
        };
      },
    };
    saveTrpgSheet(db, { campaignId, userId: 1, name: "한결", stats: EVEN_STATS });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "미르", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "주점으로 간다." });
    submitTrpgAction(db, { campaignId, userId: 2, body: MOON });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const sheets = loadSheetSnapshots(db, campaignId);
    const hang = sheets.find((s) => s.name === "한결");
    const mir = sheets.find((s) => s.name === "미르");
    assert.equal(hang?.location, TAVERN);
    assert.equal(mir?.location, DOCK);
    assert.equal(loadCampaignLedger(db, campaignId).location, TAVERN);
    db.close();
  });

  it("player-only location field still persists when traversal is declared", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("한결이 주점 문턱을 넘었다.", {
        players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: "주점으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadCampaignLedger(db, campaignId).location, TAVERN);
    assert.equal(loadSheetSnapshots(db, campaignId)[0]?.location, TAVERN);
    db.close();
  });

  it("player-only tavern field stays rejected when no movement was declared", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("달은 하늘에 남았다.", {
        players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: MOON });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadCampaignLedger(db, campaignId).location, DOCK);
    assert.equal(loadSheetSnapshots(db, campaignId)[0]?.location, DOCK);
    db.close();
  });

  it("T9/L5: NPC/world forced relocation without submitted movement does not persist", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("안개가 덮치며 한결을 끌어갔다.", {
        players: [{ participantId: 1, location: "적 소굴", hp: 40, conditions: [] }],
        location: "적 소굴",
        next_round_context: "적 소굴 안에서 다음을 고른다.",
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: "주변을 살핀다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadCampaignLedger(db, campaignId).location, DOCK);
    assert.equal(loadSheetSnapshots(db, campaignId)[0]?.location, DOCK);
    db.close();
  });

  it("regenerate does not apply a later tavern location over a dock commit", async () => {
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 10,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) {
          return {
            text: gmWire("부두.", {
              players: [{ participantId: 1, location: DOCK, hp: 40, conditions: [] }],
              location: DOCK,
              next_round_context: "다음.",
              campaign_finished: false,
            }),
          };
        }
        if (gmCalls === 2) {
          return {
            text: gmWire("달이 남았다.", {
              players: [{ participantId: 1, location: DOCK, hp: 40, conditions: [] }],
              location: DOCK,
              next_round_context: "부두에서 고른다.",
              campaign_finished: false,
            }),
          };
        }
        return {
          text: gmWire("재생 서술에서 주점으로 옮긴다.", {
            players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
            location: TAVERN,
            next_round_context: "주점.",
            campaign_finished: false,
          }),
        };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "한결", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "한결", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: MOON });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadCampaignLedger(db, campaignId).location, DOCK);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.equal(loadCampaignLedger(db, campaignId).location, DOCK);
    assert.equal(loadSheetSnapshots(db, campaignId)[0]?.location, DOCK);
    db.close();
  });
});
