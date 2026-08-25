import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, saveTrpgRelationshipBrief, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  hostFillBotAction,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadTrpgSnapshot } from "./engineSnapshot";
import { insertParticipant, loadCampaign } from "./store";
import { ensureTrpgTables } from "./schema";

function gmText(opts?: {
  hp?: number;
  participantId?: number;
  narration?: string;
  nextRoundContext?: string;
  questsAdd?: string[];
  flagsAdd?: string[];
}): string {
  const players =
    opts?.participantId && opts.hp != null
      ? [{ participantId: opts.participantId, hp: opts.hp }]
      : [];
  return `<<<NARRATION>>>
${opts?.narration ?? "낡은 등불이 흔들린다. 당신은 문턱에서 다음 한 수를 고른다."}
<<<DELTA>>>
${JSON.stringify({
  players,
  location: "문턱",
  next_round_context: opts?.nextRoundContext ?? "문 너머를 조사할지 말을 걸지",
  questsAdd: opts?.questsAdd ?? ["밀서 찾기"],
  flagsAdd: opts?.flagsAdd ?? ["문_열림"],
  campaign_finished: false,
})}`;
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
  it("refuses campaign forks and keeps one round number per timeline", () => {
    const db = memoryDb();
    assert.throws(
      () =>
        createTrpgCampaign(db, {
          hostUserId: 1,
          hostNickname: "렌",
          viewerUserId: 1,
          parentCampaignId: 99,
        }),
      /분기할 수 없습니다/
    );
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'ACTION_INPUT')`).run(
      campaignId
    );
    assert.throws(() => {
      db.prepare(`INSERT INTO trpg_rounds (campaign_id, round_number, phase) VALUES (?, 1, 'BOT_ACTION')`).run(
        campaignId
      );
    });
    db.close();
  });

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
    assert.equal(after.currentRolls.length, 0);
    const played = after.log.find((row) => row.roundNumber === 1);
    assert.equal(played?.rolls.length, 1);
    assert.equal(played?.rolls[0]?.d20, 15);
    assert.equal(after.workType, "wait_humans");
    db.close();
  });

  it("does not roll when the human only asks the party", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 3,
      gmCall: async () => ({ text: gmText({ narration: "렌이 묻자 동료들이 대답한다." }) }),
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "안전가옥을 찾아볼까?? 아니면 약국에 쓸만한게 있나볼까??? *모두를 향해 물어본다*",
      actionType: "free",
    });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.currentRolls.length, 0);
    assert.match(after.log.at(-1)?.narration ?? after.currentNarration ?? "", /렌이 묻자/);
    db.close();
  });

  it("rolls when an explicit resolution chip is dialogue-only", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 14,
      gmCall: async () => ({ text: gmText({ narration: "전열을 맡는다." }) }),
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "「내가 맡을게.」",
      actionType: "attack",
    });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.log.find((row) => row.roundNumber === 1)?.rolls.length, 1);
    db.close();
  });

  it("does not roll pure dialogue or harmless flavor free actions", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 3,
      gmCall: async () => ({ text: gmText({ narration: "고개를 끄덕이자 공기가 가라앉는다." }) }),
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "고개를 끄덕인다. 「알겠어.」",
      actionType: "free",
    });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.log.find((row) => row.roundNumber === 1)?.rolls.length, 0);

    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "옷깃을 정리하고 벽에 기대 선다.",
      actionType: "free",
    });
    const flavor = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(flavor.log.find((row) => row.roundNumber === 2)?.rolls.length, 0);
    db.close();
  });

  it("still rolls risky and investigation free actions", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async () => ({ text: gmText({ narration: "잔해를 넘는다." }) }),
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "무너지는 잔해 사이를 뛰어넘는다.",
      actionType: "free",
    });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.log.find((row) => row.roundNumber === 1)?.rolls.length, 1);

    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "빛나는 조각을 집어 들고 주변 기척을 살핀다.",
      actionType: "free",
    });
    const investigate = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(investigate.log.find((row) => row.roundNumber === 2)?.rolls.length, 1);
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
    const current = forC.log.find((row) => row.roundNumber === forC.round.number)?.actions ?? [];
    const others = current.filter((a) => a.participantId !== forC.viewerParticipantId);
    assert.equal(others.length, 2);
    assert.ok(others.every((a) => a.revealed && a.body.length > 0));
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

  it("starts once the host sheet and companion sheets exist", async () => {
    const db = memoryDb();
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText({ narration: "시작." }) }),
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
    const snap = await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(snap.round.phase, "ACTION_INPUT");
    db.close();
  });

  it("calls the bot seat before the GM and keeps them as two Pro turns", async () => {
    const db = memoryDb();
    const order: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async ({ user }) => {
        order.push("gm");
        if (order.filter((step) => step === "gm").length > 1) {
          assert.match(user, /내가 볼게/);
        }
        return { text: gmText({ narration: `장면 ${order.length}` }) };
      },
      botCall: async (system, user) => {
        order.push("bot");
        assert.match(system, /You ARE this character/);
        assert.match(user, /CHARACTER CARD|HUMAN ACTIONS THIS ROUND/);
        assert.match(user, /창문을 연다/);
        assert.match(user, /CAMPAIGN STATE|location=/);
        return {
          text: [
            "유나는 창틀에 어깨를 붙인 채 골목 쪽을 먼저 눈으로 훑는다.",
            '렌 쪽으로 고개만 돌려 낮게 말한다. "먼저 나가지 마. 내가 볼게."',
            "",
            "<<<INTENT>>>",
            "창가에 붙어 골목을 먼저 살핀다.",
          ].join("\n"),
        };
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
    saveTrpgSheet(db, {
      campaignId,
      userId: 1,
      name: "유나",
      stats: EVEN_STATS,
      participantId: botId,
    });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(order, ["gm", "bot", "gm"]);
    assert.equal(after.round.phase, "ACTION_INPUT");
    const resolved = after.log.find((row) => row.roundNumber === 1);
    const botLine = resolved?.actions.find((a) => a.kind === "ai_character");
    assert.match(botLine?.body ?? "", /내가 볼게/);
    assert.equal(botLine?.revealed, true);
    const botRoll = resolved?.rolls.find((r) => r.kind === "ai_character");
    assert.match(botRoll?.actionBody ?? "", /내가 볼게/);
    db.close();
  });

  it("stores party relationships before start and feeds them to GM and bots", async () => {
    const db = memoryDb();
    const seen: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async ({ user }) => {
        seen.push(user);
        return { text: gmText({ narration: "관계가 반영된 장면" }) };
      },
      botCall: async (_system, user) => {
        seen.push(user);
        return { text: "유나가 렌 쪽을 흘끗 본다. 소꿉친구라 반말이 먼저 나온다." };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    saveTrpgRelationshipBrief(db, { campaignId, userId: 1, brief: "렌과 유나는 소꿉친구" });
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
    assert.match(seen[0] ?? "", /PARTY RELATIONSHIPS/);
    assert.match(seen[0] ?? "", /소꿉친구/);
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.ok(seen.some((block) => block.includes("소꿉친구") && block.includes("HUMAN ACTIONS")));
    db.close();
  });

  it("lets the second companion see the first companion's action", async () => {
    const db = memoryDb();
    const botUsers: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async ({ user }) => {
        if (user.includes("화물칸을 연다")) {
          assert.match(user, /유나-먼저/);
          assert.match(user, /카이-다음/);
        }
        return { text: gmText({ narration: "순서대로 말한다" }) };
      },
      botCall: async (_system, user) => {
        botUsers.push(user);
        if (user.includes("[NAME]\n유나")) return { text: "유나-먼저" };
        return { text: "카이-다음" };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const yuna = insertParticipant(db, {
      campaignId,
      slotIndex: 1,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "유나",
    });
    const kai = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "카이",
    });
    writeSheet(db, campaignId, yuna, "유나", EVEN_STATS, "");
    writeSheet(db, campaignId, kai, "카이", EVEN_STATS, "");
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "화물칸을 연다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botUsers.length, 2);
    assert.match(botUsers[0] ?? "", /\[NAME\]\n유나/);
    assert.doesNotMatch(botUsers[0] ?? "", /유나-먼저/);
    assert.match(botUsers[1] ?? "", /\[NAME\]\n카이/);
    assert.match(botUsers[1] ?? "", /유나-먼저/);
    db.close();
  });

  it("feeds campaign world and compact continuity to the bot without secrets or extra calls", async () => {
    const db = memoryDb();
    let botCalls = 0;
    let lastBot = "";
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      memoryCall: async () => ({ text: "봉인된 사실 요약" }),
      gmCall: async () => ({
        text: gmText({ narration: `FULLRAW_ROUND ${"가".repeat(180)}` }),
      }),
      botCall: async (_system, user) => {
        botCalls += 1;
        lastBot = user;
        assert.doesNotMatch(user, /SECRET_GM_CANARY|SECRET_PLAN_CANARY|endingCandidates|BLUEPRINT/);
        return {
          text: `유나는 ${botCalls}번째로 창을 본다.\n\n<<<INTENT>>>\n유나는 창틀을 짚으려 했다.`,
        };
      },
    };
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1 });
    db.prepare(`UPDATE trpg_campaigns SET world_brief=?, gm_secret=? WHERE id=?`).run(
      "캠페인세계관CANON 폐역",
      "SECRET_GM_CANARY",
      campaignId
    );
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
    for (let n = 1; n <= 6; n += 1) {
      submitTrpgAction(db, { campaignId, userId: 1, body: `인간행동R${n}` });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    }
    const afterSix = botCalls;
    submitTrpgAction(db, { campaignId, userId: 1, body: "인간행동R7" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, afterSix + 1);
    assert.match(lastBot, /CAMPAIGN WORLD/);
    assert.match(lastBot, /캠페인세계관CANON/);
    assert.match(lastBot, /CAMPAIGN STATE/);
    assert.match(lastBot, /PREVIOUS GM SCENE/);
    assert.match(lastBot, /RECENT CONTINUITY/);
    assert.match(lastBot, /인간행동R7/);
    assert.doesNotMatch(lastBot, /SECRET_GM_CANARY/);
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
        throw new Error("bot-seat down");
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
    saveTrpgSheet(db, {
      campaignId,
      userId: 1,
      name: "유나",
      stats: EVEN_STATS,
      participantId: botId,
    });
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "창문을 연다." });
    const firstFail = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 1);
    assert.equal(gmCalls, 1);
    assert.equal(firstFail.needsHostFill, false);
    assert.equal(firstFail.workType, "generate_bots");
    const waiting = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(botCalls, 2);
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

  it("stores quests/flags/next-decision in the DB and feeds them to the next GM call", async () => {
    const db = memoryDb();
    const users: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 12,
      memoryCall: async () => ({ text: "" }),
      gmCall: async ({ user }) => {
        users.push(user);
        return {
          text: gmText({
            narration: `장면 ${users.length}`,
            nextRoundContext: "창문을 볼지 문을 밀지",
            questsAdd: ["밀서 찾기"],
            flagsAdd: ["문_열림"],
          }),
        };
      },
    };
    const { campaignId } = await setupSolo(db, deps);
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.ok(users.length >= 2);
    assert.match(users[1] ?? "", /창문을 볼지/);
    assert.match(users[1] ?? "", /밀서 찾기/);
    assert.match(users[1] ?? "", /문_열림/);
    db.close();
  });

  it("seals the opening round with a fact recap once it leaves the raw window", async () => {
    const db = memoryDb();
    let seals = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      memoryCall: async () => {
        seals += 1;
        return { text: "밤사이 여관 문이 열림. 밀서 단서." };
      },
      gmCall: async () => ({ text: gmText({ narration: "이어지는 밤." }) }),
    };
    const { campaignId } = await setupSolo(db, deps);
    for (let i = 0; i < 3; i += 1) {
      submitTrpgAction(db, { campaignId, userId: 1, body: `행동 ${i}.` });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    }
    assert.equal(seals, 1);
    const usageRows = db
      .prepare(`SELECT usage_json FROM trpg_rounds WHERE campaign_id=? AND usage_json IS NOT NULL`)
      .all(campaignId) as Array<{ usage_json: string }>;
    assert.ok(usageRows.length > 0);
    for (const row of usageRows) {
      const calls = JSON.parse(row.usage_json) as Array<{ modelId?: string }>;
      assert.ok(calls.length >= 1 && calls.length <= 2, "usage is GM and optional bot only");
    }
    let nextUser = "";
    const follow: TrpgEngineDeps = {
      ...deps,
      gmCall: async ({ user }) => {
        nextUser = user;
        return { text: gmText({ narration: "다음." }) };
      },
    };
    submitTrpgAction(db, { campaignId, userId: 1, body: "다시 본다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps: follow });
    assert.match(nextUser, /SEALED CAMPAIGN SUMMARY/);
    assert.match(nextUser, /밤사이 여관 문이 열림/);
    db.close();
  });

  it("exposes billed points on each GM scene and lets the host reroll it", async () => {
    const db = memoryDb();
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 11,
      gmCall: async () => {
        gmCalls += 1;
        return { text: gmText({ narration: gmCalls === 1 ? "첫 장면." : `리롤 ${gmCalls}.` }) };
      },
    };
    const { campaignId, snap } = await setupSolo(db, deps);
    const opening = snap.log.find((row) => row.roundNumber === 0);
    assert.equal(opening?.billedPoints, 0);
    assert.equal(opening?.viewerSharePoints, 0);
    assert.equal(snap.canRerollRoundNumber, 0);

    const rerolled = await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.equal(gmCalls, 2);
    assert.match(rerolled.currentNarration ?? "", /리롤 2/);
    assert.equal(rerolled.round.number, 1);
    assert.equal(rerolled.round.phase, "ACTION_INPUT");
    assert.equal(rerolled.canRerollRoundNumber, 0);

    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 민다." });
    const after = await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(after.canRerollRoundNumber, 1);
    assert.match(after.log.find((row) => row.roundNumber === 1)?.narration ?? "", /리롤 3/);

    submitTrpgAction(db, { campaignId, userId: 1, body: "안으로 든다." });
    await assert.rejects(
      () => regenerateTrpgNarration(db, { campaignId, userId: 1, roundNumber: 1, deps }),
      /다음 행동/
    );
    db.close();
  });
});
