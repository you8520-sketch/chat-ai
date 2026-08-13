import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  hostFillBotAction,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { insertParticipant, loadCampaign } from "./store";
import { ensureTrpgTables } from "./schema";

function gmText(opts?: { hp?: number; participantId?: number; narration?: string }): string {
  const players =
    opts?.participantId && opts.hp != null
      ? [{ participantId: opts.participantId, hp: opts.hp }]
      : [];
  return `<<<NARRATION>>>
${opts?.narration ?? "낡은 등불이 흔들린다. 당신은 문턱에서 다음 한 수를 고른다."}
<<<DELTA>>>
${JSON.stringify({ players, location: "문턱", campaign_finished: false })}`;
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

async function setupSolo(db: Database.Database, deps: TrpgEngineDeps) {
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return { campaignId, snap };
}

describe("TRPG campaign loop", () => {
  it("runs solo submit → one resolve GM after the opening", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText({ narration: gmCalls === 1 ? "문이 열린다." : "렌이 안으로 든다." }) };
      },
    };
    const { campaignId, snap } = await setupSolo(db, deps);
    assert.equal(gmCalls, 1);
    assert.equal(snap.round.number, 1);
    assert.equal(snap.round.phase, "ACTION_INPUT");
    assert.match(snap.currentNarration ?? "", /문이 열린다/);

    submitTrpgAction(db, { campaignId, userId: 1, body: "조심스럽게 문을 민다.", actionType: "investigate" });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 2);
    assert.equal(after.round.number, 2);
    assert.equal(after.round.phase, "ACTION_INPUT");
    assert.equal(after.currentRolls.length, 1);
    assert.equal(after.currentRolls[0]?.d20, 15);
    assert.equal(after.workType, "wait_humans");
    db.close();
  });

  it("does not call the GM when two of three humans are still writing", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText() };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "A", viewerUserId: 1 });
    const camp = loadCampaign(db, campaignId)!;
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 2, nickname: "B" });
    joinTrpgCampaign(db, { code: camp.invite_code!, userId: 3, nickname: "C" });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "A", stats: EVEN_STATS });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "B", stats: EVEN_STATS });
    saveTrpgSheet(db, { campaignId, userId: 3, name: "C", stats: EVEN_STATS });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 1);
    submitTrpgAction(db, { campaignId, userId: 1, body: "앞장선다." });
    submitTrpgAction(db, { campaignId, userId: 2, body: "뒤를 본다." });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 1);
    assert.equal(after.workType, "wait_humans");
    assert.equal(after.round.phase, "ACTION_INPUT");
    const forC = loadTrpgSnapshot(db, campaignId, 3)!;
    const hidden = forC.log.find((row) => row.roundNumber === forC.round.number)?.actions ?? [];
    const others = hidden.filter((a) => a.participantId !== forC.viewerParticipantId);
    assert.ok(others.every((a) => a.body === "" && a.revealed === false));
    db.close();
  });

  it("lets only one concurrent advance start the GM", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls > 1) await gate;
        return { text: gmText({ narration: "한 장면만." }) };
      },
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "칼을 뽑는다.", actionType: "attack" });
    const first = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const second = advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    await new Promise((r) => setTimeout(r, 20));
    release();
    await Promise.all([first, second]);
    assert.equal(gmCalls, 2);
    db.close();
  });

  it("generates the bot only after the human locks, and host-fill works when the bot model fails", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    let botCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 10,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText({ narration: `장면 ${gmCalls}` }) };
      },
      botCall: async () => {
        botCalls += 1;
        throw new Error("flash down");
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    writeSheet(db, campaignId, botId, "유나", EVEN_STATS, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const waiting = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 1);
    assert.equal(gmCalls, 1);
    assert.equal(waiting.needsHostFill, true);
    assert.deepEqual(waiting.hostFillBotIds, [botId]);
    hostFillBotAction(db, { campaignId, userId: 1, participantId: botId, body: "유나가 창밖을 살핀다." });
    const afterFill = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 2);
    assert.equal(afterFill.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("keeps HP unchanged when the GM delta is out of range", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 8,
      gmCall: async ({ user }) => {
        const match = /participantId=(\d+)/.exec(user);
        const pid = match ? Number(match[1]) : 0;
        return { text: gmText({ participantId: pid || 1, hp: 99, narration: "과한 피해." }) };
      },
    };
    const { campaignId, snap } = await setupSolo(db, deps);
    const pid = snap.viewerParticipantId!;
    const beforeHp = snap.sheets.find((s) => s.participantId === pid)?.sheet.hp;
    submitTrpgAction(db, { campaignId, userId: 1, body: "돌진한다.", actionType: "attack" });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.sheets.find((s) => s.participantId === pid)?.sheet.hp, beforeHp);
    assert.match(after.currentNarration ?? "", /과한 피해|낡은 등불|돌진|문턱/);
    db.close();
  });

  it("applies a valid HP delta from the GM", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 18,
      gmCall: async ({ user }) => {
        const match = /participantId=(\d+)/.exec(user);
        const pid = match ? Number(match[1]) : 0;
        if (!pid) return { text: gmText({ narration: "시작." }) };
        return { text: gmText({ participantId: pid, hp: 20, narration: "가벼운 상처." }) };
      },
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "막는다.", actionType: "defend" });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const hp = after.sheets.find((s) => s.isSelf)?.sheet.hp;
    assert.equal(hp, 20);
    db.close();
  });
});
