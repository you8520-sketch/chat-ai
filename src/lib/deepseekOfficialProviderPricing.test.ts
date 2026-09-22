import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import {
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_MARKUP_VARIANT,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P3,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P4,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P5,
  DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P6,
} from "@/lib/deepseekOfficialProviderPricing.fixtures";
import {
  buildOfficialProviderPeakEvidence,
  fingerprintOfficialProviderPeakState,
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

function v4ProPeakEvidenceFromFixture(html: string, observedAt = OBSERVED_AT) {
  const parsed = parseDeepSeekOfficialPricingHtml(html);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return null;
  const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
  return buildOfficialProviderPeakEvidence({
    model: pro,
    canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    observedAt,
  })!;
}

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

  it("markup variant: tbody/class/th table parses same PEAK rates as P1", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_MARKUP_VARIANT);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const p1 = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    assert.equal(p1.ok, true);
    if (!p1.ok) return;
    const variantPro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    const p1Pro = p1.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    assert.deepEqual(variantPro.peak, p1Pro.peak);
    assert.equal(parsed.rawFingerprint, p1.rawFingerprint);
  });

  it("P1: canonical identity maps deepseek-v4-pro to deepseek-v4-pro-0813", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    const mapped = mapDeepSeekOfficialModelToCanonical(pro);
    assert.deepEqual(mapped, { canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL });
  });

  it("fingerprint: P1 document != P2 document; P1 replay is stable", () => {
    const p1a = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    const p1b = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1);
    const p2 = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2);
    assert.equal(p1a.ok, true);
    assert.equal(p1b.ok, true);
    assert.equal(p2.ok, true);
    if (!p1a.ok || !p1b.ok || !p2.ok) return;
    assert.equal(p1a.rawFingerprint, p1b.rawFingerprint);
    assert.notEqual(p1a.rawFingerprint, p2.rawFingerprint);
  });

  it("fingerprint: P1 V4 Pro PEAK evidence != P2; P1/P3 PEAK evidence equal", () => {
    const p1Evidence = v4ProPeakEvidenceFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1)!;
    const p2Evidence = v4ProPeakEvidenceFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2, "2026-09-21T03:00:00.000Z")!;
    const p3Evidence = v4ProPeakEvidenceFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P3)!;
    assert.notEqual(p1Evidence.rawFingerprint, p2Evidence.rawFingerprint);
    assert.equal(p1Evidence.rawFingerprint, p3Evidence.rawFingerprint);
  });

  it("P2: PEAK change is detectable; OFF-PEAK unchanged in source", () => {
    const parsed = parseDeepSeekOfficialPricingHtml(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const pro = parsed.models.find((model) => model.providerModelIdentity === "deepseek-v4-pro")!;
    assert.equal(pro.peak.cacheMissInputUsdPerMillion, 1.5);
    assert.equal(pro.offPeak.cacheMissInputUsdPerMillion, 0.66);

    const prevEvidence = v4ProPeakEvidenceFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1)!;
    const nextEvidence = v4ProPeakEvidenceFromFixture(
      DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P2,
      "2026-09-21T03:00:00.000Z"
    )!;
    const events = classifyOfficialProviderPeakChange({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      previous: buildOfficialProviderPeakSnapshot({ evidence: prevEvidence }),
      current: buildOfficialProviderPeakSnapshot({ evidence: nextEvidence }),
    });
    assert.ok(events.some((event) => event.eventType === "OFFICIAL_PROVIDER_PRICE_CHANGED"));
    assert.equal(events[0]?.action, "HOLD");
  });

  it("P3: OFF-PEAK-only change does not fire PEAK change or published mismatch", () => {
    const normalized = normalizeDeepSeekOfficialPricingDocument({
      html: DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P3,
      observedAt: OBSERVED_AT,
    });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;

    const p1Evidence = v4ProPeakEvidenceFromFixture(DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1)!;
    const p3Evidence = normalized.peakEvidenceByCanonicalModelId.get(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    )!;
    const peakEvents = classifyOfficialProviderPeakChange({
      modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      previous: buildOfficialProviderPeakSnapshot({ evidence: p1Evidence }),
      current: buildOfficialProviderPeakSnapshot({ evidence: p3Evidence }),
    });
    assert.equal(peakEvents.length, 0);

    const officialPeak = buildOfficialProviderPeakSnapshot({ evidence: p3Evidence });
    const published = buildPublishedBaselineSnapshot({
      policy: getModelPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL)!,
      published: getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      observedAt: OBSERVED_AT,
    });
    assert.equal(
      classifyOfficialProviderBaselineMismatch({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        officialPeak,
        publishedBaseline: published,
        runDateKey: "2026-09-20",
      }),
      null
    );
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

  it("V4.1 Flash: official PEAK matches published v1 baseline", () => {
    const normalized = normalizeDeepSeekOfficialPricingDocument({
      html: DEEPSEEK_OFFICIAL_PRICING_FIXTURE_P1,
      observedAt: OBSERVED_AT,
    });
    assert.equal(normalized.ok, true);
    if (!normalized.ok) return;
    const evidence = normalized.peakEvidenceByCanonicalModelId.get(
      CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL
    );
    assert.ok(evidence);
    assert.equal(evidence!.pricingMode, "provider_peak");
    assert.equal(getModelPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL)?.baselineMode, "PROVIDER_PEAK");
    const published = getPublishedPricing(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL);
    assert.equal(published.billingReferenceInputUsdPerMillion, 0.3);
    assert.equal(published.billingReferenceOutputUsdPerMillion, 1.2);
    assert.equal(published.billingReferenceCacheReadUsdPerMillion, 0.006);
    assert.equal(evidence!.inputUsdPerMillion, 0.3);
    assert.equal(evidence!.outputUsdPerMillion, 1.2);
    assert.equal(evidence!.cacheReadUsdPerMillion, 0.006);
    const officialPeak = buildOfficialProviderPeakSnapshot({ evidence: evidence! });
    const publishedSnapshot = buildPublishedBaselineSnapshot({
      policy: getModelPricingPolicy(CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL)!,
      published,
      observedAt: OBSERVED_AT,
    });
    assert.equal(
      classifyOfficialProviderBaselineMismatch({
        modelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        officialPeak,
        publishedBaseline: publishedSnapshot,
        runDateKey: "2026-09-20",
      }),
      null
    );
  });

  it("retired 0731 identity is not mapped by official observer", () => {
    assert.equal(
      fingerprintOfficialProviderPeakState({
        canonicalModelId: CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        providerModelIdentity: "deepseek-v4-flash-0731",
        providerVersionLabel: "DeepSeek-V4-Flash-0731",
        peak: {
          cacheHitInputUsdPerMillion: 0.006,
          cacheMissInputUsdPerMillion: 0.3,
          outputUsdPerMillion: 1.2,
        },
      }).length,
      64
    );
    const mapped = mapDeepSeekOfficialModelToCanonical({
      providerModelIdentity: "deepseek-v4-flash-0731",
      providerVersionLabel: "DeepSeek-V4-Flash-0731",
      peak: {
        cacheHitInputUsdPerMillion: 0.006,
        cacheMissInputUsdPerMillion: 0.3,
        outputUsdPerMillion: 1.2,
      },
      offPeak: {
        cacheHitInputUsdPerMillion: 0.003,
        cacheMissInputUsdPerMillion: 0.15,
        outputUsdPerMillion: 0.6,
      },
    });
    assert.ok("reason" in mapped);
  });
});
