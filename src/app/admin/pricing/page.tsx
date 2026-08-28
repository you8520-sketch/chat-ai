import { getSessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/isAdminUser";
import { getDb } from "@/lib/db";
import { redirect } from "next/navigation";
import { listPublishedModelIds, getPublishedPricing } from "@/lib/publishedModelPricing";
import { simulatePremiumCompetitive, COMPETITOR_BENCHMARKS } from "@/lib/shadowSimulations";

export const dynamic = "force-dynamic";

export default async function AdminPricingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const db = getDb();
  const adminRow = db.prepare("SELECT is_admin FROM users WHERE id=?").get(user.id) as { is_admin: number } | undefined;
  if (!isAdminUser({ email: user.email, is_admin: adminRow?.is_admin ?? 0 })) redirect("/");

  const models = listPublishedModelIds();
  const geminiSim = simulatePremiumCompetitive({
    modelId: "gemini-3.1-pro-preview",
    inputTokens: COMPETITOR_BENCHMARKS.gemini31.inputTokens,
    outputTokens: COMPETITOR_BENCHMARKS.gemini31.outputTokens,
    benchmarkChargeP: COMPETITOR_BENCHMARKS.gemini31.chargeP,
    candidateMargins: [0.1, 0.15, 0.175, 0.2, 0.25, 0.3],
    minimumMarginFloor: getPublishedPricing("gemini-3.1-pro-preview").minimumMarginFloor,
  });
  const opusSim = simulatePremiumCompetitive({
    modelId: "claude-opus-5",
    inputTokens: COMPETITOR_BENCHMARKS.opus5.inputTokens,
    outputTokens: COMPETITOR_BENCHMARKS.opus5.outputTokens,
    benchmarkChargeP: COMPETITOR_BENCHMARKS.opus5.chargeP,
    candidateMargins: [0.1, 0.15, 0.175, 0.2, 0.25, 0.3],
    minimumMarginFloor: getPublishedPricing("claude-opus-5").minimumMarginFloor,
  });

  return (
    <div className="mx-auto max-w-6xl p-6 text-sm text-zinc-100">
      <h1 className="text-xl font-bold">Pricing Diagnostics — Shadow Only (Phase 2)</h1>
      <p className="mt-2 text-zinc-400">USER BILLING BEHAVIOR_CHANGED: false · Published pricing is shadow only. Live discount does NOT control standard price.</p>
      <section className="mt-6">
        <h2 className="font-semibold">Published Catalog (v1)</h2>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>model</th><th>version</th><th>inputRate</th><th>outputRate</th><th>targetMargin</th><th>floor</th></tr></thead>
          <tbody>
            {models.map((id) => {
              const p = getPublishedPricing(id);
              return <tr key={id} className="border-b border-white/5"><td>{id}</td><td>{p.pricingVersion}</td><td>{p.referenceInputRateKrw.toFixed(5)}</td><td>{p.referenceOutputRateKrw.toFixed(5)}</td><td>{(p.targetMargin*100).toFixed(1)}%</td><td>{(p.minimumMarginFloor*100).toFixed(1)}%</td></tr>;
            })}
          </tbody>
        </table>
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">Gemini 3.1 Pro — {COMPETITOR_BENCHMARKS.gemini31.inputTokens} in / {COMPETITOR_BENCHMARKS.gemini31.outputTokens} out / benchmark {COMPETITOR_BENCHMARKS.gemini31.chargeP}P</h2>
        <p className="text-xs text-zinc-500">Reference cost: {geminiSim.referenceCostKrw.toFixed(1)} KRW</p>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10"><th>margin</th><th>shadow charge</th><th>gross profit</th><th>deviation</th><th>flag</th></tr></thead>
          <tbody>{geminiSim.rows.map((r)=><tr key={r.margin} className="border-b border-white/5"><td>{(r.margin*100).toFixed(1)}%</td><td>{r.shadowChargeP}P</td><td>{r.grossProfitP}P</td><td>{r.competitiveDeviationPct != null ? `${r.competitiveDeviationPct}%` : "-"}</td><td>{r.flag}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">Opus 5 — {COMPETITOR_BENCHMARKS.opus5.inputTokens} in / {COMPETITOR_BENCHMARKS.opus5.outputTokens} out / benchmark {COMPETITOR_BENCHMARKS.opus5.chargeP}P</h2>
        <p className="text-xs text-zinc-500">Reference cost: {opusSim.referenceCostKrw.toFixed(1)} KRW · thinking-inclusive status unknown for competitor displayed output</p>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10"><th>margin</th><th>shadow charge</th><th>gross profit</th><th>deviation</th><th>flag</th></tr></thead>
          <tbody>{opusSim.rows.map((r)=><tr key={r.margin} className="border-b border-white/5"><td>{(r.margin*100).toFixed(1)}%</td><td>{r.shadowChargeP}P</td><td>{r.grossProfitP}P</td><td>{r.competitiveDeviationPct != null ? `${r.competitiveDeviationPct}%` : "-"}</td><td>{r.flag}</td></tr>)}</tbody>
        </table>
      </section>
      <p className="mt-6 text-xs text-zinc-500">Shadow metadata is stored per-message in messages.usage.shadowPricing (admin-only). Public receipts are sanitized via billingReceiptAccess.</p>
    </div>
  );
}
