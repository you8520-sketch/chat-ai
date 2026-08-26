import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  retryTrpgBots,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
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

function seedLegacyStuckRound(db: Database.Database, campaignId: number, botIds: number[]) {
  submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다.", actionType: "investigate" });
  const round = loadLatestRound(db, campaignId)!;
  db.prepare(
    `INSERT INTO trpg_action_submissions
      (round_id, participant_id, body, action_type, selected_stat, locked, source)
     VALUES (?, ?, ?, 'free', NULL, 1, 'bot_model')`
  ).run(round.id, botIds[0]!, "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다.");
  db.prepare(
    `UPDATE trpg_rounds
     SET phase='BOT_ACTION', error_json=?, bot_generation_id=NULL, bot_generation_recovery_attempts=0
     WHERE id=?`
  ).run(JSON.stringify({ bot: "old failure" }), round.id);
}

describe("TRPG host-fill removal policy", () => {
  it("WAIT_HOST_FILL_EXISTS=false", () => {
    const roundLock = readFileSync("src/lib/trpg/roundLock.ts", "utf8");
    assert.equal(roundLock.includes("wait_host_fill"), false);
  });

  it("HOST_FILL_READY_STATE_EXISTS=false", () => {
    const snapshot = readFileSync("src/lib/trpg/snapshot.ts", "utf8");
    assert.equal(snapshot.includes('"host_fill"'), false);
  });

  it("NEEDS_HOST_FILL_EXISTS=false", () => {
    const src = readFileSync("src/lib/trpg/engineSnapshot.ts", "utf8");
    assert.equal(src.includes("needsHostFill"), false);
  });

  it("HOST_FILL_BOT_IDS_EXISTS=false", () => {
    const src = readFileSync("src/lib/trpg/snapshot.ts", "utf8");
    assert.equal(src.includes("hostFillBotIds"), false);
  });

  it("HOST_FILL_API_EXISTS=false", () => {
    assert.equal(existsSync("src/app/api/trpg/campaigns/[id]/host-fill/route.ts"), false);
  });

  it("HOST_FILL_ENGINE_FUNCTION_EXISTS=false", () => {
    const engine = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.equal(engine.includes("hostFillBotAction"), false);
    const exports = readFileSync("src/lib/trpg/engine.ts", "utf8");
    assert.equal(exports.includes("hostFillBotAction"), false);
  });

  it("HOST_FILL_UI_EXISTS=false", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.equal(room.includes("봇 행동 대신 입력"), false);
    assert.equal(room.includes("봇 행동 넣기"), false);
    assert.equal(room.includes("onHostFill"), false);
    assert.equal(room.includes("hostFill"), false);
    const client = readFileSync("src/app/trpg/[id]/TrpgRoomClient.tsx", "utf8");
    assert.equal(client.includes("host-fill"), false);
    assert.equal(client.includes("hostFill"), false);
  });

  it("HOST_CAN_MANUALLY_SUBMIT_AI_ACTION=false", () => {
    const advance = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.equal(advance.includes('"host_fill"'), false);
    assert.equal(advance.includes("'host_fill'"), false);
  });
});

describe("TRPG explicit bot retry", () => {
  it("A auto recovery failure exposes botRetryRequired without wait_host_fill", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        throw new Error("recovery failed");
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, campaignId, botIds);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snap.botRetryRequired, true);
    assert.equal(snap.workType, "bot_retry_required");
    assert.equal(snap.shouldKickAdvance, false);
    assert.equal(snap.workType === "wait_host_fill", false);
    db.close();
  });

  it("B retry-bots generates only the missing bot and preserves human action", async () => {
    const db = memoryDb();
    const botCalls: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async (_system, user) => {
        botCalls.push(user);
        if (botCalls.length < 2) throw new Error("fail");
        return { text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." };
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, campaignId, botIds);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const humanBefore = db
      .prepare(`SELECT body FROM trpg_action_submissions s JOIN trpg_participants p ON p.id=s.participant_id WHERE p.kind='human'`)
      .get() as { body: string };
    const ai1Before = db
      .prepare(`SELECT body FROM trpg_action_submissions WHERE participant_id=?`)
      .get(botIds[0]!) as { body: string };
    await retryTrpgBots(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls.length, 2);
    assert.match(botCalls[1] ?? "", /민수/);
    const ai1After = db
      .prepare(`SELECT body FROM trpg_action_submissions WHERE participant_id=?`)
      .get(botIds[0]!) as { body: string };
    const humanAfter = db
      .prepare(`SELECT body FROM trpg_action_submissions s JOIN trpg_participants p ON p.id=s.participant_id WHERE p.kind='human'`)
      .get() as { body: string };
    assert.equal(ai1After.body, ai1Before.body);
    assert.equal(humanAfter.body, humanBefore.body);
    const round = loadLatestRound(db, campaignId)!;
    assert.ok(round.bot_generation_id == null || round.bot_generation_heartbeat_at);
    db.close();
  });

  it("C successful retry-bots clears botRetryRequired and continues to GM", async () => {
    const db = memoryDb();
    let botCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 13,
      gmCall: async () => ({ text: gmText("해결") }),
      botCall: async () => {
        botCalls += 1;
        if (botCalls < 2) throw new Error("fail");
        return { text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." };
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, campaignId, botIds);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const after = await retryTrpgBots(db, { campaignId, userId: 1, deps });
    assert.equal(after.botRetryRequired, false);
    assert.match(after.currentNarration ?? "", /해결/);
    db.close();
  });

  it("D failed retry-bots keeps botRetryRequired and does not auto-retry again", async () => {
    const db = memoryDb();
    let botCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        botCalls += 1;
        throw new Error("explicit fail");
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, campaignId, botIds);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 1);
    await retryTrpgBots(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 2);
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snap.botRetryRequired, true);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 2);
    db.close();
  });

  it("E duplicate retry-bots requests make one provider call", async () => {
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
        if (botCalls === 1) throw new Error("recovery fail");
        if (botCalls >= 2) await gate;
        return { text: "민수는 문고리를 본다.\n\n<<<INTENT>>>\n문고리를 본다." };
      },
    };
    const { campaignId, botIds } = await setupWithBots(db, ["유나", "민수"], deps);
    seedLegacyStuckRound(db, campaignId, botIds);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const first = retryTrpgBots(db, { campaignId, userId: 1, deps });
    const second = retryTrpgBots(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(botCalls, 2);
    release();
    await Promise.all([first, second]);
    assert.equal(botCalls, 2);
    db.close();
  });
});
