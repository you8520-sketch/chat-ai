import { getSessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/isAdminUser";
import { getDb } from "@/lib/db";
import { redirect } from "next/navigation";
import { listPublishedModelIds, getPublishedPricing } from "@/lib/publishedModelPricing";
import { simulatePremiumCompetitive, TOKEN_USAGE_COMPETITOR_BENCHMARKS, PREMIUM_MARGIN_CANDIDATES } from "@/lib/shadowSimulations";

export const dynamic = "force-dynamic";

function formatCostStatus(status: string): string {
  if (status === "complete") return "Complete";
  if (status === "partial_missing_cache_rate") return "Partial";
  if (status === "reference_rates_unavailable") return "Unavailable";
  return status;
}

function formatActualCostSource(source: string): string {
  if (source === "cheaper_inference_billed") return "CheaperInference billed";
  if (source === "provider_reported") return "Provider reported";
  if (source === "live_catalog_estimated") return "Estimated (live catalog)";
  if (source === "published_fallback_estimated") return "Estimated (published fallback)";
  if (source === "unavailable") return "Unavailable";
  return source;
}

function formatReserveStatus(status: string): string {
  if (status === "complete") return "Complete";
  if (status === "estimated") return "Estimated";
  return "Unavailable";
}

function EconomicsHeader(props: {
  title: string;
  sim: ReturnType<typeof simulatePremiumCompetitive>;
  modelId: string;
}) {
  const { title, sim, modelId } = props;
  const pub = getPublishedPricing(modelId);
  const fxLockLabel = sim.fxSnapshot.locked ? "LOCKED" : "PREVIEW / NOT YET LOCKED";
  return (
    <div className="mt-4 rounded border border-white/10 p-3 text-xs text-zinc-300">
      <h3 className="font-semibold text-zinc-100">{title}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
        <div><dt className="text-zinc-500">pricing version</dt><dd>{pub.pricingVersion}</dd></div>
        <div><dt className="text-zinc-500">FX lock status</dt><dd>{fxLockLabel}</dd></div>
        <div><dt className="text-zinc-500">FX date</dt><dd>{sim.fxSnapshot.dateKey}</dd></div>
        <div><dt className="text-zinc-500">FX source</dt><dd>{sim.fxSnapshot.source}</dd></div>
        <div><dt className="text-zinc-500">base FX</dt><dd>{sim.fxSnapshot.baseUsdKrw.toFixed(1)} KRW/USD</dd></div>
        <div><dt className="text-zinc-500">card fee</dt><dd>{(sim.fxSnapshot.overseasFeeRate * 100).toFixed(1)}%</dd></div>
        <div><dt className="text-zinc-500">effective FX</dt><dd>{sim.fxSnapshot.effectiveKrwPerUsd.toFixed(1)}</dd></div>
        <div><dt className="text-zinc-500">providerListCost</dt><dd>{sim.providerListCostKrw > 0 ? `${sim.providerListCostKrw.toFixed(1)} KRW` : "Unavailable"}</dd></div>
        <div><dt className="text-zinc-500">providerListCostStatus</dt><dd>{formatCostStatus(sim.providerListCostStatus)}</dd></div>
        <div><dt className="text-zinc-500">billingReferenceCost</dt><dd>{sim.billingReferenceCostKrw.toFixed(1)} KRW</dd></div>
        <div><dt className="text-zinc-500">actualProviderCost</dt><dd>{sim.actualProviderCostKrw > 0 ? `${sim.actualProviderCostKrw.toFixed(1)} KRW` : "Unavailable"}</dd></div>
        <div><dt className="text-zinc-500">actualCostSource</dt><dd>{formatActualCostSource(sim.actualCostSource)}</dd></div>
        <div><dt className="text-zinc-500">benchmark charge</dt><dd>{sim.benchmarkChargeP}P</dd></div>
        <div><dt className="text-zinc-500">benchmark implied max no-discount margin</dt><dd>{sim.benchmarkImpliedMaxMarginFromList != null ? `${(sim.benchmarkImpliedMaxMarginFromList * 100).toFixed(2)}%` : "Unavailable"}</dd></div>
        <div><dt className="text-zinc-500">minimum safe price</dt><dd>{sim.minimumSafePrice != null ? `${sim.minimumSafePrice.toFixed(1)} KRW` : "Unavailable"}</dd></div>
        <div><dt className="text-zinc-500">reserveStatus</dt><dd>{formatReserveStatus(sim.reserveStatus)}</dd></div>
      </dl>
    </div>
  );
}

export default async function AdminPricingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const db = getDb();
  const adminRow = db.prepare("SELECT is_admin FROM users WHERE id=?").get(user.id) as { is_admin: number } | undefined;
  if (!isAdminUser({ email: user.email, is_admin: adminRow?.is_admin ?? 0 })) redirect("/");

  const models = listPublishedModelIds();
  const geminiSim = simulatePremiumCompetitive({
    modelId: "gemini-3.1-pro-preview",
    inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.inputTokens,
    outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.outputTokens,
    benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.chargeP,
    candidateMargins: PREMIUM_MARGIN_CANDIDATES.gemini31,
    minimumMarginFloor: getPublishedPricing("gemini-3.1-pro-preview").minimumMarginFloor,
  });
  const opusSim = simulatePremiumCompetitive({
    modelId: "claude-opus-5",
    inputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.inputTokens,
    outputTokens: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.outputTokens,
    benchmarkChargeP: TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.chargeP,
    candidateMargins: PREMIUM_MARGIN_CANDIDATES.opus5,
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
              return <tr key={id} className="border-b border-white/5"><td>{id}</td><td>{p.pricingVersion}</td><td>${p.billingReferenceInputUsdPerMillion}/M</td><td>${p.billingReferenceOutputUsdPerMillion}/M</td><td>{(p.targetMargin*100).toFixed(1)}%</td><td>{(p.minimumMarginFloor*100).toFixed(1)}%</td></tr>;
            })}
          </tbody>
        </table>
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">Gemini 3.1 Pro — {TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.inputTokens} in / {TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.outputTokens} out / benchmark {TOKEN_USAGE_COMPETITOR_BENCHMARKS.gemini31.chargeP}P</h2>
        <EconomicsHeader title="Premium economics header" sim={geminiSim} modelId="gemini-3.1-pro-preview" />
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>targetMargin</th><th>finalPoints</th><th>competitiveDeviation</th><th>noDiscountGrossProfit</th><th>noDiscountRealizedMargin</th><th>currentActualGrossProfit</th><th>currentActualRealizedMargin</th><th>providerSavings</th><th>flag</th><th>flagReason</th></tr></thead>
          <tbody>{geminiSim.rows.map((r)=><tr key={r.targetMargin} className="border-b border-white/5"><td>{(r.targetMargin*100).toFixed(1)}%</td><td>{r.finalPoints}P</td><td>{r.competitiveDeviationPct != null ? `${r.competitiveDeviationPct}%` : "Unavailable"}</td><td>{r.noDiscountGrossProfitKrw != null ? r.noDiscountGrossProfitKrw : "Unavailable"}</td><td>{r.noDiscountRealizedMargin != null ? `${r.noDiscountRealizedMargin}%` : "Unavailable"}</td><td>{r.currentActualGrossProfitKrw != null ? r.currentActualGrossProfitKrw : "Unavailable"}</td><td>{r.currentActualRealizedMargin != null ? `${r.currentActualRealizedMargin}%` : "Unavailable"}</td><td>{r.providerSavingsKrw != null ? r.providerSavingsKrw : "Unavailable"}</td><td>{r.flag}</td><td>{r.flagReason}</td></tr>)}</tbody>
        </table>
      </section>
      <section className="mt-6">
        <h2 className="font-semibold">Opus 5 — {TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.inputTokens} in / {TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.outputTokens} out / benchmark {TOKEN_USAGE_COMPETITOR_BENCHMARKS.opus5.chargeP}P</h2>
        <EconomicsHeader title="Premium economics header" sim={opusSim} modelId="claude-opus-5" />
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>targetMargin</th><th>finalPoints</th><th>competitiveDeviation</th><th>noDiscountGrossProfit</th><th>noDiscountRealizedMargin</th><th>currentActualGrossProfit</th><th>currentActualRealizedMargin</th><th>providerSavings</th><th>flag</th><th>flagReason</th></tr></thead>
          <tbody>{opusSim.rows.map((r)=><tr key={r.targetMargin} className="border-b border-white/5"><td>{(r.targetMargin*100).toFixed(1)}%</td><td>{r.finalPoints}P</td><td>{r.competitiveDeviationPct != null ? `${r.competitiveDeviationPct}%` : "Unavailable"}</td><td>{r.noDiscountGrossProfitKrw != null ? r.noDiscountGrossProfitKrw : "Unavailable"}</td><td>{r.noDiscountRealizedMargin != null ? `${r.noDiscountRealizedMargin}%` : "Unavailable"}</td><td>{r.currentActualGrossProfitKrw != null ? r.currentActualGrossProfitKrw : "Unavailable"}</td><td>{r.currentActualRealizedMargin != null ? `${r.currentActualRealizedMargin}%` : "Unavailable"}</td><td>{r.providerSavingsKrw != null ? r.providerSavingsKrw : "Unavailable"}</td><td>{r.flag}</td><td>{r.flagReason}</td></tr>)}</tbody>
        </table>
      </section>
      <p className="mt-6 text-xs text-zinc-500">Shadow metadata is stored per-message in messages.usage.shadowPricing (admin-only). Public receipts are sanitized via billingReceiptAccess.</p>
    </div>
  );
}
