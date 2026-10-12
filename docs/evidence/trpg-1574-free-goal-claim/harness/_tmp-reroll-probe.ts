import Database from "better-sqlite3";
import { copyFileSync } from "node:fs";
import { regenerateTrpgNarration, type TrpgEngineDeps } from "../src/lib/trpg/engineAdvance";
import { ensureTrpgTables } from "../src/lib/trpg/schema";
import { buildTrpgGmStructuredWireText } from "../src/lib/trpg/gmStructuredOutput";
import { parseTrpgGmOutput } from "../src/lib/trpg/gmPrompt";
import { applyGoalTransition } from "../src/lib/trpg/campaignGoals";
import { readFileSync } from "node:fs";

const HOST_ID = 920001;
const campaignId = Number(process.env.CAMPAIGN_ID);
copyFileSync("/tmp/g1574/fg-work-live.db", "/tmp/g1574/fg-reroll-probe.db");
const db = new Database("/tmp/g1574/fg-reroll-probe.db");
ensureTrpgTables(db);
const goalsOf = () => (db.prepare(`SELECT goals_json, quests_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as { goals_json: string; quests_json: string });
const msg = () => db.prepare(`SELECT g.id, g.narration, g.structured_json FROM trpg_gm_messages g JOIN trpg_rounds r ON r.id=g.round_id WHERE r.campaign_id=? ORDER BY r.round_number DESC LIMIT 1`).get(campaignId) as { id: number; narration: string; structured_json: string };

const before = { goals: goalsOf(), msg: msg() };
const rerolled = "안개가 걷히지 않는 부두의 풍경이다. ".repeat(160) + "GM: 렌은 이제 무엇을 하겠는가?";
const deps: TrpgEngineDeps = {
  skipBilling: true,
  rollD20: () => 14,
  memoryCall: async () => ({ text: "" }),
  botCall: async () => ({ text: "" }),
  gmCall: async () => ({
    text: buildTrpgGmStructuredWireText(rerolled, {
      players: [], location: "마레노 부두", next_round_context: "", campaign_finished: false,
      questsAdd: ["리롤에서 새로 제안한 목표"], questsRemove: [], questsClaimDone: [],
    }),
  }),
};
async function main() {
await regenerateTrpgNarration(db, { campaignId, userId: HOST_ID, deps });
const after = { goals: goalsOf(), msg: msg() };
console.log(JSON.stringify({
  gmMessageIdStable: before.msg.id === after.msg.id,
  narrationChanged: before.msg.narration !== after.msg.narration,
  structuredJsonChanged: before.msg.structured_json !== after.msg.structured_json,
  rerolledStructuredHasQuestsAdd: JSON.parse(after.msg.structured_json).delta?.questsAdd ?? null,
  goalsJsonIdenticalAfterReroll: before.goals.goals_json === after.goals.goals_json,
  questsJsonIdenticalAfterReroll: before.goals.quests_json === after.goals.quests_json,
}, null, 2));

const real = parseTrpgGmOutput(readFileSync("/tmp/g1574/fg-out-live/raw/call-01-A-resolved-r2-response.txt", "utf8"));
const title = "해오라기호의 행방 추적: 선원의 가족이나 부두 사람들에게서 실종 정황을 파악한다";
const replay = applyGoalTransition(
  [{ id: "goal-0-1", title, status: "active", source: "gm", createdRound: 0 }],
  { questsAdd: real.delta.questsAdd, questsRemove: real.delta.questsRemove, questsClaimDone: real.delta.questsClaimDone },
  { round: 2, placeMatches: () => false }
).goals;
console.log("real A delta replayed through applyGoalTransition:", JSON.stringify(replay.map((g) => ({ id: g.id, status: g.status, claimedRound: g.claimedRound ?? null, closedRound: g.closedRound ?? null }))));
db.close();
}
main().catch((e) => { console.error("probe-fatal", e); process.exitCode = 1; });
