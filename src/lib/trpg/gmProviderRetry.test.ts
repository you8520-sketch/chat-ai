import assert from "node:assert/strict";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { afterEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds, getPointBalanceOnDb } from "@/lib/points";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints, TRPG_GM_USAGE_FALLBACK } from "./billing";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
import { loadPendingGmResult } from "./pendingGmResult";
import { ensureTrpgTables } from "./schema";
import { extractTrpgHttpStatus, parseTrpgStartFailureJson } from "./startFailure";
import { isTrpgMechanicsRefereeEnabled } from "./mechanicsTypes";

const OPENING = buildTrpgGmStructuredWireText("시작 장면. 낡은 등불이 흔들린다.", {"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false});

const ROUND = buildTrpgGmStructuredWireText("렌이 문을 민다. 먼지 냄새가 난다.", {"players":[],"location":"문턱","next_round_context":"들어갈지","campaign_finished":false});

const previousFetch = globalThis.fetch;
const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
const previousMock = process.env.MOCK_MODE;

afterEach(() => {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
  else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  if (previousMock === undefined) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = previousMock;
});

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
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
  return db;
}

function installProvider(handler: (call: number) => Response): { calls: number } {
  delete process.env.MOCK_MODE;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-trpg-gm-retry";
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls += 1;
    return handler(state.calls);
  }) as typeof fetch;
  return state;
}

function httpError(status: number, text = "provider down"): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

function completion(text: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: {
        prompt_tokens: TRPG_GM_USAGE_FALLBACK.inputTokens,
        completion_tokens: TRPG_GM_USAGE_FALLBACK.outputTokens,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function count(db: Database.Database, sql: string, id: number): number {
  const row = db.prepare(sql).get(id) as { n: number };
  return Number(row.n);
}

function roundRow(db: Database.Database, campaignId: number, roundNumber: number) {
  return db
    .prepare(
      `SELECT id, phase, billed, billed_points, usage_json, error_json
       FROM trpg_rounds WHERE campaign_id=? AND round_number=?`
    )
    .get(campaignId, roundNumber) as {
    id: number;
    phase: string;
    billed: number;
    billed_points: number;
    usage_json: string | null;
    error_json: string | null;
  };
}

function gmNarrations(db: Database.Database, roundId: number): string[] {
  return (
    db.prepare(`SELECT narration FROM trpg_gm_messages WHERE round_id=?`).all(roundId) as Array<{
      narration: string;
    }>
  ).map((row) => row.narration);
}

function usageCount(raw: string | null): number {
  if (!raw) return 0;
  const parsed = JSON.parse(raw) as unknown[];
  return Array.isArray(parsed) ? parsed.length : 0;
}

function credit(db: Database.Database, userId: number, amount: number): void {
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, points, creator_points) VALUES (?,?,?,0,0)`).run(
    userId,
    `u${userId}@test.local`,
    `u${userId}`
  );
  creditPointsWithIds(db, userId, amount, "FREE", "test-credit");
}

describe("TRPG GM provider 5xx retry through engine ownership", () => {
  it("F: opening 502 then 200 yields one round-0 narration", async () => {
    const db = memoryDb();
    const provider = installProvider((n) => (n === 1 ? httpError(502) : completion(OPENING)));
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1 });
    const row = roundRow(db, campaignId, 0);
    assert.equal(provider.calls, 2);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.equal(row.phase, "ROUND_COMPLETE");
    assert.equal(row.error_json, null);
    assert.equal(row.billed, 0);
    assert.deepEqual(gmNarrations(db, row.id), ["시작 장면. 낡은 등불이 흔들린다."]);
    assert.equal(
      count(db, `SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=? AND round_number=0`, campaignId),
      1
    );
    db.close();
  });

  it("G: normal round 502 then 200 reuses rolls/mechanics and bills once", async () => {
    const db = memoryDb();
    credit(db, 1, computeTrpgRoundPoints([TRPG_GM_USAGE_FALLBACK]) + 200);
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const opening: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async () => ({ text: OPENING }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: opening });
    const beforePoints = getPointBalanceOnDb(db, 1).total;
    const provider = installProvider((n) => (n === 1 ? httpError(502) : completion(ROUND)));
    submitTrpgAction(db, { campaignId, userId: 1, body: "조심스럽게 문을 민다.", actionType: "investigate" });
    const snap = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: false, rollD20: () => 16 },
    });
    const row = roundRow(db, campaignId, 1);
    const rolls = db
      .prepare(`SELECT d20 FROM trpg_dice_rolls WHERE round_id=?`)
      .all(row.id) as Array<{ d20: number }>;
    assert.equal(provider.calls, 2);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.equal(row.phase, "ROUND_COMPLETE");
    assert.equal(row.error_json, null);
    assert.equal(row.billed, 1);
    assert.ok(row.billed_points > 0);
    assert.equal(usageCount(row.usage_json), 1);
    assert.deepEqual(gmNarrations(db, row.id), ["렌이 문을 민다. 먼지 냄새가 난다."]);
    assert.deepEqual(
      rolls.map((r) => r.d20),
      [16]
    );
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM trpg_dice_rolls WHERE round_id=?`, row.id), 1);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM trpg_mechanics_resolutions WHERE round_id=?`, row.id), 1);
    assert.equal(beforePoints - getPointBalanceOnDb(db, 1).total, row.billed_points);
    assert.equal(isTrpgMechanicsRefereeEnabled(), false);
    db.close();
  });

  it("H: billing retry after a successful GM does not call the provider again", async () => {
    const db = memoryDb();
    credit(db, 1, computeTrpgRoundPoints([TRPG_GM_USAGE_FALLBACK]) + 200);
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: true, rollD20: () => 16, gmCall: async () => ({ text: OPENING }) },
    });
    const provider = installProvider((n) => {
      if (n === 1) return completion(ROUND);
      throw new Error("unexpected extra provider call");
    });
    submitTrpgAction(db, { campaignId, userId: 1, body: "조심스럽게 문을 민다.", actionType: "investigate" });
    const failed = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: false, billingFault: "billing_persist", rollD20: () => 16 },
    });
    const failedRow = roundRow(db, campaignId, 1);
    assert.equal(failed.round.phase, "ERROR_RECOVERY");
    assert.equal(failed.hasPendingGmResult, true);
    assert.ok(loadPendingGmResult(db, failedRow.id));
    assert.equal(provider.calls, 1);
    assert.equal(failedRow.billed, 0);

    const retried = await advanceTrpgCampaign(db, {
      campaignId,
      userId: 1,
      deps: { skipBilling: false, rollD20: () => 16 },
    });
    const done = roundRow(db, campaignId, 1);
    assert.equal(provider.calls, 1);
    assert.equal(retried.round.phase, "ACTION_INPUT");
    assert.equal(retried.hasPendingGmResult, false);
    assert.equal(done.phase, "ROUND_COMPLETE");
    assert.equal(done.billed, 1);
    assert.equal(usageCount(done.usage_json), 1);
    assert.deepEqual(gmNarrations(db, done.id), ["렌이 문을 민다. 먼지 냄새가 난다."]);
    db.close();
  });

  it("opening 503 then 503 keeps one ERROR_RECOVERY round 0", async () => {
    const db = memoryDb();
    const provider = installProvider(() => httpError(503, "busy"));
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    await assert.rejects(
      () => startTrpgCampaign(db, { campaignId, userId: 1 }),
      (error: unknown) => {
        assert.equal(extractTrpgHttpStatus(error), 503);
        return true;
      }
    );
    const row = roundRow(db, campaignId, 0);
    const failure = parseTrpgStartFailureJson(row.error_json);
    assert.equal(provider.calls, 2);
    assert.equal(row.phase, "ERROR_RECOVERY");
    assert.equal(failure?.kind, "provider_http");
    assert.equal(failure?.httpStatus, 503);
    assert.equal(row.billed, 0);
    assert.deepEqual(gmNarrations(db, row.id), []);
    assert.equal(
      count(db, `SELECT COUNT(*) AS n FROM trpg_rounds WHERE campaign_id=? AND round_number=0`, campaignId),
      1
    );
    db.close();
  });

  it("keeps the DeepSeek 0813 model pin and flash referee off", () => {
    assert.equal(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL, "deepseek-v4-pro-0813");
    assert.equal(isTrpgMechanicsRefereeEnabled(), false);
  });
});
