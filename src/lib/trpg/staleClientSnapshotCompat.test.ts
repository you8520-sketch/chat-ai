import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "./engineAdvance";
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

function seedBotRetryRequired(db: Database.Database, campaignId: number) {
  const botIds = (
    db
      .prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND kind='ai_character' ORDER BY slot_index`)
      .all(campaignId) as { id: number }[]
  ).map((row) => row.id);
  submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다.", actionType: "investigate" });
  const round = loadLatestRound(db, campaignId)!;
  db.prepare(
    `INSERT INTO trpg_action_submissions
      (round_id, participant_id, body, action_type, selected_stat, locked, source)
     VALUES (?, ?, ?, 'free', NULL, 1, 'bot_model')`
  ).run(round.id, botIds[0]!, "유나는 창틀을 본다.\n\n<<<INTENT>>>\n창틀을 본다.");
  db.prepare(
    `UPDATE trpg_rounds
     SET phase='BOT_ACTION',
         error_json=?,
         bot_generation_id=NULL,
         bot_generation_recovery_attempts=1
     WHERE id=?`
  ).run(JSON.stringify({ bot: "recovery failed" }), round.id);
  return botIds;
}

function assertStaleClientShim(snap: ReturnType<typeof loadTrpgSnapshot>): void {
  assert.equal(snap?.needsHostFill, false);
  assert.deepEqual(snap?.hostFillBotIds, []);
  const ids = snap!.hostFillBotIds;
  assert.equal(Array.isArray(ids), true);
  assert.doesNotThrow(() => {
    ids.includes(snap!.participants[0]?.id ?? -1);
  });
}

describe("TRPG stale-client snapshot compatibility shims", () => {
  it("A normal round emits deprecated host-fill shims as inert defaults", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
    };
    const campaignId = await setupWithBots(db, ["유나"], deps);
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assertStaleClientShim(snap);
    assert.equal(snap.botRetryRequired, false);
    db.close();
  });

  it("B bot_retry_required keeps shims inert while exposing new retry state", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
      botCall: async () => {
        throw new Error("recovery failed");
      },
    };
    const campaignId = await setupWithBots(db, ["유나", "민수"], deps);
    seedBotRetryRequired(db, campaignId);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(snap.botRetryRequired, true);
    assert.equal(snap.workType, "bot_retry_required");
    assertStaleClientShim(snap);
    assert.notEqual(snap.hostFillBotIds.length, snap.participants.filter((p) => p.kind === "ai_character").length);
    db.close();
  });

  it("C stale pre-#636 client crash contract: hostFillBotIds.includes is always safe", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText("오프닝") }),
    };
    const campaignId = await setupWithBots(db, ["유나", "민수"], deps);
    const snap = loadTrpgSnapshot(db, campaignId, 1)!;
    for (const participant of snap.participants) {
      assert.equal(snap.hostFillBotIds.includes(participant.id), false);
    }
    db.close();
  });

  it("D removed host-fill capability stays absent", () => {
    assert.equal(existsSync("src/app/api/trpg/campaigns/[id]/host-fill/route.ts"), false);
    const roundLock = readFileSync("src/lib/trpg/roundLock.ts", "utf8");
    assert.equal(roundLock.includes("wait_host_fill"), false);
    const engine = readFileSync("src/lib/trpg/engineAdvance.ts", "utf8");
    assert.equal(engine.includes("hostFillBotAction"), false);
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.equal(room.includes("봇 행동 대신 입력"), false);
    assert.equal(room.includes("봇 행동 넣기"), false);
    assert.equal(room.includes("onHostFill"), false);
    const snapshotType = readFileSync("src/lib/trpg/snapshot.ts", "utf8");
    assert.equal(snapshotType.includes('"host_fill"'), false);
    const engineSnapshot = readFileSync("src/lib/trpg/engineSnapshot.ts", "utf8");
    assert.equal(engineSnapshot.includes('work.type === "wait_host_fill"'), false);
    assert.equal(engineSnapshot.includes("bot_retry_required"), true);
    assert.match(engineSnapshot, /needsHostFill:\s*false/);
    assert.match(engineSnapshot, /hostFillBotIds:\s*\[\]/);
  });
});
