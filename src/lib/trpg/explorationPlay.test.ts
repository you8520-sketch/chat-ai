import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { loadCampaignLedger } from "./campaignLedger";
import { loadExplorationState } from "./explorationStore";
import {
  EXPLORATION_ALARM_FLAG,
  EXPLORATION_ALARM_ROOM,
  EXPLORATION_ARCHIVE_ROOM,
  EXPLORATION_CLUE_FLAG,
  EXPLORATION_CLUE_TEXT,
  EXPLORATION_ENTRANCE,
  EXPLORATION_EXIT_ROOM,
  EXPLORATION_ITEM_NAME,
  EXPLORATION_STORE_ROOM,
  type ExplorationState,
} from "./explorationMap";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { loadMechanicsResolution } from "./mechanicsStore";
import { ensureTrpgTables } from "./schema";
import { parseTrpgScenarioPlan } from "./scenarioPlan";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { insertParticipant } from "./store";
import { loadTrpgSnapshot } from "./engineSnapshot";

const PLAN = {
  startingSituation: "닫힌 시설의 현관에 도착한다",
  centralConflict: "경보가 살아 있는 구역을 지나 나가야 한다",
  goal: "출구에 도착한다",
  endingConditions: ["출구에 도착한다"],
  exploration: true,
  encounters: [
    {
      id: "enc_alarm",
      name: "경보 방어장치",
      kind: "hazard",
      damageClass: "LIGHT",
      activateRound: 1,
      maxStrikes: 2,
      hitDc: 10,
      location: EXPLORATION_ALARM_ROOM,
    },
  ],
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','현이',50000),(2,'b@t','도윤',50000)`).run();
  ensureTrpgTables(db);
  return db;
}

function locationOf(db: Database.Database, participantId: number): string {
  return (
    db.prepare(`SELECT location FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as {
      location: string;
    }
  ).location;
}

function itemQty(db: Database.Database, participantId: number, name: string): number {
  const raw = db.prepare(`SELECT inventory_json FROM trpg_character_sheets WHERE participant_id=?`).get(participantId) as {
    inventory_json: string;
  };
  const items = JSON.parse(raw.inventory_json) as Array<{ name: string; quantity: number }>;
  return items.find((item) => item.name === name)?.quantity ?? 0;
}

function neighbors(state: ExplorationState, roomId: string): string[] {
  const out: string[] = [];
  for (const edge of state.map.edges) {
    if (edge.hidden && !state.revealedEdgeIds.includes(edge.id)) continue;
    if (edge.from === roomId) out.push(edge.to);
    else if (edge.to === roomId) out.push(edge.from);
  }
  return out;
}

function stepsToward(state: ExplorationState, from: string, goal: string): string[] {
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === goal) break;
    for (const next of neighbors(state, current)) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  const steps: string[] = [];
  if (!previous.has(goal)) return steps;
  let cursor: string | null = goal;
  while (cursor && cursor !== from) {
    steps.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  return steps.reverse();
}

function wire(narration: string, location: string): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: [],
    location,
    next_round_context: "다음",
    campaign_finished: false,
  });
}

function wirePlayers(
  narration: string,
  location: string,
  players: Array<{ participantId: number; location: string }>
): string {
  return buildTrpgGmStructuredWireText(narration, {
    players,
    location,
    next_round_context: "다음",
    campaign_finished: false,
  });
}

describe("exploration play", () => {
  it("keeps the exploration flag on a parsed plan and does not map a campaign without it", async () => {
    assert.equal(parseTrpgScenarioPlan({ ...PLAN })?.exploration, true);
    assert.equal(parseTrpgScenarioPlan({ startingSituation: "시작", goal: "끝" })?.exploration, undefined);
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "일반",
      summary: "지도 없는 장면",
      content: "그냥 이야기만 한다.",
      visibility: "public",
      startLocation: "복도",
      scenarioPlan: { startingSituation: "복도에 선다", centralConflict: "문", goal: "문을 연다", endingConditions: ["문을 연다"] },
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    const prompts: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 15,
      gmCall: async ({ user }) => {
        prompts.push(user);
        const moving = user.includes("창고로 이동한다");
        const place = moving ? "창고" : "복도";
        const hostId = (
          db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }
        ).id;
        return {
          text: buildTrpgGmStructuredWireText(moving ? "복도를 나와 창고에 선다. GM: 무엇을 하겠는가." : "복도의 등이 깜빡인다. GM: 무엇을 하겠는가.", {
            players: moving ? [{ participantId: hostId, location: place }] : [],
            location: place,
            next_round_context: "다음",
            campaign_finished: false,
          }),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(loadExplorationState(db, campaignId), null);
    assert.equal(loadTrpgSnapshot(db, campaignId, 1)?.exploration, null);
    assert.throws(
      () => submitTrpgAction(db, { campaignId, userId: 1, body: "", explorationCommands: [{ op: "move", roomId: "r1" }] }),
      /탐험 지도가 없습니다/
    );
    submitTrpgAction(db, { campaignId, userId: 1, body: "문을 살핀다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(prompts.some((prompt) => prompt.includes("[EXPLORATION")), false);
    const hostId = (
      db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }
    ).id;
    submitTrpgAction(db, { campaignId, userId: 1, body: "창고로 이동한다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, hostId), "창고");
    assert.equal(loadCampaignLedger(db, campaignId).location, "창고");
    assert.equal(loadExplorationState(db, campaignId), null);
    db.close();
  });

  it("plays a forked search from entrance through clue, supply, risk, and one approved hazard", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "닫힌 시설",
      summary: "짧은 탐험",
      content: "현관에서 출구까지 길을 찾는다.",
      visibility: "public",
      startLocation: EXPLORATION_ENTRANCE,
      scenarioPlan: PLAN,
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }).invite_code;
    joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "도윤" });
    saveTrpgSheet(db, { campaignId, userId: 2, name: "도윤", stats: EVEN_STATS });
    const human2 = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=2`).get(campaignId) as { id: number }).id;
    const ai: number[] = [];
    for (const [slot, name] of [[2, "서하"], [3, "도윤봇"]] as const) {
      const id = insertParticipant(db, {
        campaignId,
        slotIndex: slot,
        kind: "ai_character",
        userId: null,
        characterId: null,
        displayName: name,
      });
      writeSheet(db, campaignId, id, name, EVEN_STATS, EXPLORATION_ENTRANCE);
      ai.push(id);
    }
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    const gmPrompts: string[] = [];
    const botPrompts: string[] = [];
    let gmCalls = 0;
    let botCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      rollDie: () => 2,
      botCall: async (_system, user) => {
        botCalls += 1;
        botPrompts.push(user);
        return { text: "제자리에 서서 동료의 선택을 본다." };
      },
      gmCall: async ({ user }) => {
        gmCalls += 1;
        gmPrompts.push(user);
        const location = loadCampaignLedger(db, campaignId).location || EXPLORATION_ENTRANCE;
        const fact = user.includes("[EXPLORATION") ? "서버가 확정한 탐험 결과를 장면으로 잇는다." : "현관이 두 갈래로 갈라져 있다.";
        return { text: wire(`${fact} GM: 무엇을 하겠는가.`, location) };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const seeded = loadExplorationState(db, campaignId)!;
    const seed = seeded.seed;
    assert.equal(loadExplorationState(db, campaignId)?.seed, seed);
    for (const id of [hostId, human2, ...ai]) assert.equal(locationOf(db, id), EXPLORATION_ENTRANCE);
    const openingSnap = loadTrpgSnapshot(db, campaignId, 1)!;
    const openingWire = JSON.stringify(openingSnap.exploration);
    assert.equal(openingSnap.exploration?.rooms.some((room) => room.label === "?"), true);
    assert.equal(openingWire.includes(EXPLORATION_CLUE_TEXT), false);
    assert.equal(openingWire.includes(EXPLORATION_ITEM_NAME), false);
    assert.match(gmPrompts[0] ?? "", /\[EXPLORATION/);
    assert.match(gmPrompts[0] ?? "", /Do not invent a clue/);

    const log: string[] = [];
    const submitBoth = (left: { commands?: unknown; body?: string }, right: { commands?: unknown; body?: string }) => {
      submitTrpgAction(db, {
        campaignId,
        userId: 1,
        body: left.body ?? "",
        explorationCommands: left.commands,
      });
      submitTrpgAction(db, {
        campaignId,
        userId: 2,
        body: right.body ?? "",
        explorationCommands: right.commands,
      });
    };
    const play = async () => {
      const before = gmCalls;
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
      log.push(
        JSON.stringify({
          hyun: locationOf(db, hostId),
          doyun: locationOf(db, human2),
          risk: loadExplorationState(db, campaignId)?.risk,
          flags: loadCampaignLedger(db, campaignId).worldFlags,
          gm: gmPrompts.at(-1)?.includes("[EXPLORATION") ? "exploration" : "plain",
        })
      );
      assert.equal(gmCalls, before + 1);
    };

    const entranceForks = neighbors(seeded, EXPLORATION_ENTRANCE);
    assert.ok(entranceForks.length >= 2);
    submitBoth(
      { commands: [{ op: "search", depth: "normal" }, { op: "move", roomId: entranceForks[0] }] },
      { commands: [{ op: "move", roomId: entranceForks[1] }] }
    );
    assert.throws(
      () => submitTrpgAction(db, { campaignId, userId: 1, body: "다시", explorationCommands: [{ op: "move", roomId: entranceForks[0] }] }),
      /이미 제출했습니다/
    );
    await play();
    assert.notEqual(locationOf(db, hostId), locationOf(db, human2));
    assert.equal(loadExplorationState(db, campaignId)?.revealedEventIds.includes("event-clue"), false);
    assert.equal(itemQty(db, hostId, EXPLORATION_ITEM_NAME), 0);

    let alarmRound = 0;
    for (let round = 0; round < 8; round += 1) {
      const state = loadExplorationState(db, campaignId)!;
      const hyunAt = locationOf(db, hostId);
      const doyunAt = locationOf(db, human2);
      const hyunSteps = hyunAt === EXPLORATION_ARCHIVE_ROOM ? [] : stepsToward(state, hyunAt, EXPLORATION_ARCHIVE_ROOM).slice(0, 3);
      const doyunGoal = state.revealedEventIds.includes("event-supply") ? EXPLORATION_ALARM_ROOM : EXPLORATION_STORE_ROOM;
      const doyunSteps = doyunAt === doyunGoal ? [] : stepsToward(state, doyunAt, doyunGoal).slice(0, 3);
      const hyunCommands = [
        ...hyunSteps.map((roomId) => ({ op: "move" as const, roomId })),
        ...(hyunSteps.length < 3 && hyunAt === EXPLORATION_ARCHIVE_ROOM && !state.revealedEventIds.includes("event-clue")
          ? [{ op: "search" as const, depth: "normal" as const }]
          : hyunSteps.length <= 2 && stepsToward(state, hyunSteps.at(-1) ?? hyunAt, EXPLORATION_ARCHIVE_ROOM).length === 0
            ? [{ op: "search" as const, depth: "normal" as const }]
            : []),
      ].slice(0, 3);
      const doyunCommands = [
        ...doyunSteps.map((roomId) => ({ op: "move" as const, roomId })),
        ...(doyunSteps.length < 3 && (doyunSteps.at(-1) ?? doyunAt) === EXPLORATION_STORE_ROOM && !state.revealedEventIds.includes("event-supply")
          ? [{ op: "search" as const, depth: "normal" as const }]
          : []),
      ].slice(0, 3);
      const left = hyunCommands.length ? { commands: hyunCommands } : { body: "숨을 고르며 주변을 살핀다." };
      const right = doyunCommands.length ? { commands: doyunCommands } : { body: "숨을 고르며 주변을 살핀다." };
      submitBoth(left, right);
      await play();
      if (locationOf(db, human2) === EXPLORATION_ALARM_ROOM || locationOf(db, hostId) === EXPLORATION_ALARM_ROOM) alarmRound = round + 2;
      if (
        loadCampaignLedger(db, campaignId).worldFlags.includes(EXPLORATION_CLUE_FLAG) &&
        (itemQty(db, hostId, EXPLORATION_ITEM_NAME) === 1 || itemQty(db, human2, EXPLORATION_ITEM_NAME) === 1) &&
        loadExplorationState(db, campaignId)!.alarmFlagged
      ) {
        break;
      }
    }

    const flags = loadCampaignLedger(db, campaignId).worldFlags;
    assert.ok(flags.includes(EXPLORATION_CLUE_FLAG), flags.join(" | "));
    assert.equal(itemQty(db, hostId, EXPLORATION_ITEM_NAME) + itemQty(db, human2, EXPLORATION_ITEM_NAME), 1);
    assert.equal(loadExplorationState(db, campaignId)?.alarmFlagged, true);
    assert.ok(flags.includes(EXPLORATION_ALARM_FLAG));
    assert.ok(gmPrompts.some((prompt) => prompt.includes(EXPLORATION_CLUE_TEXT)));

    for (let step = 0; step < 4 && locationOf(db, hostId) !== EXPLORATION_ALARM_ROOM && locationOf(db, human2) !== EXPLORATION_ALARM_ROOM; step += 1) {
      const mover = 2;
      const from = locationOf(db, human2);
      const toward = stepsToward(loadExplorationState(db, campaignId)!, from, EXPLORATION_ALARM_ROOM).slice(0, 3);
      submitBoth(
        { body: "다른 방에서 기다린다." },
        toward.length ? { commands: toward.map((roomId) => ({ op: "move" as const, roomId })) } : { body: "기다린다." }
      );
      await play();
    }
    const struckSeat = locationOf(db, hostId) === EXPLORATION_ALARM_ROOM ? hostId : human2;
    assert.equal(locationOf(db, struckSeat), EXPLORATION_ALARM_ROOM);
    const hpBefore = (db.prepare(`SELECT hp FROM trpg_character_sheets WHERE participant_id=?`).get(struckSeat) as { hp: number }).hp;
    submitBoth(
      struckSeat === hostId ? { body: "경보실에 멈춰 숨을 고른다." } : { body: "다른 방에서 기다린다." },
      struckSeat === human2 ? { body: "경보실에 멈춰 숨을 고른다." } : { body: "다른 방에서 기다린다." }
    );
    await play();
    const strikeRound = (
      db
        .prepare(
          `SELECT id, round_number FROM trpg_rounds WHERE campaign_id=? AND phase='ROUND_COMPLETE' ORDER BY round_number DESC LIMIT 1`
        )
        .get(campaignId) as { id: number; round_number: number }
    );
    const strikes = loadMechanicsResolution(db, strikeRound.id)?.threatStrikes ?? [];
    assert.equal(strikes.length, 1, "approved hazard strikes only on the following round");
    assert.equal(strikes[0]?.targetParticipantId, struckSeat);
    const hpAfter = (db.prepare(`SELECT hp FROM trpg_character_sheets WHERE participant_id=?`).get(struckSeat) as { hp: number }).hp;
    assert.ok(hpAfter < hpBefore);
    assert.equal(alarmRound >= 0, true);
    assert.ok(
      botPrompts.some((prompt) => prompt.includes(EXPLORATION_CLUE_FLAG)),
      "the next companion prompt should remember the discovered clue"
    );

    for (let step = 0; step < 4 && locationOf(db, hostId) !== EXPLORATION_EXIT_ROOM; step += 1) {
      const exitFrom = locationOf(db, hostId);
      const exitSteps = stepsToward(loadExplorationState(db, campaignId)!, exitFrom, EXPLORATION_EXIT_ROOM).slice(0, 3);
      assert.ok(exitSteps.length > 0, `no route from ${exitFrom} to the exit`);
      submitBoth(
        { commands: exitSteps.map((roomId) => ({ op: "move" as const, roomId })) },
        { body: "현이를 기다린다." }
      );
      await play();
    }
    assert.equal(locationOf(db, hostId), EXPLORATION_EXIT_ROOM);
    const revealedBefore = loadExplorationState(db, campaignId)!.revealedEventIds.length;
    const qtyBefore = itemQty(db, hostId, EXPLORATION_ITEM_NAME) + itemQty(db, human2, EXPLORATION_ITEM_NAME);
    submitBoth(
      { commands: [{ op: "search", depth: "normal" }] },
      { body: "이미 찾은 물건을 다시 세지 않는다." }
    );
    await play();
    assert.equal(loadExplorationState(db, campaignId)!.revealedEventIds.length, revealedBefore);
    assert.equal(itemQty(db, hostId, EXPLORATION_ITEM_NAME) + itemQty(db, human2, EXPLORATION_ITEM_NAME), qtyBefore);

    const holder = itemQty(db, hostId, EXPLORATION_ITEM_NAME) === 1 ? hostId : human2;
    const committed = (
      db.prepare(
        `SELECT g.narration FROM trpg_gm_messages g JOIN trpg_rounds r ON r.id=g.round_id WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
      ).get(campaignId) as { narration: string }
    ).narration;
    deps.gmCall = async ({ user }) => {
      gmPrompts.push(user);
      return {
        text: wire(`같은 열쇠는 그대로 두고 문장만 바꾼다. GM: 무엇을 하겠는가.`, loadCampaignLedger(db, campaignId).location),
      };
    };
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    const rewritten = (
      db.prepare(
        `SELECT g.narration FROM trpg_gm_messages g JOIN trpg_rounds r ON r.id=g.round_id WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`
      ).get(campaignId) as { narration: string }
    ).narration;
    assert.notEqual(rewritten, committed);
    assert.equal(itemQty(db, holder, EXPLORATION_ITEM_NAME), 1);
    assert.equal(gmPrompts.at(-1)?.includes("[EXPLORATION"), false);
    assert.equal(botCalls > 0, true);
    assert.equal(gmCalls > 0, true);
    const cluePrompt = gmPrompts.find((prompt) => prompt.includes("found this clue exactly once")) ?? "";
    const memoryLine = botPrompts.find((prompt) => prompt.includes(EXPLORATION_CLUE_FLAG)) ?? "";
    console.log(
      JSON.stringify(
        {
          seed,
          gmCalls,
          botCalls,
          paidProviderCalls: 0,
          log,
          strike: strikes[0]?.name,
          clueExcerpt: cluePrompt.split("\n").filter((line) => line.includes("found this clue") || line.startsWith("[EXPLORATION")).slice(0, 4),
          memoryExcerpt: memoryLine.split("\n").filter((line) => line.includes(EXPLORATION_CLUE_FLAG)).slice(0, 2),
          regenNarration: rewritten,
        },
        null,
        2
      )
    );
    db.close();
  });

  it("spends AP once when a search fails and does not move or reveal", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "실패 조사",
      summary: "조사 실패",
      content: "현관에서 조사하다 실패한다.",
      visibility: "public",
      startLocation: EXPLORATION_ENTRANCE,
      scenarioPlan: {
        startingSituation: "현관에 선다",
        centralConflict: "문을 살핀다",
        goal: "단서를 찾는다",
        endingConditions: ["단서를 찾는다"],
        exploration: true,
      },
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    const prompts: string[] = [];
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 1,
      gmCall: async ({ user }) => {
        prompts.push(user);
        const location = loadCampaignLedger(db, campaignId).location || EXPLORATION_ENTRANCE;
        return { text: wire("조사가 흐트러진다. GM: 무엇을 하겠는가.", location) };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const seeded = loadExplorationState(db, campaignId)!;
    const fork = neighbors(seeded, EXPLORATION_ENTRANCE)[0];
    assert.ok(fork);
    assert.throws(
      () => submitTrpgAction(db, { campaignId, userId: 1, body: "", explorationCommands: [{ op: "move", roomId: "없는방" }] }),
      /연결되지 않은 곳으로는 이동할 수 없습니다/
    );
    const longWalk: string[] = [];
    let cursor = EXPLORATION_ENTRANCE;
    const seen = new Set<string>([cursor]);
    for (let step = 0; step < 4; step += 1) {
      const next = neighbors(seeded, cursor).find((roomId) => !seen.has(roomId));
      assert.ok(next, "a four-step walk should exist");
      longWalk.push(next);
      seen.add(next);
      cursor = next;
    }
    assert.throws(
      () =>
        submitTrpgAction(db, {
          campaignId,
          userId: 1,
          body: "",
          explorationCommands: longWalk.map((roomId) => ({ op: "move" as const, roomId })),
        }),
      /행동력이 부족합니다/
    );
    assert.equal(loadExplorationState(db, campaignId)?.pending.length, 0);
    const round = (
      db.prepare(`SELECT id, round_number FROM trpg_rounds WHERE campaign_id=? ORDER BY round_number DESC LIMIT 1`).get(campaignId) as {
        id: number;
        round_number: number;
      }
    );
    submitTrpgAction(db, {
      campaignId,
      userId: 1,
      body: "",
      explorationCommands: [
        { op: "search", depth: "normal" },
        { op: "move", roomId: fork },
      ],
    });
    const spent = loadExplorationState(db, campaignId)!;
    assert.equal(spent.apRoundNumber, round.round_number);
    assert.equal(spent.apRemaining[String(hostId)], 1);
    assert.equal(spent.pending.length, 1);
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, hostId), EXPLORATION_ENTRANCE);
    assert.equal(loadExplorationState(db, campaignId)?.revealedEventIds.includes("event-clue"), false);
    assert.equal(loadExplorationState(db, campaignId)?.risk, 1);
    assert.equal(loadExplorationState(db, campaignId)?.appliedKeys.length, 1);
    assert.match(prompts.at(-1) ?? "", /search failed/);
    const snap = loadTrpgSnapshot(db, campaignId, 1);
    assert.equal(snap?.exploration?.ap, 3);
    assert.equal(itemQty(db, hostId, EXPLORATION_ITEM_NAME), 0);
    db.close();
  });

  it("prices free-text movement for a human and an AI companion on the same map rules", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "자유 이동",
      summary: "지도 규칙",
      content: "현관에서 갈림을 고른다.",
      visibility: "public",
      startLocation: EXPLORATION_ENTRANCE,
      scenarioPlan: PLAN,
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    const botId = insertParticipant(db, {
      campaignId,
      slotIndex: 2,
      kind: "ai_character",
      userId: null,
      characterId: null,
      displayName: "서하",
    });
    writeSheet(db, campaignId, botId, "서하", EVEN_STATS, EXPLORATION_ENTRANCE);
    let botLine = "제자리에 서서 상황을 살핀다.";
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      rollDie: () => 2,
      botCall: async () => ({ text: botLine }),
      gmCall: async () => {
        gmCalls += 1;
        return {
          text: wirePlayers("GM이 둘을 출구에 놓으려 한다. GM: 무엇을 하겠는가.", EXPLORATION_EXIT_ROOM, [
            { participantId: hostId, location: EXPLORATION_EXIT_ROOM },
            { participantId: botId, location: EXPLORATION_EXIT_ROOM },
          ]),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const callsAfterOpening = gmCalls;
    assert.throws(
      () => submitTrpgAction(db, { campaignId, userId: 1, body: "출구로 이동한다." }),
      /연결되지 않은 곳으로는 이동할 수 없습니다/
    );
    assert.equal(gmCalls, callsAfterOpening);
    assert.equal(locationOf(db, hostId), EXPLORATION_ENTRANCE);
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(loadCampaignLedger(db, campaignId).location, EXPLORATION_ENTRANCE);
    const untouched = loadExplorationState(db, campaignId)!;
    assert.deepEqual(untouched.visitedRoomIds, [EXPLORATION_ENTRANCE]);
    assert.equal(untouched.pending.length, 0);
    assert.equal(untouched.apRemaining[String(hostId)], undefined);
    const fork = neighbors(untouched, EXPLORATION_ENTRANCE)[0];
    assert.ok(fork);
    botLine = "출구로 이동한다.";
    submitTrpgAction(db, { campaignId, userId: 1, body: `${fork}로 이동한다.` });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, hostId), fork);
    assert.equal(locationOf(db, botId), EXPLORATION_ENTRANCE);
    assert.equal(loadCampaignLedger(db, campaignId).location, EXPLORATION_ENTRANCE);
    const afterBypass = loadExplorationState(db, campaignId)!;
    assert.equal(afterBypass.visitedRoomIds.includes(fork), true);
    assert.equal(afterBypass.visitedRoomIds.includes(EXPLORATION_EXIT_ROOM), false);
    assert.equal(afterBypass.apRemaining[String(hostId)], 2);
    assert.equal(afterBypass.apRemaining[String(botId)], undefined);
    const lockedBot = (
      db
        .prepare(
          `SELECT body FROM trpg_action_submissions WHERE participant_id=? ORDER BY id DESC LIMIT 1`
        )
        .get(botId) as { body: string }
    ).body;
    assert.equal(lockedBot.includes(EXPLORATION_EXIT_ROOM), false);
    botLine = `${fork}로 이동한다.`;
    submitTrpgAction(db, { campaignId, userId: 1, body: "숨을 고르며 주변을 살핀다." });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.equal(locationOf(db, botId), fork);
    assert.equal(locationOf(db, hostId), fork);
    const botMoved = loadExplorationState(db, campaignId)!;
    assert.equal(botMoved.apRemaining[String(botId)], 2);
    assert.equal(loadCampaignLedger(db, campaignId).location, EXPLORATION_ENTRANCE);
    db.close();
  });

  it("opens the exit only after the alarm and does not require the clue", async () => {
    const db = memoryDb();
    const templateId = insertScenarioTemplate(db, 7, {
      title: "출구 빗장",
      summary: "경보 후 탈출",
      content: "경보 없이 출구로 가지 않는다.",
      visibility: "public",
      startLocation: EXPLORATION_ENTRANCE,
      scenarioPlan: {
        startingSituation: "현관에 선다",
        centralConflict: "빗장을 푼다",
        goal: "출구에 도착한다",
        endingConditions: ["출구에 도착한다"],
        exploration: true,
      },
    });
    const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "현이", viewerUserId: 1, templateId });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "현이", stats: EVEN_STATS });
    const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=1`).get(campaignId) as { id: number }).id;
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      rollD20: () => 16,
      gmCall: async () => ({
        text: wire("서버가 정한 자리만 서술한다. GM: 무엇을 하겠는가.", loadCampaignLedger(db, campaignId).location || EXPLORATION_ENTRANCE),
      }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    const play = async (commands: Array<{ op: "move"; roomId: string } | { op: "search"; depth: "normal" }>) => {
      submitTrpgAction(db, { campaignId, userId: 1, body: "", explorationCommands: commands });
      await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    };
    for (let guard = 0; guard < 6 && locationOf(db, hostId) !== EXPLORATION_EXIT_ROOM; guard += 1) {
      const here = locationOf(db, hostId);
      const path = stepsToward(loadExplorationState(db, campaignId)!, here, EXPLORATION_EXIT_ROOM);
      const approach = path.slice(0, -1).slice(0, 3);
      if (!approach.length) break;
      await play(approach.map((roomId) => ({ op: "move", roomId })));
    }
    const beside = locationOf(db, hostId);
    assert.notEqual(beside, EXPLORATION_EXIT_ROOM);
    assert.ok(neighbors(loadExplorationState(db, campaignId)!, beside).includes(EXPLORATION_EXIT_ROOM));
    assert.throws(
      () =>
        submitTrpgAction(db, {
          campaignId,
          userId: 1,
          body: "",
          explorationCommands: [{ op: "move", roomId: EXPLORATION_EXIT_ROOM }],
        }),
      /출구 빗장은 경보가 울린 뒤에만 풀립니다/
    );
    assert.equal(locationOf(db, hostId), beside);
    assert.equal(loadExplorationState(db, campaignId)?.pending.length, 0);
    for (let guard = 0; guard < 8 && !loadExplorationState(db, campaignId)?.alarmFlagged; guard += 1) {
      await play([{ op: "search", depth: "normal" }]);
    }
    assert.equal(loadExplorationState(db, campaignId)?.alarmFlagged, true);
    assert.equal(loadCampaignLedger(db, campaignId).worldFlags.includes(EXPLORATION_CLUE_FLAG), false);
    await play([{ op: "move", roomId: EXPLORATION_EXIT_ROOM }]);
    assert.equal(locationOf(db, hostId), EXPLORATION_EXIT_ROOM);
    assert.equal(loadCampaignLedger(db, campaignId).worldFlags.includes(EXPLORATION_CLUE_FLAG), false);
    db.close();
  });
});
