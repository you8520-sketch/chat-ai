import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { EVEN_STATS, createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "./engineAdvance";
import { emptyCampaignContext, loadCampaignContext, persistCampaignContext } from "./campaignContext";
import { markGmGenerationCommitted } from "./gmGenerationLease";
import { insertScenarioTemplate } from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";
import { emptyStoryProgress } from "./storyProgress";
import { parseTrpgScenarioPlan } from "./scenarioPlan";

const P35B_PLAN = {
  version: 1 as const,
  startingSituation: "항구 도시 마레노",
  centralConflict: "실종과 장부",
  goal: "진실을 밝힌다",
  secret: "서랍 속 장부",
  endingConditions: ["장부의 가명을 확인한다"],
  majorEvents: ["야간 등대에서 실종 신고가 터진다", "창고에서 장부를 발견한다"],
  clues: ["인수자 기록이 적힌 푸른 장부", "장부 마지막 줄의 가명", "서랍 속 장부 문장"],
  forbiddenEvents: [],
  boss: "",
  specialRules: [],
  difficulty: "normal" as const,
  climax: "등대",
  endingCandidates: [],
  factionChanges: [],
  gmDirection: "",
  playLength: "medium" as const,
};

const ADVENTURE = {
  start: "platform",
  places: [
    { key: "platform", name: "승강장", summary: "비.", role: "start" as const },
    { key: "car3", name: "객차", summary: "좌석.", role: "hub" as const },
    { key: "engine", name: "기관실", summary: "계기.", role: "goal" as const },
  ],
  links: [
    { from: "platform", to: "car3" },
    { from: "car3", to: "engine", opensBy: "ticket" },
  ],
  events: [{ key: "ticket", place: "car3", trigger: "search" as const, kind: "clue" as const, text: "암호." }],
};

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0)`);
  db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (1,'a@t','host',5000)`).run();
  ensureTrpgTables(db);
  return db;
}

function wire(hostId: number, delta: Record<string, unknown>, narration = "장면이 이어진다."): string {
  return JSON.stringify({
    narration,
    delta: {
      players: [{ participantId: hostId, location: "마레노" }],
      location: "마레노",
      next_round_context: "",
      campaign_finished: false,
      storyPhase: "INTRO",
      ...delta,
    },
  });
}

function setupCampaign(db: Database.Database, scenarioPlan: Record<string, unknown> = P35B_PLAN) {
  const templateId = insertScenarioTemplate(db, 7, {
    title: "P35C",
    summary: "검증",
    content: "항구 조사.",
    visibility: "public",
    startLocation: "마레노",
    scenarioPlan: scenarioPlan as typeof P35B_PLAN,
  });
  const campaignId = createTrpgCampaign(db, {
    hostUserId: 1,
    hostNickname: "렌",
    viewerUserId: 1,
    templateId,
  });
  saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
  const hostId = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=?`).get(campaignId) as { id: number })
    .id;
  return { campaignId, hostId, templateId };
}

function baseDeps(hostId: number): TrpgEngineDeps {
  return {
    skipBilling: true,
    rollD20: () => 15,
    botCall: async () => ({ text: "주변을 살핀다." }),
    gmCall: async () => ({ text: wire(hostId, {}) }),
  };
}

function planSection(user: string): string {
  const start = user.indexOf("[SCENARIO PLAN]");
  if (start < 0) return "";
  const end = user.indexOf("\n\n[", start + 1);
  return end < 0 ? user.slice(start) : user.slice(start, end);
}

describe("TRPG story progress engine path (P3-5C gate)", () => {
  it("round commit → next GM user block drops consumed pending lines only", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setupCampaign(db);
    const gmUsers: string[] = [];
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      ...baseDeps(hostId),
      gmCall: async ({ user }) => {
        gmCalls += 1;
        gmUsers.push(user);
        if (gmCalls === 1) {
          return { text: wire(hostId, {}, "오프닝.") };
        }
        if (gmCalls === 2) {
          return {
            text: wire(
              hostId,
              {
                occurredMajorEventIndices: [1],
                revealedClueIndices: [0],
                storyPhase: "DEVELOPMENT",
              },
              "창고에서 장부를 발견한다."
            ),
          };
        }
        return { text: wire(hostId, {}, "다음 라운드.") };
      },
    };

    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, emptyStoryProgress());

    submitTrpgAction(db, { campaignId, userId: 1, body: "창고로 간다.", actionType: "move" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, {
      occurredMajorEventIndices: [1],
      revealedClueIndices: [0],
    });

    submitTrpgAction(db, { campaignId, userId: 1, body: "등대를 본다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });

    const nextInput = gmUsers[gmUsers.length - 1]!;
    const plan = planSection(nextInput);
    assert.match(plan, /\[0\] 야간 등대에서 실종 신고가 터진다/);
    assert.doesNotMatch(plan, /창고에서 장부를 발견한다/);
    assert.doesNotMatch(plan, /인수자 기록이 적힌 푸른 장부/);
    assert.match(plan, /\[1\] 장부 마지막 줄의 가명/);

    const round1 = db
      .prepare(`SELECT structured_json FROM trpg_gm_messages WHERE round_id=(SELECT id FROM trpg_rounds WHERE campaign_id=? AND round_number=1)`)
      .get(campaignId) as { structured_json: string };
    const stored = JSON.parse(round1.structured_json) as { delta: Record<string, unknown> };
    assert.deepEqual(stored.delta.occurredMajorEventIndices, [1]);
    assert.deepEqual(stored.delta.revealedClueIndices, [0]);
    db.close();
  });

  it("foreshadowing without indices does not consume plan lines", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setupCampaign(db);
    let gmCalls = 0;
    let planAfterHint = "";
    const deps: TrpgEngineDeps = {
      ...baseDeps(hostId),
      gmCall: async ({ user }) => {
        gmCalls += 1;
        if (gmCalls === 2) {
          planAfterHint = planSection(user);
          return {
            text: wire(
              hostId,
              {},
              "곧 창고에서 무언가 일어날 것 같다는 암시만 한다."
            ),
          };
        }
        return { text: wire(hostId, {}) };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "주변을 살핀다.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, emptyStoryProgress());
    assert.match(planAfterHint, /창고에서 장부를 발견한다/);
    assert.match(planAfterHint, /인수자 기록이 적힌 푸른 장부/);
    db.close();
  });

  it("invalid and duplicate indices: only in-bounds unique values persist", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setupCampaign(db);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      ...baseDeps(hostId),
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 2) {
          return {
            text: wire(hostId, {
              occurredMajorEventIndices: [99, -1, 1, 1, 1.2 as unknown as number],
              revealedClueIndices: ["0" as unknown as number, 0, 3],
            }),
          };
        }
        return { text: wire(hostId, {}) };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "행동.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, {
      occurredMajorEventIndices: [1],
      revealedClueIndices: [0],
    });
    db.close();
  });

  it("regen does not rewrite committed story progress", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setupCampaign(db);
    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      ...baseDeps(hostId),
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 1) return { text: wire(hostId, {}, "원본.") };
        if (gmCalls === 2) {
          return {
            text: wire(
              hostId,
              { occurredMajorEventIndices: [0], revealedClueIndices: [1] },
              "첫 라운드."
            ),
          };
        }
        return {
          text: wire(
            hostId,
            { occurredMajorEventIndices: [1], revealedClueIndices: [2] },
            "리롤 서술."
          ),
        };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "조사.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    const before = loadCampaignContext(db, campaignId)?.storyProgress;
    assert.deepEqual(before, { occurredMajorEventIndices: [0], revealedClueIndices: [1] });
    await regenerateTrpgNarration(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, before);
    db.close();
  });

  it("stale generation commit is rejected and leaves story progress unchanged", () => {
    const db = memoryDb();
    const { campaignId } = setupCampaign(db);
    const progress = { occurredMajorEventIndices: [0], revealedClueIndices: [1] };
    persistCampaignContext(db, {
      ...emptyCampaignContext(campaignId),
      directorPlan: parseTrpgScenarioPlan(P35B_PLAN),
      storyProgress: progress,
    });
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, lock_holder_request_id, gm_generation_id)
           VALUES (?, 1, 'GENERATING_NARRATION', 'token-a', 'token-a')`
        )
        .run(campaignId).lastInsertRowid
    );
    assert.equal(markGmGenerationCommitted(db, roundId, "token-a", "token-a"), true);
    assert.equal(markGmGenerationCommitted(db, roundId, "token-b", "token-b"), false);
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, progress);
    db.close();
  });

  it("legacy row with null story_progress_json loads and accepts new commits", async () => {
    const db = memoryDb();
    const { campaignId, hostId } = setupCampaign(db);
    db.prepare(`DELETE FROM trpg_campaign_context WHERE campaign_id=?`).run(campaignId);
    db.prepare(
      `INSERT INTO trpg_campaign_context (
         campaign_id, source_mode, director_plan_json, story_phase,
         active_threads_json, resolved_threads_json, ending_status_json
       ) VALUES (?, 'scenario', ?, 'INTRO', '[]', '[]', '{}')`
    ).run(campaignId, JSON.stringify(P35B_PLAN));
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, emptyStoryProgress());

    let gmCalls = 0;
    const deps: TrpgEngineDeps = {
      ...baseDeps(hostId),
      gmCall: async () => {
        gmCalls += 1;
        if (gmCalls === 2) {
          return { text: wire(hostId, { occurredMajorEventIndices: [0] }) };
        }
        return { text: wire(hostId, {}) };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "행동.", actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.deepEqual(loadCampaignContext(db, campaignId)?.storyProgress, { occurredMajorEventIndices: [0], revealedClueIndices: [] });
    db.close();
  });

  it("Adventure-authored plan keeps free clue list out of GM input", async () => {
    const db = memoryDb();
    const planWithAdventure = { ...P35B_PLAN, adventure: ADVENTURE };
    const { campaignId, hostId } = setupCampaign(db, planWithAdventure);
    let gmCalls = 0;
    let secondUser = "";
    const deps: TrpgEngineDeps = {
      ...baseDeps(hostId),
      gmCall: async ({ user }) => {
        gmCalls += 1;
        if (gmCalls === 2) secondUser = user;
        return { text: wire(hostId, { revealedClueIndices: [0] }) };
      },
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });
    submitTrpgAction(db, { campaignId, userId: 1, body: "탐색.", actionType: "investigate" });
    await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
    assert.doesNotMatch(secondUser, /단서:/);
    assert.doesNotMatch(secondUser, /암호\./);
    assert.match(secondUser, /\[SCENARIO PLAN\]/);
    db.close();
  });
});
