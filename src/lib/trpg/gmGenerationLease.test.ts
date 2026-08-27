import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  GM_MAX_PROVIDER_ATTEMPTS,
  GM_PROVIDER_5XX_RETRY_DELAY_MS,
  GM_PROVIDER_TIMEOUT_MS,
  healthyGmProviderWallMs,
} from "./gmCall";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import {
  beginGmGenerationLease,
  buildTrpgOrphanGenerationErrorJson,
  clearGmGenerationLease,
  gmGenerationInFlight,
  GM_STALE_SAFETY_BUFFER_MS,
  GM_STALE_THRESHOLD_MS,
  gmStaleReclaimEligible,
  isGmGenerationLeaseStaleOnDb,
  reconcileStaleRerollGeneration,
  refreshGmGenerationHeartbeat,
  resolveGmLeaseState,
  tryTerminalizeStaleOrphan,
} from "./gmGenerationLease";
import { savePendingGmResult } from "./pendingGmResult";
import { parseTrpgGmOutput } from "./gmPrompt";
import { ensureTrpgTables } from "./schema";
import { parseTrpgStartFailureJson } from "./startFailure";
import { shouldKickTrpgAdvance } from "./roundWorkKick";
import { loadLatestRound } from "./store";

const NARRATION = "문이 천천히 열린다.";
const GM_TEXT = `<<<NARRATION>>>
${NARRATION}
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`;

function gmText(n = NARRATION): string {
  return `<<<NARRATION>>>
${n}
<<<DELTA>>>
{"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false}`;
}

function installLedger(db: Database.Database): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT,
      nickname TEXT NOT NULL,
      points REAL NOT NULL DEFAULT 0,
      creator_points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      creator_id INTEGER,
      official INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  installLedger(db);
  return db;
}

function seedStuckGmRound(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundId?: number;
    requestId?: string;
    phase?: string;
    heartbeatAgeSec?: number;
    pending?: boolean;
    gmMessage?: boolean;
    processStage?: string | null;
  }
): { roundId: number; requestId: string } {
  const requestId = opts.requestId ?? "req-stuck";
  const roundId =
    opts.roundId ??
    Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id)
           VALUES (?, 1, ?, ?, ?)`
        )
        .run(opts.campaignId, opts.phase ?? "GENERATING_NARRATION", requestId, requestId).lastInsertRowid
    );
  db.prepare(
    `UPDATE trpg_rounds
     SET gm_generation_started_at = datetime('now', ?),
         gm_generation_heartbeat_at = datetime('now', ?),
         process_stage = COALESCE(?, process_stage),
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(`-${opts.heartbeatAgeSec ?? 500} seconds`, `-${opts.heartbeatAgeSec ?? 500} seconds`, opts.processStage ?? null, roundId);
  if (opts.pending) {
    savePendingGmResult(db, roundId, parseTrpgGmOutput(GM_TEXT));
  }
  if (opts.gmMessage) {
    db.prepare(`INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (?,?,?)`).run(
      roundId,
      NARRATION,
      JSON.stringify(parseTrpgGmOutput(GM_TEXT))
    );
  }
  return { roundId, requestId };
}

describe("GM generation lease", () => {
  it("A healthy lease heartbeat is in flight and not stale", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 5 });
    beginGmGenerationLease(db, roundId, requestId);
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(gmGenerationInFlight(db, round), true);
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), false);
    assert.equal(resolveGmLeaseState(db, roundId, round.phase, round.gm_generation_id).status, "healthy");
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), false);
    db.close();
  });

  it("B heartbeat younger than threshold is not reclaimed", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 30 });
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), false);
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), false);
    db.close();
  });

  it("C stale orphan with no message and no pending terminalizes to ERROR_RECOVERY", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(resolveGmLeaseState(db, roundId, "GENERATING_NARRATION", "req-stuck").status, "stale_orphan");
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), false);
    const row = db.prepare(`SELECT phase, gm_generation_id, error_json FROM trpg_rounds WHERE id=?`).get(roundId) as {
      phase: string;
      gm_generation_id: string | null;
      error_json: string;
    };
    assert.equal(row.phase, "ERROR_RECOVERY");
    assert.equal(row.gm_generation_id, null);
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.kind, "orphan_generation");
    db.close();
  });

  it("D stale pending resolves through advance without provider recall", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        throw new Error("provider must not be called");
      },
    };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500, pending: true });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.match(snap.currentNarration ?? "", /문이/);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("E stale persisted GM message reconciles without provider recall", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    let providerCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        providerCalls += 1;
        return { text: gmText("should not run") };
      },
    };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500, gmMessage: true });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(providerCalls, 0);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /문이/);
    db.close();
  });

  it("F old request heartbeat is CAS-rejected after reclaim", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    assert.equal(refreshGmGenerationHeartbeat(db, roundId, "req-stuck"), false);
    db.close();
  });

  it("G duplicate orphan reclaim attempts: exactly one wins", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    const wins = [tryTerminalizeStaleOrphan(db, roundId), tryTerminalizeStaleOrphan(db, roundId)];
    assert.deepEqual(wins, [true, false]);
    db.close();
  });

  it("H stale lease makes poll kick advance for server recovery", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(gmStaleReclaimEligible(db, roundId, round.phase, round.gm_generation_id), true);
    assert.equal(
      shouldKickTrpgAdvance({
        workType: "idle",
        phase: "GENERATING_NARRATION",
        botGenerationInFlight: false,
        gmGenerationInFlight: false,
        gmStaleReclaimEligible: true,
      }),
      true
    );
    db.close();
  });

  it("stale reroll generation reverts to ROUND_COMPLETE without provider", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ROUND_COMPLETE')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      processStage: "reroll",
    });
    reconcileStaleRerollGeneration(db, roundId);
    const row = db.prepare(`SELECT phase, gm_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as {
      phase: string;
      gm_generation_id: string | null;
    };
    assert.equal(row.phase, "ROUND_COMPLETE");
    assert.equal(row.gm_generation_id, null);
    db.close();
  });

  it("healthy two-attempt provider wall is below stale threshold", () => {
    const wall = healthyGmProviderWallMs(GM_PROVIDER_TIMEOUT_MS, GM_MAX_PROVIDER_ATTEMPTS, GM_PROVIDER_5XX_RETRY_DELAY_MS);
    assert.equal(wall, GM_PROVIDER_TIMEOUT_MS * GM_MAX_PROVIDER_ATTEMPTS + GM_PROVIDER_5XX_RETRY_DELAY_MS);
    assert.ok(GM_STALE_THRESHOLD_MS > wall);
    assert.equal(GM_STALE_THRESHOLD_MS, wall + GM_STALE_SAFETY_BUFFER_MS);
  });

  it("orphan error json uses orphan_generation kind", () => {
    const parsed = JSON.parse(buildTrpgOrphanGenerationErrorJson()) as { kind: string; class: string };
    assert.equal(parsed.kind, "orphan_generation");
    assert.equal(parsed.class, "B");
  });

  it("provider timeout still reaches ERROR_RECOVERY via existing catch", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => {
        throw new Error("TimeoutError: aborted");
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { ...deps, gmCall: async () => ({ text: gmText("open") }) },
    });
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(round.phase, "ERROR_RECOVERY");
    assert.equal(round.gm_generation_id, null);
    assert.equal(round.gm_generation_heartbeat_at, null);
    assert.notEqual(parseTrpgStartFailureJson(round.error_json)?.kind, "orphan_generation");
    db.close();
  });

  it("orphan recovery does not double-bill or duplicate GM messages", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500, gmMessage: true });
    db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=42 WHERE id=?`).run(roundId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const msgCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM trpg_gm_messages WHERE round_id=?`).get(roundId) as { n: number }
    ).n;
    const billed = (db.prepare(`SELECT billed_points FROM trpg_rounds WHERE id=?`).get(roundId) as { billed_points: number })
      .billed_points;
    assert.equal(msgCount, 1);
    assert.equal(billed, 42);
    db.close();
  });

  it("clearGmGenerationLease is scoped to matching request id", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 5 });
    clearGmGenerationLease(db, roundId, "other-request");
    const row = db.prepare(`SELECT gm_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as {
      gm_generation_id: string;
    };
    assert.equal(row.gm_generation_id, requestId);
    clearGmGenerationLease(db, roundId, requestId);
    const cleared = db.prepare(`SELECT gm_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as {
      gm_generation_id: string | null;
    };
    assert.equal(cleared.gm_generation_id, null);
    db.close();
  });
});
