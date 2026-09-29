import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import {
  buildDirectSupplierEvidence,
  collectDirectSupplierPublicEvidence,
  directSupplierSourceUrl,
  normalizeSupplierHtmlText,
  parseDirectSupplierPublicPage,
} from "./mainRpDirectSupplierRadar";
import type { MainRpSupplyRadarReport } from "./mainRpSupplyRadar";

const ONEMUX_FIXTURE = `
  <html><body>
    <h1>GPT 5.6 Terra</h1>
    <div>OpenAI SDK Compatible</div>
    <div>Input / 1M <span>$0.8 / 1M tokens</span></div>
    <div>Output / 1M <span>$4.8 / 1M tokens</span></div>
  </body></html>
`;

const AIREITER_FIXTURE = `
  <html><body>
    <h1>GPT-5.6 Terra AI Chat Playground and API</h1>
    <p>Try it for streaming output, cache usage, and Chat Completions API access.</p>
    <div>OpenAI Chat Completions</div>
    <div>
      Input Official $2.00 per 1M tokens AIReiter $0.60 per 1M tokens
      Output Official $12.00 per 1M tokens AIReiter $3.60 per 1M tokens
      Cache read Official $0.20 per 1M tokens AIReiter $0.06 per 1M tokens
    </div>
  </body></html>
`;

const DIT_FIXTURE = `
  <html><body>
    <h1>GPT-5.6 Terra</h1>
    <div>Protocol OPENAI compatible</div>
    <div>DIT in / out$1.5 / $9per 1M tokens</div>
    <div>1 active route</div>
    <div>45.52%30-day success</div>
  </body></html>
`;

function currentRadar(): MainRpSupplyRadarReport {
  return {
    version: 1,
    generatedAt: "2026-09-29T00:00:00.000Z",
    status: "OK",
    providerGenerationCalls: 0,
    activeModelIds: MAIN_RP_MODEL_IDS,
    credentialSource: "fixture",
    currentProcurementEvidence: "registry_route_evidence",
    marketEvidence: "openrouter_endpoint_metrics",
    notes: [],
    models: MAIN_RP_MODEL_IDS.map((modelId) => ({
      modelId,
      label: modelId,
      openRouterSlug: `fixture/${modelId}`,
      currentProcurement: {
        provider: "cheaperinference",
        evidenceSource: "cheaperinference_catalog",
        modelId,
        inputUsdPerMillion: 0.8,
        outputUsdPerMillion: 4.8,
        cacheReadUsdPerMillion: null,
        cacheWriteUsdPerMillion: null,
        cacheCapabilityAdvertised: false,
        pricingVersion: "fixture",
        pricingCheckedAt: null,
        pricingUpdatedAt: null,
      },
      endpointCount: 0,
      providersDiscovered: [],
      comparisons: [],
      lowerRawEndpointRateCount: 0,
      publishedMarginRisk: null,
      evidenceFingerprint: "fixture",
    })),
  };
}

describe("direct supplier public evidence parser", () => {
  it("uses canonical OneMux model-page rate instead of a blog price", () => {
    const parsed = parseDirectSupplierPublicPage("onemux", ONEMUX_FIXTURE);
    assert.equal(parsed.inputUsdPerMillion, 0.8);
    assert.equal(parsed.outputUsdPerMillion, 4.8);
    assert.equal(parsed.protocol, "openai_compatible");

    const evidence = buildDirectSupplierEvidence({
      supplier: "onemux",
      modelId: "gpt-5.6-terra",
      sourceUrl: directSupplierSourceUrl("onemux", "gpt-5.6-terra"),
      fetchedAt: "2026-09-29T00:00:00.000Z",
      httpStatus: 200,
      html: ONEMUX_FIXTURE,
      currentInputUsdPerMillion: 0.8,
      currentOutputUsdPerMillion: 4.8,
    });
    assert.equal(evidence.screeningStatus, "NO_PRICE_ADVANTAGE");
  });

  it("holds a cheaper AIReiter price when measured stability evidence is absent", () => {
    const parsed = parseDirectSupplierPublicPage("aireiter", AIREITER_FIXTURE);
    assert.equal(parsed.inputUsdPerMillion, 0.6);
    assert.equal(parsed.outputUsdPerMillion, 3.6);
    assert.equal(parsed.cacheReadUsdPerMillion, 0.06);
    assert.equal(parsed.publicSuccess30dPercent, null);

    const evidence = buildDirectSupplierEvidence({
      supplier: "aireiter",
      modelId: "gpt-5.6-terra",
      sourceUrl: directSupplierSourceUrl("aireiter", "gpt-5.6-terra"),
      fetchedAt: "2026-09-29T00:00:00.000Z",
      httpStatus: 200,
      html: AIREITER_FIXTURE,
      currentInputUsdPerMillion: 0.8,
      currentOutputUsdPerMillion: 4.8,
    });
    assert.equal(evidence.cheaperOnInputAndOutput, true);
    assert.equal(
      evidence.screeningStatus,
      "HOLD_PUBLIC_STABILITY_UNVERIFIED"
    );
    assert.equal(evidence.liveQualificationStatus, "NOT_RUN_MISSING_CREDENTIAL");
  });

  it("holds a discounted DIT route whose measured 30-day success is far below the stability floor", () => {
    const parsed = parseDirectSupplierPublicPage("dit", DIT_FIXTURE);
    assert.equal(parsed.inputUsdPerMillion, 1.5);
    assert.equal(parsed.outputUsdPerMillion, 9);
    assert.equal(parsed.activeRoutes, 1);
    assert.equal(parsed.publicSuccess30dPercent, 45.52);
    assert.equal(parsed.protocol, "openai_compatible");

    const evidence = buildDirectSupplierEvidence({
      supplier: "dit",
      modelId: "gpt-5.6-terra",
      sourceUrl: directSupplierSourceUrl("dit", "gpt-5.6-terra"),
      fetchedAt: "2026-09-29T00:00:00.000Z",
      httpStatus: 200,
      html: DIT_FIXTURE,
      currentInputUsdPerMillion: 2,
      currentOutputUsdPerMillion: 12,
    });
    assert.equal(evidence.cheaperOnInputAndOutput, true);
    assert.equal(
      evidence.screeningStatus,
      "HOLD_PUBLIC_STABILITY_BELOW_FLOOR"
    );
  });

  it("only marks a cheaper OpenAI-compatible supplier ready when public measured stability clears the floor", () => {
    const html = DIT_FIXTURE.replace("45.52%30-day success", "99.95%30-day success")
      .replace("$1.5 / $9", "$0.4 / $2.4");
    const evidence = buildDirectSupplierEvidence({
      supplier: "dit",
      modelId: "gpt-5.6-terra",
      sourceUrl: directSupplierSourceUrl("dit", "gpt-5.6-terra"),
      fetchedAt: "2026-09-29T00:00:00.000Z",
      httpStatus: 200,
      html,
      currentInputUsdPerMillion: 0.8,
      currentOutputUsdPerMillion: 4.8,
    });
    assert.equal(
      evidence.screeningStatus,
      "READY_FOR_CREDENTIALLED_LIVE_QUALIFICATION"
    );
  });

  it("fails closed when a cheaper supplier would require a different transport contract", () => {
    const html = DIT_FIXTURE
      .replace("Protocol OPENAI compatible", "Protocol GOOGLE compatible")
      .replace("$1.5 / $9", "$0.2 / $1")
      .replace("45.52%30-day success", "99.99%30-day success");
    const evidence = buildDirectSupplierEvidence({
      supplier: "dit",
      modelId: "gemini-3.8-flash",
      sourceUrl: directSupplierSourceUrl("dit", "gemini-3.8-flash"),
      fetchedAt: "2026-09-29T00:00:00.000Z",
      httpStatus: 200,
      html,
      currentInputUsdPerMillion: 0.375,
      currentOutputUsdPerMillion: 1.875,
    });
    assert.equal(evidence.protocol, "google_compatible");
    assert.equal(
      evidence.screeningStatus,
      "HOLD_PROTOCOL_CHANGE_REQUIRED"
    );
  });

  it("strips scripts before parsing supplier page text", () => {
    assert.doesNotMatch(
      normalizeSupplierHtmlText(
        `<script>Input / 1M $0.01 Output / 1M $0.01</script>${ONEMUX_FIXTURE}`
      ),
      /0\.01/
    );
  });
});

describe("direct supplier public evidence collector", () => {
  it("follows the canonical active registry, performs GET-only public reads, and makes zero generation calls", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fakeFetch = async (
      url: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      const text = String(url);
      calls.push({ url: text, method: init?.method });
      const body = text.includes("onemux.net")
        ? ONEMUX_FIXTURE
        : text.includes("aireiter.com")
          ? AIREITER_FIXTURE
          : DIT_FIXTURE;
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    };

    const report = await collectDirectSupplierPublicEvidence({
      currentRadar: currentRadar(),
      fetchImpl: fakeFetch as typeof fetch,
      now: () => new Date("2026-09-29T00:00:00.000Z"),
    });

    assert.deepEqual(report.activeModelIds, MAIN_RP_MODEL_IDS);
    assert.equal(report.providerGenerationCalls, 0);
    assert.equal(report.evidence.length, MAIN_RP_MODEL_IDS.length * 3);
    assert.equal(calls.length, MAIN_RP_MODEL_IDS.length * 3);
    assert.ok(calls.every((call) => call.method === "GET"));
    assert.ok(
      calls.every(
        (call) =>
          !call.url.includes("/chat/completions") &&
          !call.url.includes("/responses") &&
          !call.url.includes("/messages")
      )
    );
  });
});
