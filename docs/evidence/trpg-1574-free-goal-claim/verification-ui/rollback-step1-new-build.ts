import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { answerTrpgGoalClaim } from "@/lib/trpg/goalConfirm";
import {
  CampaignGoalsConflictError,
  applyCampaignLedger,
  loadCampaignLedger,
  loadStoredGoalsJson,
  persistCampaignLedger,
  persistGoalsIfUnchanged,
  settleLedgerForCommit,
} from "@/lib/trpg/campaignLedger";
import { goalCompletionBasis, parseGoalsJson, serializeGoals, type TrpgGoal } from "@/lib/trpg/campaignGoals";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "@/lib/trpg/engineCreate";
import {
  advanceTrpgCampaign,
  regenerateTrpgNarration,
  startTrpgCampaign,
  submitTrpgAction,
  type TrpgEngineDeps,
} from "@/lib/trpg/engineAdvance";
import { loadTrpgSnapshot } from "@/lib/trpg/engineSnapshot";
import {
  TRPG_GOAL_CLAIM_REWRITTEN_MESSAGE,
  TRPG_GOAL_HOST_ONLY_MESSAGE,
  answerTrpgGoalClaim,
  type TrpgGoalClaimDecision,
} from "@/lib/trpg/goalConfirm";
import { buildTrpgGmStructuredWireText } from "@/lib/trpg/gmStructuredOutput";
import { parseTrpgGmOutput } from "@/lib/trpg/gmPrompt";
import { buildCampaignMemoryPrompt, buildTrpgBotMemoryBlock } from "@/lib/trpg/memory";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { ensureTrpgTables } from "@/lib/trpg/schema";
import { insertParticipant } from "@/lib/trpg/store";

const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/lib/trpg/fixtures/freeGoalClaimReal.json"), "utf8")
) as { goalTitle: string; A_R0_raw: string; A_R2_raw: string };
const TITLE = FIXTURE.goalTitle;
const NEXT_TITLE = "곶 끝 등대 또는 세관 기록 조사: 실종 당일 해오라기호와 세관 감시정의 접촉 흔적을 찾는다";
const REAL_A = parseTrpgGmOutput(FIXTURE.A_R2_raw);

function claimText(everyone: number[], extra: Record<string, unknown> = {}, narration = REAL_A.narration): string {
  return buildTrpgGmStructuredWireText(narration, {
    players: everyone.map((participantId) => ({ participantId, location: "마레노 부두" })),
    location: "마레노 부두",
    next_round_context: "",
    campaign_finished: false,
    questsAdd: REAL_A.delta.questsAdd,
    questsRemove: REAL_A.delta.questsRemove,
    questsClaimDone: REAL_A.delta.questsClaimDone,
    ...extra,
  });
}

function plainText(everyone: number[], extra: Record<string, unknown> = {}, narration = "해무가 짙게 깔린 부두의 장면이 이어진다. GM: 무엇을 하겠는가?") {
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

function seedUsersUnused(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS point_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, point_type TEXT NOT NULL, remaining_amount REAL NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS point_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, delta REAL NOT NULL, reason TEXT NOT NULL, message_id INTEGER, chat_id INTEGER);
  `);
  for (const [id, nickname] of [[1, "렌"], [2, "현"], [3, "외부"]] as const) {
    db.prepare(`INSERT INTO users (id, email, nickname, points) VALUES (?,?,?,0)`).run(id, `${id}@t`, nickname);
    creditPointsWithIds(db, id, 5000, "PAID", `goal-confirm-credit-${id}`);
  }
  ensureTrpgTables(db);
}

function createParty(db: Database.Database) {
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
  const hostSeat = seat(1);
  const humanSeat = seat(2);
  return { campaignId, hostSeat, humanSeat, ai, everyone: [hostSeat, humanSeat, ...ai] };
}

async function round(db: Database.Database, campaignId: number, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: 1, body: "원로 선원에게 해오라기호의 마지막 기적에 대해 묻는다.", actionType: "free" });
  submitTrpgAction(db, { campaignId, userId: 2, body: "부두를 살핀다.", actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: 1, deps });
}

/** R0 = the real opening (real goal), R1 = the real claim + remove + add output. */
async function claimedParty(db: Database.Database) {
  seedUsers(db);
  const party = createParty(db);
  const opening = parseTrpgGmOutput(FIXTURE.A_R0_raw);
  const deps = gm([
    () =>
      plainText(party.everyone, { questsAdd: opening.delta.questsAdd }, opening.narration),
    () => claimText(party.everyone),
    () => plainText(party.everyone, { questsAdd: ["다음 단서 추적"] }),
  ]);
  await startTrpgCampaign(db, { campaignId: party.campaignId, userId: 1, deps });
  await round(db, party.campaignId, deps);
  return { ...party, deps };
}


function ensureUser(db: Database.Database, email: string, nickname: string): number {
  const row = db.prepare(`SELECT id FROM users WHERE email=?`).get(email) as { id: number } | undefined;
  if (row) return row.id;
  return Number(db.prepare(`INSERT INTO users (email, nickname, points, pw_hash) VALUES (?,?,5000,'x')`).run(email, nickname).lastInsertRowid);
}

let hostId = 0;
let guestId = 0;

function createPartyReal(db: Database.Database, label: string) {
  const templateId = insertScenarioTemplate(db, hostId, {
    title: `안개항 실종 사건 (${label})`,
    summary: "해무의 항구",
    content: "항구도시에서 사라진 어선을 쫓는다.",
    visibility: "public",
    startLocation: "마레노 부두",
  });
  const campaignId = createTrpgCampaign(db, { hostUserId: hostId, hostNickname: "렌", viewerUserId: hostId, templateId });
  saveTrpgSheet(db, { campaignId, userId: hostId, name: "렌", stats: EVEN_STATS });
  const invite = (db.prepare(`SELECT invite_code FROM trpg_campaigns WHERE id=?`).get(campaignId) as { invite_code: string }).invite_code;
  joinTrpgCampaign(db, { code: invite, userId: guestId, nickname: "현" });
  saveTrpgSheet(db, { campaignId, userId: guestId, name: "현", stats: EVEN_STATS });
  const seat = (userId: number) =>
    (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?`).get(campaignId, userId) as { id: number }).id;
  const ai: number[] = [];
  for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
    const id = insertParticipant(db, { campaignId, slotIndex: slot, kind: "ai_character", userId: null, characterId: null, displayName: name });
    writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
    ai.push(id);
  }
  const hostSeat = seat(hostId);
  const humanSeat = seat(guestId);
  return { campaignId, hostSeat, humanSeat, ai, everyone: [hostSeat, humanSeat, ...ai] };
}

async function roundReal(db: Database.Database, campaignId: number, deps: TrpgEngineDeps) {
  submitTrpgAction(db, { campaignId, userId: hostId, body: "원로 선원에게 해오라기호의 마지막 기적에 대해 묻는다.", actionType: "free" });
  submitTrpgAction(db, { campaignId, userId: guestId, body: "부두를 살핀다.", actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: hostId, deps });
}

async function claimedPartyReal(db: Database.Database, label: string) {
  const party = createPartyReal(db, label);
  const opening = parseTrpgGmOutput(FIXTURE.A_R0_raw);
  const deps = gm([
    () => plainText(party.everyone, { questsAdd: opening.delta.questsAdd }, opening.narration),
    () => claimText(party.everyone),
    () => plainText(party.everyone, { questsAdd: ["다음 단서 추적"] }),
  ]);
  await startTrpgCampaign(db, { campaignId: party.campaignId, userId: hostId, deps });
  await roundReal(db, party.campaignId, deps);
  return { ...party, deps };
}


async function main() {
  const path = process.argv[2]!;
  const db = new Database(path);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, nickname TEXT, points INTEGER NOT NULL DEFAULT 0, pw_hash TEXT)`);
  ensureTrpgTables(db);
  hostId = ensureUser(db, "h@x.test", "렌");
  guestId = ensureUser(db, "g@x.test", "현");
  const party = await claimedPartyReal(db, "rollback");
  const goalId = (loadCampaignLedger(db, party.campaignId).goals.find((g) => g.claimedRound != null))!.id;
  const out = answerTrpgGoalClaim(db, { campaignId: party.campaignId, userId: hostId, goalId, claimedRound: 1, decision: "confirm" });
  const row = db.prepare(`SELECT goals_json, quests_json FROM trpg_campaign_state WHERE campaign_id=?`).get(party.campaignId) as { goals_json: string; quests_json: string };
  console.log("STEP1 new build: host confirmed ->", out.outcome);
  console.log("STEP1 goals_json:", row.goals_json);
  console.log("STEP1 quests_json:", row.quests_json);
  console.log("CAMPAIGN_ID", party.campaignId);
}
main().catch((e) => { console.error(e); process.exit(1); });
