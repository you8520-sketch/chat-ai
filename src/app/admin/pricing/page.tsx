import { getSessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/isAdminUser";
import { getDb } from "@/lib/db";
import { redirect } from "next/navigation";
import { listPublishedModelIds, getPublishedPricing } from "@/lib/publishedModelPricing";
import { simulatePremiumCompetitive, TOKEN_USAGE_COMPETITOR_BENCHMARKS, PREMIUM_MARGIN_CANDIDATES } from "@/lib/shadowSimulations";
import {
  GEMINI37_BENCHMARK_A_ID,
  GEMINI37_BENCHMARK_B_ID,
  getMarketBenchmarks,
} from "@/lib/marketUsageBenchmarks";
import {
  CACHE_POLICY_VERIFICATION,
  evaluateLiveReferenceDrift,
  GEMINI37_CALIBRATION_RATE_EVIDENCE,
} from "@/lib/gemini37CalibrationEvidence";
import { resolveCheaperInferenceCatalogPricing } from "@/lib/cheaperInferenceCatalogPricing";
import {
  buildGemini37FxSensitivityMatrix,
  buildGemini37MarginMatrix,
  computeCalibrationDiscountTheoreticalMargin,
  computeDirectStandardStressMargin,
  diagnoseGemini37V1AtBaseFx,
  evaluateGemini37V2AcceptanceGates,
  GEMINI37_MODEL_ID,
  GEMINI37_V1_PUBLISHED,
  GEMINI37_V2_PROPOSED,
  GOOGLE_STANDARD_INTRO_VALID_THROUGH,
  simulateGemini37PolicyRow,
} from "@/lib/gemini37PricingPolicy";

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

function Gemini37PolicyHeader() {
  const pub = getPublishedPricing(GEMINI37_MODEL_ID);
  const v1Diag = diagnoseGemini37V1AtBaseFx();
  const gates = evaluateGemini37V2AcceptanceGates();
  const evidence = GEMINI37_CALIBRATION_RATE_EVIDENCE;
  const liveCatalog = resolveCheaperInferenceCatalogPricing(GEMINI37_MODEL_ID);
  const liveDrift = evaluateLiveReferenceDrift(pub);
  const theoreticalDiscountMargin = computeCalibrationDiscountTheoreticalMargin(GEMINI37_V2_PROPOSED.targetMargin);
  const benchmarkA = getMarketBenchmarks(GEMINI37_MODEL_ID)[0];
  const directStress = benchmarkA
    ? computeDirectStandardStressMargin({ benchmark: benchmarkA, published: GEMINI37_V2_PROPOSED })
    : null;

  return (
    <div className="mt-4 space-y-3 text-xs text-zinc-300">
      <div className="rounded border border-amber-500/30 bg-amber-950/20 p-3">
        <h3 className="font-semibold text-amber-100">Published v2 policy (shadow)</h3>
        <p className="mt-1">${pub.billingReferenceInputUsdPerMillion}/{pub.billingReferenceOutputUsdPerMillion} · target {(pub.targetMargin * 100).toFixed(0)}% · floor {(pub.minimumMarginFloor * 100).toFixed(0)}% · v{pub.pricingVersion}</p>
        <p className="mt-2 text-zinc-400">
          v1 used elevated billing reference (${GEMINI37_V1_PUBLISHED.billingReferenceInputUsdPerMillion}/{GEMINI37_V1_PUBLISHED.billingReferenceOutputUsdPerMillion} @ {(GEMINI37_V1_PUBLISHED.targetMargin * 100).toFixed(0)}% target).
          v2 aligns published reference with calibration evidence and {(GEMINI37_V2_PROPOSED.targetMargin * 100).toFixed(0)}% target — prices can be lower despite higher margin semantics.
        </p>
        <p className="mt-1 text-zinc-500">v1 diagnostic @1530: A {v1Diag.benchmarkA.finalPoints}P vs {v1Diag.benchmarkA.competitorChargePoints}P · B {v1Diag.benchmarkB.finalPoints}P vs {v1Diag.benchmarkB.competitorChargePoints}P</p>
      </div>

      <div className="rounded border border-white/10 p-3">
        <h3 className="font-semibold text-zinc-100">Calibration evidence snapshot</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
          <div><dt className="text-zinc-500">observed reference</dt><dd>${evidence.referenceInputUsdPerMillion}/{evidence.referenceOutputUsdPerMillion}</dd></div>
          <div><dt className="text-zinc-500">observed current</dt><dd>${evidence.observedCurrentInputUsdPerMillion}/{evidence.observedCurrentOutputUsdPerMillion}</dd></div>
          <div><dt className="text-zinc-500">observed discount</dt><dd>{evidence.observedDiscountPercent}%</dd></div>
          <div><dt className="text-zinc-500">observedAt</dt><dd>{evidence.observedAt}</dd></div>
          <div><dt className="text-zinc-500">sourceKind</dt><dd>{evidence.sourceKind}</dd></div>
          <div><dt className="text-zinc-500">calibration theoretical margin @55%</dt><dd>{(theoreticalDiscountMargin * 100).toFixed(1)}%</dd></div>
        </dl>
      </div>

      <div className="rounded border border-white/10 p-3">
        <h3 className="font-semibold text-zinc-100">Live CI catalog</h3>
        {liveCatalog ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
            <div><dt className="text-zinc-500">current input</dt><dd>${liveCatalog.inputUsdPerMillion}</dd></div>
            <div><dt className="text-zinc-500">current output</dt><dd>${liveCatalog.outputUsdPerMillion}</dd></div>
            <div><dt className="text-zinc-500">reference input</dt><dd>{liveCatalog.referenceInputUsdPerMillion != null ? `$${liveCatalog.referenceInputUsdPerMillion}` : "Unavailable"}</dd></div>
            <div><dt className="text-zinc-500">reference output</dt><dd>{liveCatalog.referenceOutputUsdPerMillion != null ? `$${liveCatalog.referenceOutputUsdPerMillion}` : "Unavailable"}</dd></div>
            <div><dt className="text-zinc-500">discount</dt><dd>{liveCatalog.discountPercent != null ? `${liveCatalog.discountPercent}%` : "Unavailable"}</dd></div>
            <div><dt className="text-zinc-500">fetchedAt</dt><dd>{new Date(liveCatalog.fetchedAt).toISOString()}</dd></div>
          </dl>
        ) : (
          <p className="mt-2 text-zinc-500">Unavailable</p>
        )}
      </div>

      <div className="rounded border border-white/10 p-3">
        <h3 className="font-semibold text-zinc-100">Live reference drift</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
          <div><dt className="text-zinc-500">LIVE_REFERENCE_STATUS</dt><dd>{liveDrift.status}</dd></div>
          <div><dt className="text-zinc-500">liveReferenceMatchesPublished</dt><dd>{liveDrift.liveReferenceMatchesPublished == null ? "Unavailable" : liveDrift.liveReferenceMatchesPublished ? "true" : "false"}</dd></div>
          <div><dt className="text-zinc-500">input deviation</dt><dd>{liveDrift.inputDeviationPct != null ? `${liveDrift.inputDeviationPct}%` : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500">output deviation</dt><dd>{liveDrift.outputDeviationPct != null ? `${liveDrift.outputDeviationPct}%` : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500">LIVE_PROVIDER_PRICE_CHANGE_AUTO_MUTATES_PUBLISHED_V2</dt><dd>false</dd></div>
        </dl>
      </div>

      <div className="rounded border border-white/10 p-3">
        <h3 className="font-semibold text-zinc-100">Diagnostics</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
          <div><dt className="text-zinc-500">DIRECT_STANDARD_STRESS</dt><dd>{directStress?.margin != null ? `≈${(directStress.margin * 100).toFixed(0)}% margin` : "Unavailable"}</dd></div>
          <div><dt className="text-zinc-500">intro pricing through</dt><dd>{GOOGLE_STANDARD_INTRO_VALID_THROUGH}</dd></div>
          <div><dt className="text-zinc-500">CACHE_POLICY_VERIFICATION</dt><dd>{CACHE_POLICY_VERIFICATION}</dd></div>
          <div><dt className="text-zinc-500">v2 acceptance gates</dt><dd>{gates.allPass ? "ALL PASS" : "BLOCKED — see tests"}</dd></div>
        </dl>
      </div>
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

  const gemini37Benchmarks = getMarketBenchmarks(GEMINI37_MODEL_ID);
  const gemini37MarginMatrix = buildGemini37MarginMatrix({ published: GEMINI37_V2_PROPOSED });
  const gemini37FxMatrix = buildGemini37FxSensitivityMatrix({ published: GEMINI37_V2_PROPOSED });
  const gemini37V2Rows1530 = gemini37Benchmarks.map((b) =>
    simulateGemini37PolicyRow({
      benchmark: b,
      published: GEMINI37_V2_PROPOSED,
      targetMargin: GEMINI37_V2_PROPOSED.targetMargin,
      baseFx: 1530,
    })
  );

  return (
    <div className="mx-auto max-w-6xl p-6 text-sm text-zinc-100">
      <h1 className="text-xl font-bold">Pricing Diagnostics — Shadow Only (Phase 2)</h1>
      <p className="mt-2 text-zinc-400">USER BILLING BEHAVIOR_CHANGED: false · Published pricing is shadow only. Live discount does NOT control standard price.</p>
      <section className="mt-6">
        <h2 className="font-semibold">Published Catalog</h2>
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
        <h2 className="font-semibold">Gemini 3.7 Flash — competitive calibration (shadow v2)</h2>
        <Gemini37PolicyHeader />
        <h3 className="mt-4 font-medium text-zinc-200">Benchmark A — 24,952 in / 2,367 out / 55P</h3>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>targetMargin</th><th>finalPoints</th><th>deviation</th><th>noDiscountMargin</th><th>currentActualMargin</th><th>strictPass</th><th>floorPass</th><th>flag</th></tr></thead>
          <tbody>
            {gemini37MarginMatrix.filter((r) => r.benchmarkId === GEMINI37_BENCHMARK_A_ID).map((r) => (
              <tr key={r.targetMargin} className="border-b border-white/5">
                <td>{(r.targetMargin * 100).toFixed(1)}%</td><td>{r.finalPoints}P</td><td>{r.competitiveDeviationPct}%</td>
                <td>{r.noDiscountRealizedMargin != null ? `${(r.noDiscountRealizedMargin * 100).toFixed(1)}%` : "—"}</td>
                <td>{r.currentActualRealizedMargin != null ? `${(r.currentActualRealizedMargin * 100).toFixed(1)}%` : "—"}</td>
                <td>{r.strictMarketPass ? "PASS" : "FAIL"}</td><td>{r.minimumFloorPass ? "PASS" : "FAIL"}</td><td>{r.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 font-medium text-zinc-200">Benchmark B — 42,195 in / 3,862 out / 84.4P</h3>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>targetMargin</th><th>finalPoints</th><th>deviation</th><th>noDiscountMargin</th><th>currentActualMargin</th><th>strictPass</th><th>floorPass</th><th>flag</th></tr></thead>
          <tbody>
            {gemini37MarginMatrix.filter((r) => r.benchmarkId === GEMINI37_BENCHMARK_B_ID).map((r) => (
              <tr key={r.targetMargin} className="border-b border-white/5">
                <td>{(r.targetMargin * 100).toFixed(1)}%</td><td>{r.finalPoints}P</td><td>{r.competitiveDeviationPct}%</td>
                <td>{r.noDiscountRealizedMargin != null ? `${(r.noDiscountRealizedMargin * 100).toFixed(1)}%` : "—"}</td>
                <td>{r.currentActualRealizedMargin != null ? `${(r.currentActualRealizedMargin * 100).toFixed(1)}%` : "—"}</td>
                <td>{r.strictMarketPass ? "PASS" : "FAIL"}</td><td>{r.minimumFloorPass ? "PASS" : "FAIL"}</td><td>{r.flag}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 font-medium text-zinc-200">v2 @ 55% — base FX 1530 snapshot</h3>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>benchmark</th><th>finalPoints</th><th>competitor</th><th>billingRefCost</th><th>providerListCost</th><th>deviation</th></tr></thead>
          <tbody>
            {gemini37V2Rows1530.map((r) => (
              <tr key={r.benchmarkId} className="border-b border-white/5">
                <td>{r.benchmarkId}</td><td>{r.finalPoints}P</td><td>{r.competitorChargePoints}P</td>
                <td>{r.billingReferenceCostKrw.toFixed(1)} KRW</td><td>{r.providerListCostKrw.toFixed(1)} KRW</td><td>{r.competitiveDeviationPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 font-medium text-zinc-200">FX Sensitivity — v2 @ 55%</h3>
        <table className="mt-2 w-full border-collapse text-xs">
          <thead><tr className="border-b border-white/10 text-left"><th>base FX</th><th>effective</th><th>benchmark</th><th>finalPoints</th><th>competitor</th><th>deviation</th><th>strictPass</th></tr></thead>
          <tbody>
            {gemini37FxMatrix.map((c) => (
              <tr key={`${c.baseFx}-${c.benchmarkId}`} className="border-b border-white/5">
                <td>{c.baseFx}</td><td>{c.effectiveFx.toFixed(1)}</td><td>{c.benchmarkId}</td><td>{c.finalPoints}P</td>
                <td>{c.competitorChargePoints}P</td><td>{c.competitiveDeviationPct}%</td><td>{c.strictMarketPass ? "PASS" : "FAIL"}</td>
              </tr>
            ))}
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
