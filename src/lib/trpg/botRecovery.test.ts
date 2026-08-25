import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  AUTO_BOT_RECOVERY_MAX,
  roundHasBotGenerateFailed,
  tryClaimBotRecoveryGeneration,
} from "./botGenerationRecovery";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
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
  const botIds: number[] = [];
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
    botIds.push(botId);
  }
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, botIds };
}

function seedLegacyStuckRound(
  db: Database.Database,
  opts: {
    campaignId: number;
    botIds: number[];
    humanBody?: string;
    ai1Body?: string;
    errorMessage?: string;
    recoveryAttempts?: number;
  }
) {
  submitTrpgAction(db, {
    campaignId: opts.campaignId,
    userId: 1,
    body: opts.humanBody ?? "창문을 연다.",
    actionType: "investigate",
    idempotencyKey: "legacy-human",
  });
  const round = loadLatestRound(db, opts.campaignId)!;
  const ai1 = opts.botIds[0]!;
  db.prepare(
    `INSERT INTO trpg_action_submissions
      (round_id, participant_id, body, action_type, selected_stat, locked, source)
     VALUES (?, ?, ?, 'free', NULL, 1, 'bot_model')`
  ).run(round.id, ai1, opts.ai1Body ?? "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다.");
  db.prepare(
    `UPDATE trpg_rounds
     SET phase='BOT_ACTION',
         error_json=?,
         bot_generation_id=NULL,
         bot_generation_started_at=NULL,
         bot_generation_heartbeat_at=NULL,
         bot_generation_recovery_attempts=?,
         process_stage='bots',
         updated_at=datetime('now')
     WHERE id=?`
  ).run(
    JSON.stringify({ bot: opts.errorMessage ?? "old failure" }),
    opts.recoveryAttempts ?? 0,
    round.id
  );
  return round.id;
}

describe("TRPG stuck bot round self-heal", () => {
  it("A legacy stuck room is recoverable instead of permanent bot_retry_required", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, { campaignId, botIds });
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snap.workType, "generate_bots");
    assert.equal(snap.botRetryRequired, false);
    assert.equal(
      shouldKickTrpgAdvance({
        workType: snap.workType as "generate_bots",
        phase: snap.round.phase,
        botGenerationInFlight: snap.botGenerationInFlight,
        gmGenerationInFlight: snap.gmGenerationInFlight,
      }),
      true
    );
    db.close();
  });

  it("B recovery generation calls only the pending bot provider", async () => {
    const db = memoryDb();
    const botCalls: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async (_system, user) => {
        botCalls.push(user);
        return { text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." };
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, { campaignId, botIds });
    const ai1Before = db
      .prepare(`SELECT body, source FROM trpg_action_submissions WHERE participant_id=?`)
      .get(botIds[0]!) as { body: string; source: string };

    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });

    assert.equal(botCalls.length, 1);
    assert.match(botCalls[0] ?? "", /민수/);
    const ai1After = db
      .prepare(`SELECT body, source FROM trpg_action_submissions WHERE participant_id=?`)
      .get(botIds[0]!) as { body: string; source: string };
    assert.equal(ai1After.body, ai1Before.body);
    assert.equal(ai1After.source, "bot_model");
    const ai2 = db
      .prepare(`SELECT locked, source FROM trpg_action_submissions WHERE participant_id=?`)
      .get(botIds[1]!) as { locked: number; source: string };
    assert.equal(ai2.locked, 1);
    assert.equal(ai2.source, "bot_model");
    db.close();
  });

  it("C successful self-heal clears bot error and continues to GM", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText(gmCalls === 1 ? "오프닝" : "해결") };
      },
      botCall: async () => ({ text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." }),
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    const gmCallsBeforeRecovery = gmCalls;
    seedLegacyStuckRound(db, { campaignId, botIds });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.botRetryRequired, false);
    assert.equal(roundHasBotGenerateFailed(loadLatestRound(db, campaignId)?.error_json), false);
    assert.equal(gmCalls, gmCallsBeforeRecovery + 1);
    assert.match(after.currentNarration ?? "", /해결/);
    db.close();
  });

  it("D second genuine recovery failure enables host fill and stops kicking", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 10,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        throw new Error("recovery failed");
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, { campaignId, botIds });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const round = loadLatestRound(db, campaignId)!;
    assert.equal(round.bot_generation_recovery_attempts, 1);
    assert.match(round.error_json ?? "", /recovery failed/);
    assert.equal(after.botRetryRequired, true);
    assert.equal(after.workType, "bot_retry_required");
    assert.equal(after.shouldKickAdvance, false);
    db.close();
  });

  it("E ten advances after exhausted recovery do not add provider calls", async () => {
    const db = memoryDb();
    let botCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        botCalls += 1;
        throw new Error("recovery failed");
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, { campaignId, botIds });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 1);
    for (let i = 0; i < 10; i += 1) {
      loadTrpgSnapshot(db, campaignId, 1);
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    }
    assert.equal(botCalls, 1);
    db.close();
  });

  it("F duplicate recovery kicks make one provider call", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async () => {
        botCalls += 1;
        await gate;
        return { text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." };
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, { campaignId, botIds });
    const first = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const second = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(botCalls, 1);
    release();
    await Promise.all([first, second]);
    assert.equal(botCalls, 1);
    db.close();
  });

  it("G partial three-bot round regenerates only the missing bot", async () => {
    const db = memoryDb();
    const botCalls: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async (_system, user) => {
        botCalls.push(user);
        if (user.includes("서연")) {
          return { text: "서연은 복도를 본다.\n\n<<<INTENT>>>\n복도를 본다." };
        }
        throw new Error("unexpected bot");
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수", "서연"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "복도로 간다.", actionType: "investigate" });
    const round = loadLatestRound(db, campaignId)!;
    for (const botId of botIds.slice(0, 2)) {
      db.prepare(
        `INSERT INTO trpg_action_submissions
          (round_id, participant_id, body, action_type, selected_stat, locked, source)
         VALUES (?, ?, ?, 'free', NULL, 1, 'bot_model')`
      ).run(round.id, botId, "이미 행동함.\n\n<<<INTENT>>>\n이미 행동함.");
    }
    db.prepare(
      `UPDATE trpg_rounds
       SET phase='BOT_ACTION', error_json=?, bot_generation_id=NULL,
           bot_generation_recovery_attempts=0, updated_at=datetime('now')
       WHERE id=?`
    ).run(JSON.stringify({ bot: "old failure" }), round.id);

    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls.length, 1);
    assert.match(botCalls[0] ?? "", /서연/);
    db.close();
  });

  it("H healthy in-flight lease does not consume recovery attempt", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        botCalls += 1;
        await gate;
        return { text: "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다." };
      },
    };
    const { campaignId } = await setupWithBots(db, ["유나"], deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const inFlight = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 20));
    const round = loadLatestRound(db, campaignId)!;
    assert.ok(round.bot_generation_id);
    assert.equal(round.bot_generation_recovery_attempts, 0);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 1);
    release();
    await inFlight;
    db.close();
  });

  it("I atomic recovery claim allows only one concurrent owner", () => {
    const db = memoryDb();
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title) VALUES (1, 1, 't')`).run();
    db.prepare(
      `INSERT INTO trpg_rounds (id, campaign_id, round_number, phase, error_json, bot_generation_recovery_attempts)
       VALUES (10, 1, 1, 'BOT_ACTION', '{"bot":"old"}', 0)`
    ).run();
    assert.equal(tryClaimBotRecoveryGeneration(db, 10, "req-a").claimed, true);
    assert.equal(tryClaimBotRecoveryGeneration(db, 10, "req-b").claimed, false);
    const row = db.prepare(`SELECT bot_generation_id, bot_generation_recovery_attempts FROM trpg_rounds WHERE id=10`).get() as {
      bot_generation_id: string;
      bot_generation_recovery_attempts: number;
    };
    assert.equal(row.bot_generation_id, "req-a");
    assert.equal(row.bot_generation_recovery_attempts, 1);
    db.close();
  });

  it("J human locked action body and type survive recovery", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async () => ({ text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." }),
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, {
      campaignId,
      botIds,
      humanBody: "화물칸을 연다.",
      recoveryAttempts: 0,
    });
    const before = db
      .prepare(
        `SELECT s.body, s.action_type, s.idempotency_key
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE p.kind='human'`
      )
      .get() as { body: string; action_type: string; idempotency_key: string };
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = db
      .prepare(
        `SELECT s.body, s.action_type, s.idempotency_key
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE p.kind='human'`
      )
      .get() as { body: string; action_type: string; idempotency_key: string };
    assert.equal(after.body, before.body);
    assert.equal(after.action_type, before.action_type);
    assert.equal(after.idempotency_key, before.idempotency_key);
    db.close();
  });

  it("legacy fixture requires no manual DB edit beyond normal advance", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 13,
      gmCall: async () => ({ text: gmText("복구됨") }),
      botCall: async () => ({ text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." }),
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, { campaignId, botIds, errorMessage: "pre-634 provider timeout" });
    const stuck = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(stuck.workType, "generate_bots");
    const healed = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(healed.botRetryRequired, false);
    assert.equal(healed.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("exports AUTO_BOT_RECOVERY_MAX=1", () => {
    assert.equal(AUTO_BOT_RECOVERY_MAX, 1);
  });
});
