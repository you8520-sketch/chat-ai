/**
 * #1541 zero-cost mechanical continuity check over 54 rounds: real engine + real persistence, stubbed model calls,
 * no network. It checks what the code carries forward (goals_json, ledger caps, sealed summary, recent raw rounds),
 * NOT narrative quality. Run: DATA_DIR=/tmp/g1541/sim/data node --conditions=react-server --import tsx /tmp/g1541/sim.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { getDb } from "@/lib/db";
import { getDatabasePath } from "@/lib/dataDir";
import { EVEN_STATS, createTrpgCampaign, joinTrpgCampaign, saveTrpgSheet, writeSheet } from "@/lib/trpg/engineCreate";
import { advanceTrpgCampaign, startTrpgCampaign, submitTrpgAction, type TrpgEngineDeps } from "@/lib/trpg/engineAdvance";
import { loadCampaignLedger } from "@/lib/trpg/campaignLedger";
import { insertScenarioTemplate } from "@/lib/trpg/scenarioTemplates";
import { insertParticipant } from "@/lib/trpg/store";
import { answerTrpgGoalClaim } from "@/lib/trpg/goalConfirm";
import { buildTrpgGmStructuredWireText } from "@/lib/trpg/gmStructuredOutput";
import { loadTrpgSnapshot } from "@/lib/trpg/engineSnapshot";
import { goalHudView } from "@/app/trpg/goalHudView";

globalThis.fetch = (async () => {
  throw new Error("[sim] network blocked");
}) as typeof fetch;
if (!getDatabasePath().startsWith("/tmp/g1541/sim/")) throw new Error("REFUSED: not the isolated sim DB");

const ROUNDS = 54;
const db = getDb();
const stamp = Date.now();
const mk = (l: string, n: string) =>
  Number(db.prepare("INSERT INTO users (email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,5000,1)").run(`sim-${l}-${stamp}@example.invalid`, n, "x").lastInsertRowid);
const host = mk("h", "렌");
const guest = mk("g", "현");
const templateId = insertScenarioTemplate(db, mk("a", "작가"), {
  title: "연속성 점검", summary: "해무의 항구", content: "항구도시.", visibility: "public", startLocation: "마레노 부두",
});
const campaignId = createTrpgCampaign(db, { hostUserId: host, hostNickname: "렌", viewerUserId: host, templateId });
saveTrpgSheet(db, { campaignId, userId: host, name: "렌", stats: EVEN_STATS });
const invite = (db.prepare("SELECT invite_code FROM trpg_campaigns WHERE id=?").get(campaignId) as { invite_code: string }).invite_code;
joinTrpgCampaign(db, { code: invite, userId: guest, nickname: "현" });
saveTrpgSheet(db, { campaignId, userId: guest, name: "현", stats: EVEN_STATS });
const seat = (u: number) => (db.prepare("SELECT id FROM trpg_participants WHERE campaign_id=? AND user_id=?").get(campaignId, u) as { id: number }).id;
const ids = [seat(host), seat(guest)];
for (const [slot, name] of [[2, "서하"], [3, "도윤"]] as const) {
  const id = insertParticipant(db, { campaignId, slotIndex: slot, kind: "ai_character", userId: null, characterId: null, displayName: name, persona: { description: name, greeting: "", systemPrompt: "" } });
  writeSheet(db, campaignId, id, name, EVEN_STATS, "마레노 부두");
  ids.push(id);
}

let round = 0;
const wires: Record<number, string> = {};
const delta = (r: number): Record<string, unknown> => {
  const extra: Record<string, unknown> = { npcsAdd: [`NPC${r}`], flagsAdd: [`FLAG${r}`] };
  if (r % 6 === 1) extra.questsAdd = [`목표${r}`];
  if (r % 6 === 4) extra.questsClaimDone = [`목표${r - 3}`];
  return { players: ids.map((participantId) => ({ participantId, location: "마레노 부두" })), location: "마레노 부두", next_round_context: `ctx${r}`, campaign_finished: false, ...extra };
};
const deps: TrpgEngineDeps = {
  skipBilling: true,
  rollD20: () => 15,
  rollDie: () => 4,
  memoryCall: async () => { throw new Error("stubbed: deterministic fallback seal"); },
  botCall: async () => ({ text: "주변을 살핀다.\n<<<ACTION_TYPE>>>\ninvestigate\n<<<INTENT>>>\n주변을 살핀다." }),
  gmCall: async ({ user }) => {
    wires[round] = user;
    return { text: buildTrpgGmStructuredWireText(`MARK${round} 장면 ${round}. GM: 무엇을 하겠는가?`, delta(round)) };
  },
};

async function main() {
  const rows: Array<Record<string, unknown>> = [];
  await startTrpgCampaign(db, { campaignId, userId: host, deps });
  for (round = 1; round <= ROUNDS; round++) {
    submitTrpgAction(db, { campaignId, userId: host, body: `행동 ${round}: 부두를 살핀다.`, actionType: "free" });
    submitTrpgAction(db, { campaignId, userId: guest, body: `행동 ${round}: 주변 사람에게 말을 건다.`, actionType: "free" });
    await advanceTrpgCampaign(db, { campaignId, userId: host, deps });
    const pending = loadCampaignLedger(db, campaignId).goals.find((g) => g.status === "active" && g.claimedRound != null);
    if (pending) answerTrpgGoalClaim(db, { campaignId, userId: host, decision: "confirm", goalId: pending.id, claimedRound: pending.claimedRound! });
    const ledger = loadCampaignLedger(db, campaignId);
    const snap = loadTrpgSnapshot(db, campaignId, host);
    const hud = goalHudView(snap?.goals);
    rows.push({
      round, goalsStored: ledger.goals.length, active: ledger.goals.filter((g) => g.status === "active").length,
      completed: ledger.goals.filter((g) => g.status === "completed").length, npcs: ledger.npcs.length, flags: ledger.worldFlags.length,
      hudActive: hud?.activeCount, hudDone: hud?.done.length,
    });
  }
  const probe = (r: number, needles: string[]) => {
    const w = wires[r] ?? "";
    return {
      round: r, wireChars: w.length,
      sealedChars: (w.match(/\[SEALED CAMPAIGN SUMMARY\]([\s\S]*?)\n\[RECENT ROUNDS/)?.[1] ?? "").length,
      recentRawRounds: [...w.matchAll(/\[ROUND (\d+)\]/g)].map((m) => Number(m[1])),
      present: Object.fromEntries(needles.map((n) => [n, new RegExp(`(?<![0-9])${n}(?![0-9])`).test(w)])),
    };
  };
  const needles = ["MARK1", "MARK5", "MARK20", "NPC2", "NPC40", "FLAG2", "FLAG30", "목표1", "목표7", "목표49"];
  const out = {
    note: "stubbed model calls, deterministic fallback seal summary; checks carried-forward state only",
    rows,
    probes: [10, 20, 30, 40, 50, 54].map((r) => probe(r, needles)),
    finalLedger: loadCampaignLedger(db, campaignId),
    sealedSummaryAtR54: (wires[54] ?? "").match(/\[SEALED CAMPAIGN SUMMARY\]([\s\S]*?)\n\[RECENT ROUNDS/)?.[1] ?? null,
    structuredStateBlockAtR54: (wires[54] ?? "").match(/\[TRPG STRUCTURED STATE[\s\S]*?\n\[SEALED/)?.[0] ?? null,
  };
  mkdirSync("/tmp/g1541/sim/out", { recursive: true });
  writeFileSync("/tmp/g1541/sim/out/continuity-54.json", `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ last: rows[rows.length - 1], probes: out.probes }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
