import Database from "better-sqlite3";
import { goalCompletionBasis } from "@/lib/trpg/campaignGoals";
import { loadCampaignLedger } from "@/lib/trpg/campaignLedger";
import { loadTrpgSnapshot } from "@/lib/trpg/engineSnapshot";

const db = new Database(process.argv[2]!);
const campaignId = Number(process.argv[3]);
const ledger = loadCampaignLedger(db, campaignId);
const done = ledger.goals.find((goal) => goal.status === "completed")!;
console.log("STEP3 new build re-upgrade: completed goal basis =", goalCompletionBasis(done), "evidence =", JSON.stringify(done.evidence));
console.log("STEP3 active goals:", JSON.stringify(ledger.goals.filter((g) => g.status === "active").map((g) => g.title)));
const host = (db.prepare(`SELECT host_user_id AS u FROM trpg_campaigns WHERE id=?`).get(campaignId) as { u: number }).u;
const snap = loadTrpgSnapshot(db, campaignId, host)!;
console.log("STEP3 public goals:", JSON.stringify(snap.goals!.map((g) => ({ title: g.title.slice(0, 12), status: g.status, basis: g.basis, claimed: g.claimed }))));
