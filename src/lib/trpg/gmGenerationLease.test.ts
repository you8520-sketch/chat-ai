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
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import {
  beginGmGenerationLease,
  buildTrpgOrphanGenerationErrorJson,
  clearGmGenerationLease,
  currentGenerationCommitted,
  finalizeGmRoundForGeneration,
  finalizeRerollForGeneration,
  gmGenerationInFlight,
  gmGenerationOwnsToken,
  GM_HEARTBEAT_STALE_MS,
  GM_LEGACY_STALE_MS,
  GM_LEGACY_STALE_SAFETY_BUFFER_MS,
  gmStaleReclaimEligible,
  isGmGenerationLeaseStaleOnDb,
  markGmGenerationCommitted,
  refreshGmGenerationHeartbeat,
  resolveGmLeaseState,
  tryClaimStaleGmRecovery,
  tryPersistGmRoundFailure,
  tryRevertStaleRerollGeneration,
  tryTerminalizeStaleOrphan,
} from "./gmGenerationLease";
import { savePendingGmResult, savePendingGmResultForGeneration } from "./pendingGmResult";
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

type SeedOpts = {
  campaignId: number;
  roundId?: number;
  requestId?: string;
  phase?: string;
  heartbeatAgeSec?: number | null;
  legacyUpdatedAgeSec?: number;
  pending?: boolean;
  pendingGenerationId?: string;
  gmMessage?: boolean;
  committedGenerationId?: string;
  processStage?: string | null;
};

function seedStuckGmRound(
  db: Database.Database,
  opts: SeedOpts
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

  if (opts.heartbeatAgeSec === null) {
    db.prepare(
      `UPDATE trpg_rounds
       SET gm_generation_started_at = NULL,
           gm_generation_heartbeat_at = NULL,
           process_stage = COALESCE(?, process_stage),
           updated_at = datetime('now', ?)
       WHERE id = ?`
    ).run(opts.processStage ?? null, `-${opts.legacyUpdatedAgeSec ?? 500} seconds`, roundId);
  } else {
    const age = opts.heartbeatAgeSec ?? 500;
    db.prepare(
      `UPDATE trpg_rounds
       SET gm_generation_started_at = datetime('now', ?),
           gm_generation_heartbeat_at = datetime('now', ?),
           process_stage = COALESCE(?, process_stage),
           updated_at = datetime('now', ?)
       WHERE id = ?`
    ).run(`-${age} seconds`, `-${age} seconds`, opts.processStage ?? null, `-${age} seconds`, roundId);
  }

  if (opts.pending) {
    const genId = opts.pendingGenerationId ?? requestId;
    savePendingGmResult(db, roundId, parseTrpgGmOutput(GM_TEXT), [], genId);
  }
  if (opts.gmMessage) {
    db.prepare(`INSERT INTO trpg_gm_messages (round_id, narration, structured_json) VALUES (?,?,?)`).run(
      roundId,
      NARRATION,
      JSON.stringify(parseTrpgGmOutput(GM_TEXT))
    );
  }
  if (opts.committedGenerationId) {
    db.prepare(`UPDATE trpg_rounds SET gm_committed_generation_id=? WHERE id=?`).run(
      opts.committedGenerationId,
      roundId
    );
  }
  return { roundId, requestId };
}

describe("GM generation lease and fencing", () => {
  it("1 new normal generation lease records started and heartbeat timestamps", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 0 });
    beginGmGenerationLease(db, roundId, requestId);
    const row = db
      .prepare(
        `SELECT gm_generation_started_at, gm_generation_heartbeat_at, gm_committed_generation_id
         FROM trpg_rounds WHERE id=?`
      )
      .get(roundId) as {
      gm_generation_started_at: string;
      gm_generation_heartbeat_at: string;
      gm_committed_generation_id: string | null;
    };
    assert.ok(row.gm_generation_started_at);
    assert.ok(row.gm_generation_heartbeat_at);
    assert.equal(row.gm_committed_generation_id, null);
    db.close();
  });

  it("2 heartbeat refresh updates persisted liveness", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 30 });
    beginGmGenerationLease(db, roundId, requestId);
    assert.equal(refreshGmGenerationHeartbeat(db, roundId, requestId), true);
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), false);
    db.close();
  });

  it("3 healthy heartbeat generation is in flight and not stale", () => {
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
    db.close();
  });

  it("4 stale heartbeat-backed generation is classified stale", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const staleSec = Math.ceil(GM_HEARTBEAT_STALE_MS / 1000) + 10;
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: staleSec });
    beginGmGenerationLease(db, roundId, requestId);
    db.prepare(`UPDATE trpg_rounds SET gm_generation_heartbeat_at=datetime('now', ?) WHERE id=?`).run(
      `-${staleSec} seconds`,
      roundId
    );
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), true);
    assert.equal(resolveGmLeaseState(db, roundId, "GENERATING_NARRATION", requestId).status, "stale_orphan");
    db.close();
  });

  it("5 legacy null heartbeat recent row is not stale", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: null,
      legacyUpdatedAgeSec: 60,
    });
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), false);
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), false);
    db.close();
  });

  it("6 legacy null heartbeat old row is stale orphan", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const legacySec = Math.ceil(GM_LEGACY_STALE_MS / 1000) + 10;
    const { roundId, requestId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: null,
      legacyUpdatedAgeSec: legacySec,
    });
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), true);
    assert.equal(resolveGmLeaseState(db, roundId, "GENERATING_NARRATION", requestId).status, "stale_orphan");
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    const row = db.prepare(`SELECT phase, gm_generation_id, error_json FROM trpg_rounds WHERE id=?`).get(roundId) as {
      phase: string;
      gm_generation_id: string | null;
      error_json: string;
    };
    assert.equal(row.phase, "ERROR_RECOVERY");
    assert.equal(row.gm_generation_id, null);
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.kind, "gm_generation_orphan_reclaimed");
    db.close();
  });

  it("7 stale normal orphan terminalizes to ERROR_RECOVERY without provider", async () => {
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
    seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    assert.equal(snap.gmFailureKind, "gm_generation_orphan_reclaimed");
    db.close();
  });

  it("8 stale pending commits salvage only without provider recall", async () => {
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
    const { roundId, requestId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      pending: true,
      pendingGenerationId: "req-stuck",
    });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(providerCalls, 0);
    assert.match(snap.currentNarration ?? "", /문이/);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.equal(currentGenerationCommitted(db, roundId, requestId), true);
    db.close();
  });

  it("9 stale committed generation reconciles terminal state without provider", async () => {
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
    seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      committedGenerationId: "req-stuck",
    });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(providerCalls, 0);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /문이/);
    db.close();
  });

  it("10 stale reroll without current commit preserves old scene", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        throw new Error("provider must not be called");
      },
    };
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
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ROUND_COMPLETE");
    const msg = db.prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`).get(roundId) as {
      narration: string;
    };
    assert.match(msg.narration, /문이/);
    db.close();
  });

  it("11 stale reroll with current commit finishes reroll without provider", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ROUND_COMPLETE')`).run()
        .lastInsertRowid
    );
    seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      committedGenerationId: "req-stuck",
      processStage: "reroll",
    });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ROUND_COMPLETE");
    db.close();
  });

  it("12 opening orphan becomes recoverable ERROR_RECOVERY", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id)
           VALUES (?, 0, 'GENERATING_NARRATION', 'open-a', 'open-a')`
        )
        .run(campaignId).lastInsertRowid
    );
    db.prepare(
      `UPDATE trpg_rounds
       SET gm_generation_heartbeat_at=datetime('now', '-600 seconds'),
           updated_at=datetime('now', '-600 seconds')
       WHERE id=?`
    ).run(roundId);
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    assert.equal(snap.gmFailureKind, "gm_generation_orphan_reclaimed");
    db.close();
  });

  it("13 ERROR_RECOVERY retry acquires a new generation token", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => ({ text: gmText("recovered") }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { ...deps, gmCall: async () => ({ text: gmText("open") }) },
    });
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다" });
    await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: {
        ...deps,
        gmCall: async () => {
          throw new Error("TimeoutError: aborted");
        },
      },
    });
    const failed = loadLatestRound(db, campaignId)!;
    assert.equal(failed.phase, "ERROR_RECOVERY");
    assert.equal(failed.gm_generation_id, null);
    let capturedToken: string | null = null;
    await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: {
        ...deps,
        gmCall: async () => {
          const row = db
            .prepare(`SELECT gm_generation_id FROM trpg_rounds WHERE id=?`)
            .get(failed.id) as { gm_generation_id: string | null };
          capturedToken = row.gm_generation_id;
          return { text: gmText("recovered") };
        },
      },
    });
    assert.ok(capturedToken);
    assert.match(capturedToken!, /^[0-9a-f]{24}$/);
    db.close();
  });

  it("14 duplicate orphan reclaim: exactly one CAS wins", () => {
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

  it("15 old-token heartbeat is rejected after reclaim", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    assert.equal(refreshGmGenerationHeartbeat(db, roundId, requestId), false);
    db.close();
  });

  it("16 old-token success commit is rejected after new owner", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='GENERATING_NARRATION', gm_generation_id='token-b', lock_holder_request_id='token-b'
       WHERE id=?`
    ).run(roundId);
    assert.equal(markGmGenerationCommitted(db, roundId, requestId, requestId), false);
    assert.equal(gmGenerationOwnsToken(db, roundId, requestId), false);
    db.close();
  });

  it("17 old-token failure overwrite is rejected", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    assert.equal(tryPersistGmRoundFailure(db, roundId, requestId, buildTrpgOrphanGenerationErrorJson()), false);
    const row = db.prepare(`SELECT phase, error_json FROM trpg_rounds WHERE id=?`).get(roundId) as {
      phase: string;
      error_json: string;
    };
    assert.equal(row.phase, "ERROR_RECOVERY");
    assert.equal(parseTrpgStartFailureJson(row.error_json)?.kind, "gm_generation_orphan_reclaimed");
    db.close();
  });

  it("18 old owner resume: all fenced mutations rejected after reclaim", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId: tokenA } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), true);
    const tokenB = "token-b-new";
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='GENERATING_NARRATION', gm_generation_id=?, lock_holder_request_id=?,
           gm_generation_heartbeat_at=datetime('now'), gm_generation_started_at=datetime('now')
       WHERE id=?`
    ).run(tokenB, tokenB, roundId);
    assert.equal(refreshGmGenerationHeartbeat(db, roundId, tokenA), false);
    assert.equal(gmGenerationOwnsToken(db, roundId, tokenA), false);
    assert.equal(markGmGenerationCommitted(db, roundId, tokenA, tokenA), false);
    assert.equal(tryPersistGmRoundFailure(db, roundId, tokenA, buildTrpgOrphanGenerationErrorJson()), false);
    assert.equal(gmGenerationOwnsToken(db, roundId, tokenB), true);
    db.close();
  });

  it("19 orphan committed recovery does not double-bill", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      committedGenerationId: "req-stuck",
    });
    db.prepare(`UPDATE trpg_rounds SET billed=1, billed_points=42 WHERE id=?`).run(roundId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const billed = (db.prepare(`SELECT billed_points FROM trpg_rounds WHERE id=?`).get(roundId) as { billed_points: number })
      .billed_points;
    assert.equal(billed, 42);
    db.close();
  });

  it("20 orphan recovery does not duplicate GM messages", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      committedGenerationId: "req-stuck",
    });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const msgCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM trpg_gm_messages WHERE round_id=?`).get(roundId) as { n: number }
    ).n;
    assert.equal(msgCount, 1);
    db.close();
  });

  it("21 stale orphan does not create duplicate next round", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    const before = (
      db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }
    ).n;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = (
      db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }
    ).n;
    assert.equal(before, after);
    db.close();
  });

  it("22 process restart fixture: snapshot kick reclaims orphaned generation", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: null,
      legacyUpdatedAgeSec: Math.ceil(GM_LEGACY_STALE_MS / 1000) + 30,
    });
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(
      shouldKickTrpgAdvance({
        workType: "idle",
        phase: "GENERATING_NARRATION",
        botGenerationInFlight: false,
        gmGenerationInFlight: false,
        gmStaleReclaimEligible: gmStaleReclaimEligible(db, roundId, round.phase, round.gm_generation_id),
      }),
      true
    );
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ERROR_RECOVERY");
    db.close();
  });

  it("23 healthy provider wall fits inside legacy stale grace", () => {
    const wall = healthyGmProviderWallMs(
      GM_PROVIDER_TIMEOUT_MS,
      GM_MAX_PROVIDER_ATTEMPTS,
      GM_PROVIDER_5XX_RETRY_DELAY_MS
    );
    assert.equal(wall, GM_PROVIDER_TIMEOUT_MS * GM_MAX_PROVIDER_ATTEMPTS + GM_PROVIDER_5XX_RETRY_DELAY_MS);
    assert.ok(GM_LEGACY_STALE_MS > wall);
    assert.equal(GM_LEGACY_STALE_MS, wall + GM_LEGACY_STALE_SAFETY_BUFFER_MS);
  });

  it("24 provider timeout still reaches ERROR_RECOVERY via existing catch", async () => {
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
    assert.notEqual(parseTrpgStartFailureJson(round.error_json)?.kind, "gm_generation_orphan_reclaimed");
    db.close();
  });

  it("25 reroll old GM message alone is not treated as current-generation success", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ROUND_COMPLETE')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      processStage: "reroll",
    });
    assert.equal(resolveGmLeaseState(db, roundId, "GENERATING_NARRATION", requestId).status, "stale_reroll_orphan");
    assert.notEqual(resolveGmLeaseState(db, roundId, "GENERATING_NARRATION", requestId).status, "stale_committed");
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

  it("stale reroll revert helper preserves ROUND_COMPLETE", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ROUND_COMPLETE')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      processStage: "reroll",
    });
    assert.equal(tryRevertStaleRerollGeneration(db, roundId, requestId), true);
    const row = db.prepare(`SELECT phase, gm_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as {
      phase: string;
      gm_generation_id: string | null;
    };
    assert.equal(row.phase, "ROUND_COMPLETE");
    assert.equal(row.gm_generation_id, null);
    db.close();
  });

  it("orphan error json uses gm_generation_orphan_reclaimed kind", () => {
    const parsed = JSON.parse(buildTrpgOrphanGenerationErrorJson()) as { kind: string; class: string };
    assert.equal(parsed.kind, "gm_generation_orphan_reclaimed");
    assert.equal(parsed.class, "B");
  });
});

describe("GM generation lifecycle races", () => {
  it("A normal complete uses explicit generation token and creates next round once", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => ({ text: gmText("done") }),
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { ...deps, gmCall: async () => ({ text: gmText("open") }) },
    });
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞으로 간다" });
    const beforeRounds = (
      db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }
    ).n;
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const afterRounds = (
      db.prepare(`SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=?`).get(campaignId) as { n: number }
    ).n;
    assert.equal(afterRounds, beforeRounds + 1);
    const latest = loadLatestRound(db, campaignId)!;
    assert.equal(latest.phase, "ACTION_INPUT");
    assert.equal(latest.gm_generation_id, null);
    db.close();
  });

  it("B crash after canonical commit recovers via stale committed path", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      gmMessage: true,
      committedGenerationId: "req-stuck",
    });
    db.prepare(`UPDATE trpg_rounds SET phase='APPLYING_STATE' WHERE id=?`).run(roundId);
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("C APPLYING_STATE without owner gap is not produced by finalize", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id, gm_committed_generation_id)
           VALUES (?, 1, 'APPLYING_STATE', 'token-a', 'token-a')`
        )
        .run(campaignId).lastInsertRowid
    );
    assert.equal(
      finalizeGmRoundForGeneration(db, {
        campaignId,
        roundId,
        roundNumber: 1,
        leaseOwnerId: "token-a",
        committedGenerationId: "token-a",
        campaignFinished: false,
      }),
      true
    );
    const row = db.prepare(`SELECT phase, gm_generation_id FROM trpg_rounds WHERE id=?`).get(roundId) as {
      phase: string;
      gm_generation_id: string | null;
    };
    assert.equal(row.phase, "ROUND_COMPLETE");
    assert.equal(row.gm_generation_id, null);
    const gap = db
      .prepare(
        `SELECT 1 FROM trpg_rounds WHERE id=? AND phase='APPLYING_STATE' AND gm_generation_id IS NULL`
      )
      .get(roundId);
    assert.equal(gap, undefined);
    db.close();
  });

  it("D stale pending recovery: only recovery owner B may commit", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = { skipBilling: true };
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId: tokenA } = seedStuckGmRound(db, {
      campaignId,
      heartbeatAgeSec: 500,
      pending: true,
      pendingGenerationId: "req-stuck",
    });
    assert.equal(gmGenerationOwnsToken(db, roundId, tokenA), true);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmGenerationOwnsToken(db, roundId, tokenA), false);
    assert.equal(currentGenerationCommitted(db, roundId, tokenA), true);
    db.close();
  });

  it("E stale committed recovery rejects old owner finalization", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_generation_id, gm_committed_generation_id)
           VALUES (?, 1, 'APPLYING_STATE', 'token-a', 'token-a')`
        )
        .run(campaignId).lastInsertRowid
    );
    db.prepare(
      `UPDATE trpg_rounds
       SET gm_generation_heartbeat_at=datetime('now', '-600 seconds'),
           updated_at=datetime('now', '-600 seconds')
       WHERE id=?`
    ).run(roundId);
    const tokenB = "token-b";
    assert.equal(tryClaimStaleGmRecovery(db, roundId, "token-a", tokenB, "applying_state"), true);
    assert.equal(
      finalizeGmRoundForGeneration(db, {
        campaignId,
        roundId,
        roundNumber: 1,
        leaseOwnerId: "token-a",
        committedGenerationId: "token-a",
        campaignFinished: false,
      }),
      false
    );
    assert.equal(
      finalizeGmRoundForGeneration(db, {
        campaignId,
        roundId,
        roundNumber: 1,
        leaseOwnerId: tokenB,
        committedGenerationId: "token-a",
        campaignFinished: false,
      }),
      true
    );
    db.close();
  });

  it("F heartbeat refresh beats orphan reclaim CAS", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), true);
    assert.equal(refreshGmGenerationHeartbeat(db, roundId, requestId), true);
    assert.equal(isGmGenerationLeaseStaleOnDb(db, roundId), false);
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), false);
    db.close();
  });

  it("G pending save beats orphan terminalization CAS", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    savePendingGmResultForGeneration(
      db,
      roundId,
      requestId,
      parseTrpgGmOutput(GM_TEXT),
      [],
      requestId
    );
    assert.equal(tryTerminalizeStaleOrphan(db, roundId), false);
    assert.equal(resolveGmLeaseState(db, roundId, "GENERATING_NARRATION", requestId).status, "stale_pending");
    db.close();
  });

  it("H usage write is atomically fenced after reclaim", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId: tokenA } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 500 });
    const tokenB = "token-b";
    db.prepare(`UPDATE trpg_rounds SET gm_generation_id=? WHERE id=?`).run(tokenB, roundId);
    const row = db
      .prepare(`SELECT usage_json FROM trpg_rounds WHERE id=? AND gm_generation_id=?`)
      .get(roundId, tokenA) as { usage_json: string | null } | undefined;
    assert.equal(row, undefined);
    const info = db
      .prepare(`UPDATE trpg_rounds SET usage_json='[{"model":"x"}]' WHERE id=? AND gm_generation_id=?`)
      .run(roundId, tokenA);
    assert.equal(info.changes, 0);
    db.close();
  });

  it("I pending write is atomically fenced after reclaim", () => {
    const db = memoryDb();
    const campaignId = Number(
      db.prepare(`INSERT INTO trpg_campaigns (host_user_id, title, status) VALUES (1,'t','ACTION_INPUT')`).run()
        .lastInsertRowid
    );
    const { roundId, requestId: tokenA } = seedStuckGmRound(db, { campaignId, heartbeatAgeSec: 5 });
    const tokenB = "token-b";
    db.prepare(`UPDATE trpg_rounds SET gm_generation_id=? WHERE id=?`).run(tokenB, roundId);
    assert.equal(
      savePendingGmResultForGeneration(db, roundId, tokenA, parseTrpgGmOutput(GM_TEXT), [], tokenA),
      false
    );
    const pending = db
      .prepare(`SELECT pending_gm_result_json FROM trpg_rounds WHERE id=?`)
      .get(roundId) as { pending_gm_result_json: string | null };
    assert.equal(pending.pending_gm_result_json, null);
    db.close();
  });

  it("J ERROR_RECOVERY pending salvage completes without provider recall", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => {
        throw new Error("provider must not be called");
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
    const round = loadLatestRound(db, campaignId)!;
    const tokenA = "salvage-a";
    db.prepare(`UPDATE trpg_rounds SET gm_generation_id=? WHERE id=?`).run(tokenA, round.id);
    savePendingGmResultForGeneration(
      db,
      round.id,
      tokenA,
      parseTrpgGmOutput(gmText("pending salvage")),
      [],
      tokenA
    );
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='ERROR_RECOVERY', error_json='{"class":"B","error":"x","kind":"persist_error","model":"m","elapsedMs":null,"trueOffRequested":true,"httpStatus":null,"reasoningTokens":"unavailable"}'
       WHERE id=?`
    ).run(round.id);
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /pending salvage/);
    db.close();
  });

  it("K legacy pending without generationId recovers in ERROR_RECOVERY", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        throw new Error("provider must not be called");
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
    const round = loadLatestRound(db, campaignId)!;
    savePendingGmResult(db, round.id, parseTrpgGmOutput(gmText("legacy pending")));
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='ERROR_RECOVERY', gm_generation_id=NULL, error_json='{"class":"B","error":"x","kind":"persist_error","model":"m","elapsedMs":null,"trueOffRequested":true,"httpStatus":null,"reasoningTokens":"unavailable"}'
       WHERE id=?`
    ).run(round.id);
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /legacy pending/);
    db.close();
  });

  it("L reroll billing rejects stale owner after lease loss", async () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("rerolled") }),
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
    const prevRound = db
      .prepare(`SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=?`)
      .get(campaignId, round.round_number - 1) as { id: number };
    const tokenA = "reroll-a";
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='GENERATING_NARRATION', gm_generation_id=?, gm_committed_generation_id=?,
           process_stage='reroll', gm_generation_heartbeat_at=datetime('now', '-600 seconds'),
           updated_at=datetime('now', '-600 seconds')
       WHERE id=?`
    ).run(tokenA, tokenA, prevRound.id);
    const tokenB = "reroll-b";
    assert.equal(tryClaimStaleGmRecovery(db, prevRound.id, tokenA, tokenB, "committed"), true);
    assert.equal(gmGenerationOwnsToken(db, prevRound.id, tokenA), false);
    assert.equal(finalizeRerollForGeneration(db, prevRound.id, tokenA, tokenA), false);
    assert.equal(finalizeRerollForGeneration(db, prevRound.id, tokenB, tokenA), true);
    db.close();
  });
});
