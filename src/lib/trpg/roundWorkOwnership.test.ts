import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  hostFillBotAction,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { liveTurnBotProgress } from "./liveTurnStatus";
import {
  TRPG_BOT_GENERATION_STALE_MS,
  isBotGenerationLeaseStaleOnDb,
  tryClaimBotGeneration,
} from "./botGenerationLease";
import { parseProcessStartedAtMs, processElapsedSecFromStartedAt } from "./processTimer";
import { shouldKickTrpgAdvance } from "./roundWorkKick";
import { insertParticipant, loadLatestRound } from "./store";
import { ensureTrpgTables } from "./schema";

function gmText(narration = "장면"): string {
  return `<<<NARRATION>>>\n${narration}\n<<<DELTA>>>\n${JSON.stringify({
    players: [],
    location: "문턱",
    next_round_context: "다음",
    questsAdd: [],
    flagsAdd: [],
    campaign_finished: false,
  })}`;
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function setupWithBots(db: Database.Database, names: string[], deps: TrpgEngineDeps) {
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  for (let i = 0; i < names.length; i += 1) {
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: i + 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: names[i]!,
    });
    writeSheet(db, campaignId, botId, names[i]!, EVEN_STATS, "");
  }
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return campaignId;
}

describe("TRPG refresh-safe round work ownership", () => {
  it("A duplicate advance during bot generation makes one provider call and no host-fill", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        botCalls += 1;
        await gate;
        return { text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." };
      },
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const first = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const second = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(botCalls, 1);
    const mid = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(mid?.botGenerationInFlight, true);
    assert.equal(mid?.needsHostFill, false);
    assert.equal(mid?.shouldKickAdvance, false);
    release();
    await Promise.all([first, second]);
    assert.equal(botCalls, 1);
    db.close();
  });

  it("B poll during in-flight bot generation does not start a second provider call", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        botCalls += 1;
        await gate;
        return { text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." };
      },
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const inFlight = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 20));
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.botGenerationInFlight, true);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 1);
    release();
    await inFlight;
    db.close();
  });

  it("C persists AI1 before AI2 and reports 1/2 while second bot is in flight", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let releaseSecond: () => void = () => {};
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async (_system, user) => {
        botCalls += 1;
        if (botCalls === 1) {
          assert.doesNotMatch(user, /유나-먼저/);
          return { text: "유나-먼저 행동.\n\n<<<INTENT>>>\n유나는 먼저 움직인다." };
        }
        await secondGate;
        return { text: "카이-나중 행동.\n\n<<<INTENT>>>\n카이는 따라간다." };
      },
    };
    const campaignId = await setupWithBots(db, ["유나", "카이"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "화물칸을 연다." });
    const inFlight = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(botCalls, 2);
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    const progress = liveTurnBotProgress(snap.participants);
    assert.deepEqual(progress, { done: 1, total: 2 });
    assert.equal(snap.botGenerationInFlight, true);
    assert.equal(snap.needsHostFill, false);
    const round = loadLatestRound(db, campaignId)!;
    const yuna = db
      .prepare(
        `SELECT locked, source FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=? AND p.display_name='유나'`
      )
      .get(round.id) as { locked: number; source: string };
    assert.equal(yuna.locked, 1);
    assert.equal(yuna.source, "bot_model");
    releaseSecond();
    await inFlight;
    db.close();
  });

  it("D real provider bot failure clears lease and defers host-fill until recovery is exhausted", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 10,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        throw new Error("bot-seat down");
      },
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const snap = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.needsHostFill, false);
    assert.equal(snap.workType, "generate_bots");
    assert.equal(snap.botGenerationInFlight, false);
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(round.bot_generation_id, null);
    assert.equal(round.bot_generation_recovery_attempts, 0);
    assert.match(round.error_json ?? "", /bot-seat down/);
    const afterRecovery = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(afterRecovery.needsHostFill, true);
    assert.equal(loadLatestRound(db, campaignId)!.bot_generation_recovery_attempts, 1);
    db.close();
  });

  it("E committed human action survives without re-entry while generation is in flight", async () => {
    const db = memoryDb();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        await gate;
        return { text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." };
      },
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다.", idempotencyKey: "human-1" });
    const inFlight = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 15));
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snap.myDraft?.locked, true);
    assert.match(snap.myDraft?.body ?? "", /창문을 연다/);
    assert.equal(snap.round.phase, "BOT_ACTION");
    release();
    await inFlight;
    db.close();
  });

  it("F snapshot after completed generation needs no human re-entry", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async () => ({ text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." }),
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.round.phase, "ACTION_INPUT");
    assert.equal(after.botGenerationInFlight, false);
    assert.match(after.currentNarration ?? "", /해결/);
    db.close();
  });

  it("G reconnect with active lease only polls and does not kick advance", async () => {
    const db = memoryDb();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        await gate;
        return { text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." };
      },
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const inFlight = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 15));
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(
      shouldKickTrpgAdvance({
        workType: snap.workType as "generate_bots",
        phase: snap.round.phase,
        botGenerationInFlight: snap.botGenerationInFlight,
        gmGenerationInFlight: snap.gmGenerationInFlight,
      }),
      false
    );
    release();
    await inFlight;
    db.close();
  });

  it("H stale bot lease can be reclaimed once; fresh lease cannot", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const roundId = Number(
      db
        .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'BOT_ACTION')`)
        .run(campaignId).lastInsertRowid
    );
    db.prepare(
      `UPDATE trpg_rounds
       SET bot_generation_id='old', bot_generation_heartbeat_at=datetime('now', '-200 seconds')
       WHERE id=?`
    ).run(roundId);
    assert.equal(isBotGenerationLeaseStaleOnDb(db, roundId), true);
    const reclaimed = tryClaimBotGeneration(db, roundId, "new-owner");
    assert.equal(reclaimed.claimed, true);
    assert.equal(isBotGenerationLeaseStaleOnDb(db, roundId), false);
    const blocked = tryClaimBotGeneration(db, roundId, "other");
    assert.equal(blocked.claimed, false);
    assert.equal(blocked.reason, "in_flight");
    db.close();
  });
});

describe("TRPG server-anchored process timer", () => {
  it("I client mount at T0+16s reports approximately 16s elapsed", () => {
    const startedAtMs = 1_000;
    assert.equal(processElapsedSecFromStartedAt(startedAtMs, 17_000), 16);
  });

  it("J remount at T0+20s still reports approximately 20s", () => {
    const startedAtMs = 5_000;
    assert.equal(processElapsedSecFromStartedAt(startedAtMs, 25_000), 20);
  });

  it("K stage change resets server process_started_at", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    const roundId = Number(
      db
        .prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'BOT_ACTION')`)
        .run(campaignId).lastInsertRowid
    );
    db.prepare(
      `UPDATE trpg_rounds SET process_stage='bots', process_started_at=datetime('now', '-30 seconds') WHERE id=?`
    ).run(roundId);
    const before = loadLatestRound(db, campaignId)!;
    const beforeMs = parseProcessStartedAtMs(before.process_started_at);
    assert.ok(beforeMs);
    db.prepare(
      `UPDATE trpg_rounds
       SET process_stage='gm',
           process_started_at=CASE WHEN process_stage IS NULL OR process_stage != 'gm' THEN datetime('now') ELSE process_started_at END
       WHERE id=?`
    ).run(roundId);
    const after = loadLatestRound(db, campaignId)!;
    const afterMs = parseProcessStartedAtMs(after.process_started_at)!;
    assert.ok(afterMs > beforeMs!);
    db.close();
  });

  it("exports stale threshold longer than bot provider timeout", () => {
    assert.ok(TRPG_BOT_GENERATION_STALE_MS > 90_000);
  });
});
