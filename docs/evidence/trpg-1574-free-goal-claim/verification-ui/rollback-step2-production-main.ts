import Database from "better-sqlite3";
import { advanceTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "@/lib/trpg/engineAdvance";
import { buildTrpgGmStructuredWireText } from "@/lib/trpg/gmStructuredOutput";
import { ensureTrpgTables } from "@/lib/trpg/schema";

async function main() {
  const db = new Database(process.argv[2]!);
  ensureTrpgTables(db);
  const campaignId = Number(process.argv[3]);
  const seats = (db.prepare(`SELECT id FROM trpg_participants WHERE campaign_id=? ORDER BY slot_index`).all(campaignId) as { id: number }[]).map((r) => r.id);
  const before = db.prepare(`SELECT goals_json FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as { goals_json: string };
  const deps: TrpgEngineDeps = {
    skipBilling: true,
    rollD20: () => 15,
    rollDie: () => 4,
    botCall: async () => ({ text: "조용히 주변을 살핀다." }),
    gmCall: async () => ({
      text: buildTrpgGmStructuredWireText("등대의 불빛이 흔들린다. 새로운 단서가 모습을 드러낸다. GM: 무엇을 하겠는가?", {
        players: seats.map((participantId) => ({ participantId, location: "마레노 부두" })),
        location: "마레노 부두",
        next_round_context: "",
        campaign_finished: false,
        questsAdd: ["등대지기의 장부를 확인한다"],
      }),
    }),
  };
  const hostUser = (db.prepare(`SELECT host_user_id AS u FROM trpg_campaigns WHERE id=?`).get(campaignId) as { u: number }).u;
  const guest = (db.prepare(`SELECT user_id AS u FROM trpg_participants WHERE campaign_id=? AND kind='human' AND user_id<>?`).get(campaignId, hostUser) as { u: number }).u;
  submitTrpgAction(db, { campaignId, userId: hostUser, body: "등대로 향한다.", actionType: "free" });
  submitTrpgAction(db, { campaignId, userId: guest, body: "부두를 살핀다.", actionType: "free" });
  await advanceTrpgCampaign(db, { campaignId, userId: hostUser, deps });
  const after = db.prepare(`SELECT goals_json, quests_json, round_number FROM trpg_campaign_state WHERE campaign_id=?`).get(campaignId) as { goals_json: string; quests_json: string; round_number: number };
  console.log("STEP2 production main (1945e2de) played round", after.round_number);
  console.log("STEP2 quests_json:", after.quests_json);
  console.log("STEP2 goals_json byte-identical to before:", after.goals_json === before.goals_json);
}
main().catch((e) => { console.error(e); process.exit(1); });
