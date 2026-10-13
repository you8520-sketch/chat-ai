import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { creditPointsWithIds } from "@/lib/points";
import { serializeGoals, type TrpgGoal, type TrpgPublicGoal } from "@/lib/trpg/campaignGoals";
import { loadCampaignLedger } from "@/lib/trpg/campaignLedger";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "@/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "@/lib/trpg/engineAdvance";
import { loadTrpgSnapshot } from "@/lib/trpg/engineSnapshot";
import { parseTrpgGmOutput } from "@/lib/trpg/gmPrompt";
import { buildTrpgGmStructuredWireText } from "@/lib/trpg/gmStructuredOutput";
import { answerTrpgGoalClaim } from "@/lib/trpg/goalConfirm";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { ensureTrpgTables } from "@/lib/trpg/schema";
import { insertParticipant } from "@/lib/trpg/store";
import { goalClaimItems } from "./goalClaimView";
import {
  TRPG_GOAL_HUD_ALL_DONE,
  TRPG_GOAL_HUD_NO_GOALS,
  goalHudView,
  nextShownGoals,
} from "./goalHudView";

/**
 * The goal HUD is a read-only view of `snap.goals`. These tests pin the one display rule, using the real engine
 * for the snapshot a host and another human receive. No model is called.
 */

const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/lib/trpg/fixtures/freeGoalClaimReal.json"), "utf8")
) as { goalTitle: string; A_R0_raw: string; A_R2_raw: string };
const TITLE = FIXTURE.goalTitle;
const OPENING = parseTrpgGmOutput(FIXTURE.A_R0_raw);
const CLAIM = parseTrpgGmOutput(FIXTURE.A_R2_raw);
const NEXT_TITLE = "다음 단서 추적: 등대지기를 찾아간다";
const PLAIN = "해무가 짙게 깔린 부두의 장면이 이어진다. GM: 무엇을 하겠는가?";

const active = (id: string, title: string, over: Partial<TrpgPublicGoal> = {}): TrpgPublicGoal => ({
  id,
  title,
  status: "active",
  claimed: false,
  ...over,
});
const done = (id: string, title: string, basis?: TrpgPublicGoal["basis"]): TrpgPublicGoal => ({
  id,
  title,
  status: "completed",
  claimed: false,
  ...(basis ? { basis } : {}),
});

function wire(everyone: number[], extra: Record<string, unknown> = {}, narration = PLAIN): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: everyone.map((participantId) => ({ participantId, location: "마레노 부두" })),
    location: "마레노 부두",
    next_round_context: "",
    campaign_finished: false,
    ...extra,
  });
}

function gm(texts: Array<() => string>): TrpgEngineDeps {
  let call = 0;
  return {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async () => {
      const make = texts[Math.min(call, texts.length - 1)]!;
      call += 1;
      return { text: make() };
    },
  };
}

function party(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
  `);
  for (const [id, nickname] of [[1, "렌"], [2, "현"]] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,0)`).run(id, `${id}@t`, nickname);
    creditPointsWithIds(db, id, 5000, "PAID", `goal-hud-credit-${id}`);
  }
  ensureTrpgTables(db);
  const templateId = insertScenarioTemplate(db, 7, {
    title: "안개항 실종 사건",
    summary: "해무의 항구",
    content: "항구도시에서 사라진 어선을 쫓는다.",
    visibility: "public",
    startLocation: "마레노 부두",
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: 1, hostNickname: "렌", viewerUserId: 1, templateId });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }).invite_code;
  joinTrpgCampaign(db, { code: invite, userId: 2, nickname: "현" });
  saveTrpgSheet(db, { campaignId, userId: 2, name: "현", stats: EVEN_STATS });
  const seat = (userId: number) =>
    (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number }).id;
  const ai: number[] = [];
  for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
    const id = insertParticipant(db, { campaignId, slotIndex: slot, kind: "ai_character", userId: null, characterId: null, displayName: name });
    writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
    ai.push(id);
  }
  return { campaignId, everyone: [seat(1), seat(2), ...ai] };
}

async function round(db: Database.Database, campaignId: number, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: 1, body: "원로 선원에게 해오라기호의 마지막 기적에 대해 묻는다.", actionType: "free" });
  submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

function storeGoals(db: Database.Database, campaignId: number, goals: TrpgGoal[]) {
  const titles = goals.filter((goal) => goal.status === "active").map((goal) => goal.title);
  db.prepare(`UPDATE trpg_campaign_state SET goals_json=?, quests_json=? WHERE campaign_id=?`).run(
    serializeGoals(goals),
    JSON.stringify(titles),
    campaignId
  );
}

const hudFor = (db: Database.Database, campaignId: number, userId: number) =>
  goalHudView(loadTrpgSnapshot(db, campaignId, userId)!.goals);
const claimWire = (everyone: number[]) =>
  wire(everyone, { questsAdd: CLAIM.delta.questsAdd, questsRemove: CLAIM.delta.questsRemove, questsClaimDone: CLAIM.delta.questsClaimDone }, CLAIM.narration);

describe("goal HUD view rule (pure)", () => {
  it("shows nothing when the snapshot carries no goal data, so an older snapshot never claims there are no goals", () => {
    assert.equal(goalHudView(undefined), null);
  });

  it("no goals: says so, and invents none", () => {
    const view = goalHudView([])!;
    assert.equal(view.emptyNotice, TRPG_GOAL_HUD_NO_GOALS);
    assert.equal(view.lead, null);
    assert.deepEqual([view.activeCount, view.pendingCount, view.active.length, view.done.length], [0, 0, 0, 0]);
  });

  it("first goal: one active goal is the lead and there is no empty notice", () => {
    const view = goalHudView([active("g1", "첫 목표")])!;
    assert.equal(view.activeCount, 1);
    assert.equal(view.lead?.title, "첫 목표");
    assert.equal(view.lead?.badge, "active");
    assert.equal(view.emptyNotice, null);
  });

  it("2+ goals: the count is the active total, the lead is the first, and the rest stay listed", () => {
    const view = goalHudView([active("g1", "A"), active("g2", "B"), active("g3", "C")])!;
    assert.equal(view.activeCount, 3);
    assert.equal(view.lead?.id, "g1");
    assert.deepEqual(view.active.map((item) => item.title), ["A", "B", "C"]);
  });

  it("the 12 maximum: every goal is listed and counted, none is dropped or invented", () => {
    const goals = Array.from({ length: 12 }, (_, index) => active(`g${index + 1}`, `목표 ${index + 1}`));
    const view = goalHudView([...goals, done("d1", "끝", "server")])!;
    assert.equal(view.activeCount, 12);
    assert.equal(view.active.length, 12);
    assert.equal(view.done.length, 1);
  });

  it("GM proposal pending: shown as waiting for the host, still counted active, never as complete", () => {
    const view = goalHudView([active("g1", "A", { claimed: true, claimedRound: 2 }), active("g2", "B")])!;
    assert.equal(view.pendingCount, 1);
    assert.equal(view.activeCount, 2);
    const [pending, plain] = view.active;
    assert.equal(pending.badge, "pending");
    assert.equal(pending.label, "확인 대기");
    assert.match(pending.hint ?? "", /방장이 확인하기 전에는 완료가 아닙니다/);
    assert.equal(plain.badge, "active");
    assert.equal(plain.hint, null);
    assert.equal(view.done.length, 0);
  });

  it("host-confirmed, server-verified and evidence-less completions carry three different labels", () => {
    const view = goalHudView([done("a", "A", "host"), done("b", "B", "server"), done("c", "C", "unrecorded"), done("d", "D")])!;
    const byId = Object.fromEntries(view.done.map((item) => [item.id, item]));
    assert.equal(byId.a.label, "방장 확인 완료");
    assert.equal(byId.b.label, "시스템 확인 완료");
    assert.equal(byId.c.label, "완료 기록 · 확인 근거 없음");
    assert.equal(byId.d.label, "완료 기록 · 확인 근거 없음", "a completion without a basis is never labelled verified");
    assert.notEqual(byId.c.badge, "done_server");
    assert.notEqual(byId.d.badge, "done_host");
  });

  it("completed goals come newest first and are not counted as active", () => {
    const view = goalHudView([active("g1", "진행"), done("o", "오래된", "server"), done("m", "중간", "host"), done("n", "최근", "server")])!;
    assert.deepEqual(view.done.map((item) => item.id), ["n", "m", "o"]);
    assert.equal(view.activeCount, 1);
  });

  it("only completed goals left: the bar says nothing is in progress rather than that no goals exist", () => {
    const view = goalHudView([done("a", "A", "server")])!;
    assert.equal(view.lead, null);
    assert.equal(view.emptyNotice, TRPG_GOAL_HUD_ALL_DONE);
  });

  it("the HUD offers no action: its items carry no decision or confirm data", () => {
    const view = goalHudView([active("g1", "A", { claimed: true, claimedRound: 2, confirmable: true })])!;
    assert.deepEqual(Object.keys(view.active[0]).sort(), ["badge", "hint", "id", "label", "title"]);
  });

  it("the same input always gives the same view, and the input is not mutated", () => {
    const goals = [active("g1", "A"), done("d1", "B", "host")];
    const frozen = JSON.stringify(goals);
    assert.deepEqual(goalHudView(goals), goalHudView(goals));
    assert.equal(JSON.stringify(goals), frozen);
  });
});

describe("goal HUD while a round is being revealed", () => {
  it("keeps the goals the player already saw until the reveal ends, then follows the latest snapshot", () => {
    const before = [active("g1", "A")];
    const incoming = [active("g1", "A"), active("g2", "B")];
    assert.equal(nextShownGoals(before, incoming, true), before, "held: the new goal is not shown early");
    assert.equal(nextShownGoals(before, incoming, false), incoming, "released: the new goal appears");
  });

  it("a stale snapshot is the room client's concern: whatever snapshot it hands over is what is shown once released", () => {
    const fresh = [active("g1", "A"), done("d1", "B", "host")];
    const stale = [active("g1", "A")];
    assert.equal(nextShownGoals(fresh, stale, false), stale);
    assert.equal(nextShownGoals(fresh, stale, true), fresh);
  });
});

describe("goal HUD from the real engine snapshot", () => {
  it("first round: the registered first goal is visible to the host and to another human, identically", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = party(db);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: gm([() => wire(everyone, { questsAdd: OPENING.delta.questsAdd }, OPENING.narration)]) });
    const host = hudFor(db, campaignId, 1)!;
    const other = hudFor(db, campaignId, 2)!;
    assert.equal(host.lead?.title, TITLE);
    assert.equal(host.activeCount, 1);
    assert.deepEqual(other, host, "host and other human see the same state");
  });

  it("no goal from the GM: the HUD says there is none and does not infer one from the narration", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = party(db);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: gm([() => wire(everyone, {}, OPENING.narration)]) });
    for (const userId of [1, 2]) {
      const view = hudFor(db, campaignId, userId)!;
      assert.equal(view.emptyNotice, TRPG_GOAL_HUD_NO_GOALS);
      assert.equal(view.activeCount, 0);
    }
  });

  it("pending proposal, host confirmation and the follow-up goal, across reloads", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = party(db);
    const deps = gm([
      () => wire(everyone, { questsAdd: OPENING.delta.questsAdd }, OPENING.narration),
      () => claimWire(everyone),
      () => wire(everyone, { questsAdd: [NEXT_TITLE] }),
    ]);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    await round(db, campaignId, deps);

    const pendingHost = hudFor(db, campaignId, 1)!;
    const pendingOther = hudFor(db, campaignId, 2)!;
    assert.ok(pendingHost.pendingCount >= 1, "the proposal is waiting");
    assert.equal(pendingHost.done.length, 0, "a proposal is not a completion");
    assert.deepEqual(pendingOther, pendingHost, "pending looks the same to the host and to another human");
    assert.deepEqual(hudFor(db, campaignId, 1), pendingHost, "a refresh gives the same view");

    const claimed = loadCampaignLedger(db, campaignId).goals.find((goal) => goal.title === TITLE)!;
    const snapshot = loadTrpgSnapshot(db, campaignId, 1)!;
    assert.equal(goalClaimItems(snapshot.goals, true).length >= 1, true, "the existing claim card still owns the host's answer");

    assert.equal(
      answerTrpgGoalClaim(db, { campaignId, userId: 1, decision: "confirm", goalId: claimed.id, claimedRound: claimed.claimedRound! }).outcome,
      "confirmed"
    );
    const confirmed = hudFor(db, campaignId, 1)!;
    assert.equal(confirmed.pendingCount, 0);
    assert.deepEqual(confirmed.done.map((item) => [item.title, item.label]), [[TITLE, "방장 확인 완료"]]);
    assert.deepEqual(hudFor(db, campaignId, 2), confirmed, "the other human sees the same completion");

    await round(db, campaignId, deps);
    const followUp = hudFor(db, campaignId, 1)!;
    assert.ok(followUp.active.some((item) => item.title === NEXT_TITLE), "the follow-up goal is listed");
    assert.deepEqual(followUp.done.map((item) => item.title), [TITLE], "the confirmed goal stays in the recent list");
    assert.deepEqual(hudFor(db, campaignId, 2), followUp);
  });

  it("server-verified completion, lost-evidence completion and a removed goal", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = party(db);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: gm([() => wire(everyone)]) });
    const goals = [
      { id: "s", title: "서버 확인", status: "completed", source: "gm", createdRound: 0, closedRound: 1, evidence: { kind: "reach_location", round: 1, participantId: 1, location: "등대" } },
      { id: "l", title: "근거 유실", status: "completed", source: "gm", createdRound: 0, closedRound: 2 },
      { id: "r", title: "삭제된 목표", status: "retired", source: "gm", createdRound: 0, closedRound: 2 },
      { id: "a", title: "진행", status: "active", source: "gm", createdRound: 0 },
    ] as unknown as TrpgGoal[];
    storeGoals(db, campaignId, goals);
    const view = hudFor(db, campaignId, 2)!;
    const byTitle = Object.fromEntries([...view.active, ...view.done].map((item) => [item.title, item]));
    assert.equal(byTitle["서버 확인"].label, "시스템 확인 완료");
    assert.equal(byTitle["근거 유실"].label, "완료 기록 · 확인 근거 없음");
    assert.equal(byTitle["삭제된 목표"], undefined, "a removed goal is not listed");
    assert.deepEqual(view.active.map((item) => item.title), ["진행"]);
  });

  it("12 active goals reach the HUD in full", async () => {
    const db = new Database(":memory:");
    const { campaignId, everyone } = party(db);
    await startTrpgCampaign(db, { campaignId, userId: 1, deps: gm([() => wire(everyone)]) });
    const goals = Array.from({ length: 12 }, (_, index) => ({
      id: `a${index + 1}`,
      title: `목표 ${index + 1}`,
      status: "active",
      source: "gm",
      createdRound: 0,
    })) as unknown as TrpgGoal[];
    storeGoals(db, campaignId, goals);
    const view = hudFor(db, campaignId, 1)!;
    assert.equal(view.activeCount, 12);
    assert.equal(view.active.length, 12);
    assert.deepEqual(hudFor(db, campaignId, 2), view);
  });
});
