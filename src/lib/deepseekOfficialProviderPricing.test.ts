import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import {
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P3,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P4,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P5,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P6,
} from "@/lib/deepseekOfficialProviderPricing.fixtures";
import {
  buildOfficialProviderPeakEvidence,
  mapDeepSeekOfficialModelToCanonical,
  normalizeDeepSeekOfficialPricingDocument,
  parseDeepSeekOfficialPricingHtml,
} from "@/lib/deepseekOfficialProviderPricing";
import {
  classifyOfficialProviderBaselineMismatch,
  classifyOfficialProviderPeakChange,
} from "@/lib/modelPriceChangeClassifier";
import {
  buildOfficialProviderPeakSnapshot,
  buildPublishedBaselineSnapshot,
} from "@/lib/modelPriceSnapshot";
import { getModelPricingPolicy } from "@/lib/modelPricingPolicy";
import { getPublishedPricing } from "@/lib/publishedModelPricing";

const OBSERVED_AT = "2026-09-20T03:00:00.000Z";

describe("DeepSeek official provider pricing parser (Phase B1 fixtures)", () => {
  it("P1: extracts V4 Pro PEAK and OFF-PEAK without swapping schedules", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;

    const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro");
    assert.ok(pro);
    assert.equal(pro!.peak.cacheMissInputUsdPerMillion, 1.32);
    assert.equal(pro!.peak.outputUsdPerMillion, 3.96);
    assert.equal(pro!.peak.cacheHitInputUsdPerMillion, 0.044);
    assert.equal(pro!.offPeak.cacheMissInputUsdPerMillion, 0.66);
    assert.equal(pro!.offPeak.outputUsdPerMillion, 1.98);
    assert.equal(pro!.offPeak.cacheHitInputUsdPerMillion, 0.022);
  });

  it("P1: canonical identity maps deepseek-v4-pro to deepseek-v4-pro-0813", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    const mapped = mapDeepSeekOfficialModelToCanonical(pro);
    assert.deepEqual(mapped, { canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL });
  });

  it("P2: PEAK change is detectable; OFF-PEAK unchanged in source", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    assert.equal(pro.peak.cacheMissInputUsdPerMillion, 1.5);
    assert.equal(pro.offPeak.cacheMissInputUsdPerMillion, 0.66);

    const p1 = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    assert.equal(p1.ok, true);
    if (!p1.ok) return;
    const prevModel = p1.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    const prevEvidence = buildOfficialProviderPeakEvidence({
      model: prevModel,
      canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      observedAt: OBSERVED_AT,
      documentFingerprint: p1.rawFingerprint,
    })!;
    const nextEvidence = buildOfficialProviderPeakEvidence({
      model: pro,
      canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      observedAt: "2026-09-21T03:00:00.000Z",
      documentFingerprint: parsed.rawFingerprint,
    })!;
    const events = classifyOfficialProviderPeakChange({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      previous: buildOfficialProviderPeakSnapshot({ evidence: prevEvidence }),
      current: buildOfficialProviderPeakSnapshot({ evidence: nextEvidence }),
    });
    assert.ok(events.some((event) => event.eventType === "OFFICIAL_PROVIDER_PRICE_CHANGED"));
    assert.equal(events[0]?.action, "HOLD");
  });

  it("P3: OFF-PEAK-only change does not fire published PEAK mismatch when PEAK matches published", () => {
    const normalized = normalizeDeepSeekOfficialPricingDocument({
      html: DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P3,
      observedAt: OBSERVED_AT,
    });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;

    const evidence = normalized.peakEvidenceByCanonicalModelId.get(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.ok(evidence);
    const officialPeak = buildOfficialProviderPeakSnapshot({ evidence: evidence! });
    const published = buildPublishedBaselineSnapshot({
      policy: getModelPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!,
      published: getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      observedAt: OBSERVED_AT,
    });
    assert.equal(classifyOfficialProviderBaselineMismatch({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      officialPeak,
      publishedBaseline: published,
      runDateKey: "2026-09-20",
    }), null);
  });

  it("P4: malformed official source returns parser failure reason", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P4);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.reason, "official_pricing_table_missing");
  });

  it("P5: missing cache field stays null — no synthetic fallback", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P5);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    assert.equal(pro.peak.cacheHitInputUsdPerMillion, null);
    const evidence = buildOfficialProviderPeakEvidence({
      model: pro,
      canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      observedAt: OBSERVED_AT,
      documentFingerprint: parsed.rawFingerprint,
    });
    assert.ok(evidence);
    assert.equal(evidence!.cacheReadUsdPerMillion, null);
  });

  it("P6: unknown version label blocks canonical mapping", () => {
    const normalized = normalizeDeepSeekOfficialPricingDocument({
      html: DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P6,
      observedAt: OBSERVED_AT,
    });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;
    assert.equal(
      normalized.peakEvidenceByCanonicalModelId.has(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      false
    );
    assert.ok(
      normalized.identityFailures.some((failure) =>
        failure.reason.includes("official_version_label_mismatch")
      )
    );
  });
});
