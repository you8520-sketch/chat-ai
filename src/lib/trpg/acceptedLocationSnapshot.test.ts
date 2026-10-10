import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import {
  loadAcceptedRoundLocation,
  loadCampaignLedger,
  persistAcceptedRoundLocationIfAbsent,
  persistCampaignLedger,
} from "./campaignLedger";
import { loadSheetSnapshots } from "./engineSheets";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadTrpgIllustrationScene } from "./illustrationCast";
import { buildTrpgRoundSourceText } from "./roundSource";
import { loadCampaign } from "./store";
import { ensureTrpgTables } from "./schema";

const DOCK = "회린 부두";
const TAVERN = "회린 주점";
const MOON = "달을 주머니에 넣는다.";
const TEAHOUSE_ENTER = "열린 찻집 문으로 들어간다.";
const TEAHOUSE_C_1465 = "석등 골목 찻집 내부";
const TEAHOUSE_C_1480 = "석등 골목 찻집 안";

const CASE_F_DELTA = {
  players: [{ participantId: 1, hp: 40, conditions: [], location: TAVERN }],
  location: TAVERN,
  next_round_context:
    "한결은 회린의 낡은 주점 안으로 들어섰다. 침묵하는 주인 갈대와 벽가의 손님들이 있고, 바깥으로는 성소로 향하는 어두운 골목길이 이어진다.",
  campaign_finished: false,
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmWire(narration: string, delta: Record<string, unknown>): string {
  return buildTrpgGmStructuredWireText(narration, delta);
}

function latestGmRound(db: Database.Database, campaignId: number): { id: number; n: number } {
  const row = db
    .prepare(
      `SELECT r.id AS id, r.round_number AS n FROM trpg_rounds r
       JOIN trpg_gm_messages g ON g.round_id = r.id
       WHERE r.campaign_id=?
       ORDER BY r.round_number DESC LIMIT 1`
    )
    .get(campaignId) as { id: number; n: number };
  return row;
}

function sourceFor(db: Database.Database, campaignId: number, viewerUserId: number, roundNumber: number) {
  const scene = loadTrpgIllustrationScene(db, { campaignId, viewerUserId, roundNumber });
  return { scene, source: scene ? buildTrpgRoundSourceText(scene) : "" };
}

async function startAtDock(db: Database.Database, resolveText: string) {
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
      return { text: resolveText };
    },
  };
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "한결", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "한결", stats: EVEN_STATS });
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, deps };
}

describe("TRPG #1481 accepted round location snapshot", () => {
  let prevReferee: string | undefined;
  let prevDirector: string | undefined;

  before(() => {
    prevReferee = process.env.TRPG_MECHANICS_REFEREE_ENABLED;
    prevDirector = process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    process.env.TRPG_MECHANICS_REFEREE_ENABLED = "0";
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
  });

  after(() => {
    if (prevReferee === undefined) delete process.env.TRPG_MECHANICS_REFEREE_ENABLED;
    else process.env.TRPG_MECHANICS_REFEREE_ENABLED = prevReferee;
    if (prevDirector === undefined) delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
    else process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = prevDirector;
  });

  it("adds nullable accepted_location without backfilling existing rounds", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE trpg_rounds (
        id INTEGER PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        phase TEXT NOT NULL
      )
    `);
    ensureTrpgTables(db);
    const col = (
      db.prepare(`PRAGMA table_info(trpg_rounds)`).all() as Array<{ name: string; notnull: number }>
    ).find((row) => row.name === "accepted_location");
    assert.ok(col);
    assert.equal(col.notnull, 0);
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (1, 1, 0, 'ROUND_COMPLETE')`).run();
    assert.equal(loadAcceptedRoundLocation(db, 1), null);
    db.close();
  });

  it("F: unauthorized tavern GM dest stays dock on ledger, snapshot, and 장소 metadata", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("달은 하늘에 남고 한결은 주점 문을 열고 들어갔다.", CASE_F_DELTA)
    );
    const opening = latestGmRound(db, campaignId);
    submitTrpgAction(db, { campaignId, userId: 1, body: MOON });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const f = latestGmRound(db, campaignId);
    const { scene, source } = sourceFor(db, campaignId, 1, f.n);
    assert.equal(loadCampaignLedger(db, campaignId).location, DOCK);
    assert.equal(loadSheetSnapshots(db, campaignId)[0]?.location, DOCK);
    assert.equal(loadAcceptedRoundLocation(db, f.id), DOCK);
    assert.equal(scene?.location, DOCK);
    assert.match(source, /^장소: 회린 부두$/m);
    assert.doesNotMatch(source, /^장소: 회린 주점$/m);
    const openingSource = sourceFor(db, campaignId, 1, opening.n);
    assert.equal(openingSource.scene?.location, DOCK);
    assert.match(openingSource.source, /^장소: 회린 부두$/m);
    db.close();
  });

  it("C_1465: authorized tea-house interior is the illustration place", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("한결이 열린 찻집 문으로 들어갔다.", {
        players: [{ participantId: 1, location: TEAHOUSE_C_1465, hp: 40, conditions: [] }],
        location: TEAHOUSE_C_1465,
        next_round_context: "찻집 안에서 다음을 고른다.",
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: TEAHOUSE_ENTER });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = latestGmRound(db, campaignId);
    const { scene, source } = sourceFor(db, campaignId, 1, round.n);
    assert.equal(loadCampaignLedger(db, campaignId).location, TEAHOUSE_C_1465);
    assert.equal(loadAcceptedRoundLocation(db, round.id), TEAHOUSE_C_1465);
    assert.equal(scene?.location, TEAHOUSE_C_1465);
    assert.match(source, /^장소: 석등 골목 찻집 내부$/m);
    db.close();
  });

  it("C_1480: authorized tea-house interior variant is the illustration place", async () => {
    const db = memoryDb();
    const { campaignId, deps } = await startAtDock(
      db,
      gmWire("한결이 열린 찻집 문으로 들어갔다.", {
        players: [{ participantId: 1, location: TEAHOUSE_C_1480, hp: 40, conditions: [] }],
        location: TEAHOUSE_C_1480,
        next_round_context: "찻집 안에서 다음을 고른다.",
        campaign_finished: false,
      })
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: TEAHOUSE_ENTER });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = latestGmRound(db, campaignId);
    const { source } = sourceFor(db, campaignId, 1, round.n);
    assert.equal(loadAcceptedRoundLocation(db, round.id), TEAHOUSE_C_1480);
    assert.match(source, /^장소: 석등 골목 찻집 안$/m);
    db.close();
  });

  it("keeps round N dock after N+1 authorized tavern move", async () => {
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
              campaign_finished: false,
            }),
          };
        }
        if (gmCalls === 2) {
          return {
            text: gmWire("달은 하늘에 남고 한결은 주점 문을 열고 들어갔다.", CASE_F_DELTA),
          };
        }
        return {
          text: gmWire("한결이 주점 문턱을 넘었다.", {
            players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
            location: TAVERN,
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
    const f = latestGmRound(db, campaignId);
    submitTrpgAction(db, { campaignId, userId: 1, body: "주점으로 간다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const moved = latestGmRound(db, campaignId);
    assert.equal(loadCampaignLedger(db, campaignId).location, TAVERN);
    assert.equal(sourceFor(db, campaignId, 1, f.n).scene?.location, DOCK);
    assert.match(sourceFor(db, campaignId, 1, f.n).source, /^장소: 회린 부두$/m);
    assert.equal(sourceFor(db, campaignId, 1, moved.n).scene?.location, TAVERN);
    assert.match(sourceFor(db, campaignId, 1, moved.n).source, /^장소: 회린 주점$/m);
    db.close();
  });

  it("regenerate leaves the accepted snapshot unchanged when GM RAW location changes", async () => {
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
              campaign_finished: false,
            }),
          };
        }
        if (gmCalls === 2) {
          return {
            text: gmWire("달이 남았다.", {
              players: [{ participantId: 1, location: DOCK, hp: 40, conditions: [] }],
              location: DOCK,
              campaign_finished: false,
            }),
          };
        }
        return {
          text: gmWire("재생 서술에서 주점으로 옮긴다.", {
            players: [{ participantId: 1, location: TAVERN, hp: 40, conditions: [] }],
            location: TAVERN,
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
    const round = latestGmRound(db, campaignId);
    const before = loadAcceptedRoundLocation(db, round.id);
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const gm = db
      .prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=?`)
      .get(round.id) as { structured_json: string };
    const rawGm = JSON.parse(gm.structured_json) as { location?: string; delta?: { location?: string } };
    assert.equal(rawGm.location ?? rawGm.delta?.location, TAVERN);
    assert.equal(loadAcceptedRoundLocation(db, round.id), before);
    assert.equal(loadAcceptedRoundLocation(db, round.id), DOCK);
    assert.equal(sourceFor(db, campaignId, 1, round.n).scene?.location, DOCK);
    db.close();
  });

  it("omits 장소 when a legacy round has NULL accepted_location", async () => {
    const db = memoryDb();
    const { campaignId } = await startAtDock(
      db,
      gmWire("달은 하늘에 남고 한결은 주점 문을 열고 들어갔다.", CASE_F_DELTA)
    );
    const opening = latestGmRound(db, campaignId);
    db.prepare(`UPDATE trpg_rounds SET accepted_location=NULL WHERE id=?`).run(opening.id);
    const { scene, source } = sourceFor(db, campaignId, 1, opening.n);
    assert.equal(scene?.location, "");
    assert.doesNotMatch(source, /^장소:/m);
    db.close();
  });

  it("does not claim one place for split-party sheets", async () => {
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
            text: gmWire("한결은 부두, 미르는 주점에 있다.", {
              players: [
                { participantId: hangId, location: DOCK, hp: 40, conditions: [] },
                { participantId: mirId, location: TAVERN, hp: 40, conditions: [] },
              ],
              location: DOCK,
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
            campaign_finished: false,
          }),
        };
      },
    };
    saveTrpgSheet(db, { campaignId, userId: 1, name: "한결", stats: EVEN_STATS });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "미르", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const opening = latestGmRound(db, campaignId);
    assert.equal(loadAcceptedRoundLocation(db, opening.id), null);
    assert.doesNotMatch(sourceFor(db, campaignId, 1, opening.n).source, /^장소:/m);
    submitTrpgAction(db, { campaignId, userId: 1, body: MOON });
    submitTrpgAction(db, { campaignId, userId: 2, body: "주점 안을 살핀다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const next = latestGmRound(db, campaignId);
    const sheets = loadSheetSnapshots(db, campaignId);
    assert.equal(sheets.find((s) => s.name === "한결")?.location, DOCK);
    assert.equal(sheets.find((s) => s.name === "미르")?.location, TAVERN);
    assert.equal(loadAcceptedRoundLocation(db, next.id), null);
    assert.doesNotMatch(sourceFor(db, campaignId, 1, next.n).source, /^장소:/m);
    db.close();
  });

  it("blocks a stranger viewer", async () => {
    const db = memoryDb();
    const { campaignId } = await startAtDock(db, gmWire("부두.", { location: DOCK, campaign_finished: false }));
    const opening = latestGmRound(db, campaignId);
    assert.equal(
      loadTrpgIllustrationScene(db, { campaignId, viewerUserId: 99, roundNumber: opening.n }),
      null
    );
    db.close();
  });

  it("retry does not overwrite a committed snapshot", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title, status) VALUES (1, 1, 'T', 'ACTIVE')`).run();
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (10, 1, 1, 'ROUND_COMPLETE')`).run();
    persistAcceptedRoundLocationIfAbsent(db, 10, DOCK);
    persistAcceptedRoundLocationIfAbsent(db, 10, TAVERN);
    assert.equal(loadAcceptedRoundLocation(db, 10), DOCK);
    db.close();
  });

  it("rolls snapshot back with ledger when the commit transaction fails", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title, status) VALUES (1, 1, 'T', 'ACTIVE')`).run();
    db.prepare(
      `INSERT INTO trpg_campaign_state (campaign_id, round_number, location) VALUES (1, 0, ?)`
    ).run(DOCK);
    db.prepare(`INSERT INTO trpg_rounds (id, campaign_id, round_number, phase) VALUES (10, 1, 1, 'APPLYING_STATE')`).run();
    assert.throws(() => {
      db.transaction(() => {
        persistCampaignLedger(db, 1, 1, {
          location: TAVERN,
          nextRoundContext: "",
          quests: [],
          npcs: [],
          worldFlags: [],
        });
        persistAcceptedRoundLocationIfAbsent(db, 10, TAVERN);
        throw new Error("commit failed");
      })();
    });
    assert.equal(loadCampaignLedger(db, 1).location, DOCK);
    assert.equal(loadAcceptedRoundLocation(db, 10), null);
    db.close();
  });
});
