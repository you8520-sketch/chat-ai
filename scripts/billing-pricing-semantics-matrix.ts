/**
 * Generate provider pricing semantics audit matrices (read-only).
 * Run: node --conditions=react-server --import tsx scripts/billing-pricing-semantics-matrix.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildDeepSeekMatrix,
  buildG37ThreeBasisMatrix,
  buildPromotionDoubleApplicationCases,
  CI_G37_EVIDENCE,
  PRICING_DIMENSION_OWNER_MAP,
  SEMANTICS_AUDIT_FX,
  publishedG37MatchesFlexBatch,
  ciListMatchesGoogleStandard,
  directStandardStressMarginAtPublishedV2,
  G37_PRICING_BASES,
} from "@/lib/billingPricingSemanticsAudit";
import { GEMINI37_CALIBRATION_RATE_EVIDENCE } from "@/lib/gemini37CalibrationEvidence";
import { GEMINI37_BENCHMARK_A_ID, GEMINI37_BENCHMARK_B_ID } from "@/lib/marketUsageBenchmarks";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

const OUT_DIR =
  process.env.SEMANTICS_MATRIX_OUT ??
  join(process.cwd(), "docs/audits/billing-provider-pricing-semantics-2026-09-20");

mkdirSync(OUT_DIR, { recursive: true });

const g37Matrix = buildG37ThreeBasisMatrix();
const deepseekMatrix = buildDeepSeekMatrix();
const promoCases = buildPromotionDoubleApplicationCases();
const published = getPublishedPricing("gemini-3.7-flash");

const payload = {
  generatedAt: new Date().toISOString(),
  head: process.env.GIT_HEAD ?? "audit-only",
  fx: SEMANTICS_AUDIT_FX,
  g37ThreeBasisMatrix: g37Matrix,
  deepseekMatrix,
  promotionDoubleApplication: promoCases,
  ownerMap: PRICING_DIMENSION_OWNER_MAP,
  g37Provenance: {
    publishedReference: {
      inputUsdPerMillion: published.billingReferenceInputUsdPerMillion,
      outputUsdPerMillion: published.billingReferenceOutputUsdPerMillion,
      targetMargin: published.targetMargin,
      pricingVersion: published.pricingVersion,
      publishedAt: published.publishedAt,
    },
    calibrationEvidence: GEMINI37_CALIBRATION_RATE_EVIDENCE,
    ciListEvidence: CI_G37_EVIDENCE,
    matchesFlexBatch: publishedG37MatchesFlexBatch(),
    ciListMatchesGoogleStandard: ciListMatchesGoogleStandard(),
    directStandardStressMarginBenchmarkA: directStandardStressMarginAtPublishedV2(GEMINI37_BENCHMARK_A_ID),
    directStandardStressMarginBenchmarkB: directStandardStressMarginAtPublishedV2(GEMINI37_BENCHMARK_B_ID),
    pricingBases: G37_PRICING_BASES,
    provenanceStatus: "UNCLEAR — published ref equals Flex/Batch; CI list equals Standard; no documented Flex intent in PR #709",
  },
  deepSeekIdentity: {
    repoCanonicalIds: [
      "deepseek-v4-pro-0813",
      "deepseek-v4-pro (alias → 0813)",
      "deepseek-v4-flash-0731",
      "deepseek-v4-flash (alias → default picker)",
    ],
    ciCatalogIdsNotInRepo: [
      "deepseek-v4.1-flash",
      "deepseek-flash (official API name — not wired as CI model id in repo)",
    ],
    deliveredModelRuntime: "DELIVERED_MODEL_RUNTIME_UNVERIFIED",
    competitorBenchmark: "COMPETITOR_BENCHMARK_MISSING",
  },
  classification: "BLOCKED_BY_PROVIDER_IDENTITY",
};

writeFileSync(join(OUT_DIR, "SEMANTICS_MATRIX.json"), JSON.stringify(payload, null, 2));
writeFileSync(
  join(OUT_DIR, "G37_THREE_BASIS_MATRIX.json"),
  JSON.stringify({ fx: SEMANTICS_AUDIT_FX, rows: g37Matrix }, null, 2)
);
writeFileSync(
  join(OUT_DIR, "DEEPSEEK_MATRIX.json"),
  JSON.stringify({ fx: SEMANTICS_AUDIT_FX, rows: deepseekMatrix }, null, 2)
);

console.log(`Wrote semantics matrices to ${OUT_DIR}`);
