import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import {
  GOOGLE_FLASH_STANDARD_INTRO_RATES,
  GOOGLE_FLASH_STANDARD_POST_INTRO_EFFECTIVE_AT,
  GOOGLE_FLASH_STANDARD_POST_INTRO_RATES,
  GOOGLE_FLASH_STANDARD_SCHEDULE_MODEL_IDS,
} from "@/lib/gemini37PricingPolicy.constants";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import type { CatalogPricingEvidence } from "./mainRpMonthlyCacheAudit";
import {
  buildMainRpSupplyRadarReport,
  compareSupplyEndpoint,
  listMainRpSupplyIdentities,
  parseOpenRouterEndpoints,
  parseProviderMetadata,
  renderMainRpSupplyRadarMarkdown,
  resolveOpenRouterSupplyRadarCredential,
  resolveSupplyUpstreamRiskAlertWindow,
  sanitizeOpenRouterSupplyRadarCredentialText,
  type SupplyEndpointEvidence,
} from "./mainRpSupplyRadar";

function ciCatalog(id: string, input=0.3, output=1.2, cache=0.006): CatalogPricingEvidence {
  return {
    id,
    input_per_million: input,
    output_per_million: output,
    cache_read_input_per_million: cache,
    cache_write_input_per_million: null,
    cacheCapabilityAdvertised: true,
    pricing_version: "test-v1",
    pricing_checked_at: "2026-09-28T00:00:00Z",
    pricing_updated_at: "2026-09-28T00:00:00Z",
  };
}

const providerPayload={
  data:[
    {
      name:"DeepInfra",
      slug:"deepinfra",
      headquarters:"US",
      privacy_policy_url:"https://example.com/privacy",
      terms_of_service_url:"https://example.com/terms",
      status_page_url:"https://status.example.com",
      datacenters:["US","EU"],
    },
    {
      name:"Google AI Studio",
      slug:"google-ai-studio",
      headquarters:"US",
      privacy_policy_url:"https://example.com/google-privacy",
      terms_of_service_url:"https://example.com/google-terms",
      status_page_url:"https://status.example.com/google",
      datacenters:["US"],
    }
  ]
};

const endpointsPayload={
  data:{
    id:"deepseek/deepseek-v4.1-flash",
    endpoints:[
      {
        model_id:"deepseek/deepseek-v4.1-flash",
        provider_name:"DeepInfra",
        tag:"deepinfra",
        quantization:"fp8",
        context_length:1048576,
        max_prompt_tokens:1000000,
        max_completion_tokens:131072,
        pricing:{
          prompt:"0.00000014",
          completion:"0.00000042",
          input_cache_read:"0.0000000042"
        },
        supports_implicit_caching:true,
        latency_last_30m:{p50:1550},
        throughput_last_30m:{p50:62},
        uptime_last_1d:99.85,
        uptime_last_30m:100,
        status:0,
        supported_parameters:["max_tokens","reasoning_effort"]
      }
    ]
  }
};

function baseEndpoint(): SupplyEndpointEvidence {
  return parseOpenRouterEndpoints(
    endpointsPayload,
    parseProviderMetadata(providerPayload)
  )[0]!;
}

function routedEndpoint(modelId: string): SupplyEndpointEvidence {
  return {
    ...baseEndpoint(),
    modelId,
    providerName:"Google AI Studio Flex",
    providerTag:"google-ai-studio",
    inputUsdPerMillion: modelId.includes("3.1") ? 1 : 0.375,
    outputUsdPerMillion: modelId.includes("3.1") ? 6 : 1.875,
    cacheReadUsdPerMillion: modelId.includes("3.1") ? 0.1 : 0.0375,
    provider:{
      name:"Google AI Studio",
      slug:"google-ai-studio",
      headquarters:"US",
      privacyPolicyUrl:"https://example.com/google-privacy",
      termsOfServiceUrl:"https://example.com/google-terms",
      statusPageUrl:"https://status.example.com/google",
      datacenters:["US"],
    },
    supportedParameters:["reasoning","include_reasoning","temperature","max_tokens"],
  };
}

test("active Main RP supply identities are derived exhaustively from canonical registry",()=>{
  const ids=listMainRpSupplyIdentities();
  assert.deepEqual(ids.map(x=>x.internalModelId),MAIN_RP_MODEL_IDS);
  assert.equal(ids.length,4);
  assert.equal(ids.find(x=>x.internalModelId==="deepseek-v4.1-flash")?.openRouterSlug,"deepseek/deepseek-v4.1-flash");
  assert.equal(ids.find(x=>x.internalModelId==="gemini-3.8-flash")?.openRouterSlug,"google/gemini-3.8-flash");
  assert.equal(ids.find(x=>x.internalModelId==="gpt-6.1-sol")?.openRouterSlug,"openai/gpt-6.1-sol");
});

test("credential resolver prefers dedicated radar key and never fabricates a key",()=>{
  assert.deepEqual(resolveOpenRouterSupplyRadarCredential({} as NodeJS.ProcessEnv),{
    ok:false,status:"NOT_RUN",reason:"missing_openrouter_supply_radar_credential",providerGenerationCalls:0
  });
  const compat=resolveOpenRouterSupplyRadarCredential({OPENROUTER_API_KEY:" compat "} as NodeJS.ProcessEnv);
  assert.equal(compat.ok,true);
  if(compat.ok) assert.equal(compat.source,"OPENROUTER_API_KEY");
});

test("credential sanitizer redacts both supported env assignment forms",()=>{
  const text="OPENROUTER_SUPPLY_RADAR_API_KEY=secret OPENROUTER_API_KEY=prod";
  const sanitized=sanitizeOpenRouterSupplyRadarCredentialText(text);
  assert.doesNotMatch(sanitized,/secret|prod/);
  assert.match(sanitized,/\[REDACTED\]/);
});

test("provider and endpoint market evidence parse without inventing missing metrics",()=>{
  const rows=parseOpenRouterEndpoints(endpointsPayload,parseProviderMetadata(providerPayload));
  assert.equal(rows.length,1);
  const row=rows[0]!;
  assert.equal(row.providerName,"DeepInfra");
  assert.equal(row.inputUsdPerMillion,0.14);
  assert.equal(row.outputUsdPerMillion,0.42);
  assert.ok(Math.abs((row.cacheReadUsdPerMillion ?? 0)-0.0042)<1e-12);
  assert.equal(row.latencyP50SecondsLast30m,1.55);
});

test("price comparison is relative to the actual current-procurement baseline",()=>{
  const endpoint=baseEndpoint();
  const comparison=compareSupplyEndpoint(endpoint,{
    provider:"cheaperinference",
    evidenceSource:"cheaperinference_catalog",
    modelId:"deepseek-v4.1-flash",
    inputUsdPerMillion:0.3,
    outputUsdPerMillion:1.2,
    cacheReadUsdPerMillion:0.006,
    cacheWriteUsdPerMillion:null,
    cacheCapabilityAdvertised:true,
    pricingVersion:"test",
    pricingCheckedAt:null,
    pricingUpdatedAt:null,
  });
  assert.ok(comparison.rawEndpointRepresentativeUncachedRateUsd != null);
  assert.ok(comparison.currentRepresentativeUncachedProcurementUsd != null);
  assert.equal(comparison.lowerRawEndpointRateThanCurrentProcurement,true);
  assert.ok((comparison.rawEndpointRateDeltaVsCurrentProcurementPercent ?? 0)<0);
  assert.ok(comparison.evidenceFlags.includes("LOWER_RAW_ENDPOINT_RATE_THAN_CURRENT_PROCUREMENT"));
  assert.equal("score" in comparison,false);
});

test("report follows mixed current providers and stays OBSERVE_ONLY",()=>{
  const endpointsByModel: Record<string, SupplyEndpointEvidence[]> = {};
  const ci: Record<string,CatalogPricingEvidence> = {};
  for(const option of MAIN_RP_USER_SELECTABLE_OPTIONS){
    if(option.provider==="openrouter"){
      endpointsByModel[option.id]=[routedEndpoint(option.id)];
    }else{
      endpointsByModel[option.id]=[{...baseEndpoint(),modelId:option.id}];
      ci[option.id]=ciCatalog(option.id);
    }
  }
  const report=buildMainRpSupplyRadarReport({
    endpointsByModel:endpointsByModel as Parameters<typeof buildMainRpSupplyRadarReport>[0]["endpointsByModel"],
    ciCatalogByModel:ci,
    credentialSource:"fixture",
    generatedAt:"2026-09-28T00:00:00.000Z",
  });
  assert.equal(report.providerGenerationCalls,0);
  assert.deepEqual(report.activeModelIds,MAIN_RP_MODEL_IDS);
  assert.equal(report.status,"OK");
  assert.equal(report.currentProcurementEvidence,"registry_route_evidence");
  assert.equal(
    report.models.find((row)=>row.modelId==="gemini-3.8-flash")?.currentProcurement?.provider,
    "openrouter"
  );
});

test("missing current-route baseline or market evidence is PARTIAL/NOT_RUN rather than guessed",()=>{
  const market=buildMainRpSupplyRadarReport({
    endpointsByModel:{"deepseek-v4.1-flash":[baseEndpoint()]},
    ciCatalogByModel:null,
  });
  assert.equal(market.status,"PARTIAL");
  assert.equal(market.currentProcurementEvidence,"unavailable");

  const none=buildMainRpSupplyRadarReport({endpointsByModel:{},ciCatalogByModel:null});
  assert.equal(none.status,"NOT_RUN");
});

test("OpenRouter Flex route stays partial when endpoint tier evidence is ambiguous",()=>{
  const ambiguous = {
    ...routedEndpoint("gemini-3.8-flash"),
    providerName:"Google AI Studio",
    providerTag:"google-ai-studio",
  };
  const report = buildMainRpSupplyRadarReport({
    endpointsByModel:{"gemini-3.8-flash":[ambiguous]},
    ciCatalogByModel:null,
  });
  const row = report.models.find((item)=>item.modelId==="gemini-3.8-flash")!;
  assert.equal(row.currentProcurement,null);
  assert.equal(report.status,"PARTIAL");
});

test("temporary provider discount expiry updates procurement evidence without mutating published user pricing",()=>{
  const beforePublished = getPublishedPricing("gemini-3.8-flash");
  const promo = routedEndpoint("gemini-3.8-flash");
  const promoReport = buildMainRpSupplyRadarReport({
    endpointsByModel:{"gemini-3.8-flash":[promo]},
    ciCatalogByModel:null,
  });
  const promoRow = promoReport.models.find((row)=>row.modelId==="gemini-3.8-flash")!;
  assert.equal(promoRow.currentProcurement?.inputUsdPerMillion,0.375);
  assert.equal(promoRow.currentProcurement?.outputUsdPerMillion,1.875);

  const normalized = {
    ...promo,
    inputUsdPerMillion:0.75,
    outputUsdPerMillion:3.75,
    cacheReadUsdPerMillion:0.075,
  };
  const normalizedReport = buildMainRpSupplyRadarReport({
    endpointsByModel:{"gemini-3.8-flash":[normalized]},
    ciCatalogByModel:null,
  });
  const normalizedRow = normalizedReport.models.find((row)=>row.modelId==="gemini-3.8-flash")!;
  assert.equal(normalizedRow.currentProcurement?.inputUsdPerMillion,0.75);
  assert.equal(normalizedRow.currentProcurement?.outputUsdPerMillion,3.75);
  assert.equal(normalizedRow.publishedMarginRisk?.belowMinimumMarginFloor,true);

  const afterPublished = getPublishedPricing("gemini-3.8-flash");
  assert.deepEqual(afterPublished,beforePublished);
});

test("network helpers are GET-only and source contains no generation endpoint",async()=>{
  const calls:Array<{url:string;init:RequestInit|undefined}>=[];
  const fakeFetch=async(url: string | URL | Request, init?:RequestInit)=>{
    calls.push({url:String(url),init});
    return new Response(JSON.stringify(endpointsPayload),{status:200,headers:{"content-type":"application/json"}});
  };
  const mod=await import("./mainRpSupplyRadar");
  await mod.fetchOpenRouterEndpointsForModel({
    apiKey:"test",
    openRouterSlug:"deepseek/deepseek-v4.1-flash",
    fetchImpl:fakeFetch as typeof fetch,
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0]!.init?.method,"GET");
  assert.match(calls[0]!.url,/\/endpoints$/);
  assert.doesNotMatch(calls[0]!.url,/chat\/completions|responses$/);
});

test("official Gemini Standard schedule is risk evidence without inventing future Flex procurement",()=> {
  assert.ok(
    GOOGLE_FLASH_STANDARD_SCHEDULE_MODEL_IDS.includes("gemini-3.8-flash"),
    "current Gemini 3.8 must retain official upstream schedule evidence"
  );
  assert.equal(GOOGLE_FLASH_STANDARD_POST_INTRO_EFFECTIVE_AT,"2027-01-01T00:00:00.000Z");
  assert.deepEqual(GOOGLE_FLASH_STANDARD_INTRO_RATES,{
    inputUsdPerMillion:0.75,
    outputUsdPerMillion:3.75,
    cacheReadUsdPerMillion:0.075,
  });
  assert.deepEqual(GOOGLE_FLASH_STANDARD_POST_INTRO_RATES,{
    inputUsdPerMillion:1.5,
    outputUsdPerMillion:7.5,
    cacheReadUsdPerMillion:0.15,
  });

  const report=buildMainRpSupplyRadarReport({
    endpointsByModel:{
      "gemini-3.8-flash":[routedEndpoint("gemini-3.8-flash")],
    },
    ciCatalogByModel:null,
    generatedAt:"2026-11-02T00:00:00.000Z",
  });
  assert.equal(report.version,2);
  assert.deepEqual(
    report.upstreamPriceRisks.map(row=>row.modelId),
    MAIN_RP_MODEL_IDS.filter((modelId) =>
      GOOGLE_FLASH_STANDARD_SCHEDULE_MODEL_IDS.includes(
        modelId as (typeof GOOGLE_FLASH_STANDARD_SCHEDULE_MODEL_IDS)[number]
      )
    )
  );
  for(const risk of report.upstreamPriceRisks){
    assert.equal(risk.referenceTier,"google_standard");
    assert.equal(risk.currentProcurementRoute,"openrouter:google-ai-studio:flex");
    assert.equal(risk.currentRouteImpact,"UNCONFIRMED");
    assert.equal(risk.projectedCurrentRouteCostUsd,null);
    assert.equal(risk.projectedCurrentRouteMargin,null);
    assert.equal(risk.action,"REVIEW_CURRENT_ROUTE_PRICING");
    assert.equal(risk.alertWindow,"D60");
    assert.equal(risk.currentProcurementPrice.inputUsdPerMillion,0.375);
    assert.equal(risk.currentProcurementPrice.outputUsdPerMillion,1.875);
    assert.equal(risk.postIntroStandardPrice.inputUsdPerMillion,1.5);
    assert.equal(risk.postIntroStandardPrice.outputUsdPerMillion,7.5);
  }
  assert.equal(
    report.models.some(row=>row.modelId==="gemini-3.1-pro-preview"),
    false
  );
});

test("upstream schedule alert windows do not claim a current-route price transition",()=> {
  const effective=GOOGLE_FLASH_STANDARD_POST_INTRO_EFFECTIVE_AT;
  assert.equal(resolveSupplyUpstreamRiskAlertWindow(effective,"2026-11-02T00:00:00.000Z"),"D60");
  assert.equal(resolveSupplyUpstreamRiskAlertWindow(effective,"2026-12-02T00:00:00.000Z"),"D30");
  assert.equal(resolveSupplyUpstreamRiskAlertWindow(effective,"2026-12-25T00:00:00.000Z"),"D7");
  assert.equal(resolveSupplyUpstreamRiskAlertWindow(effective,"2027-01-01T00:00:00.000Z"),"EFFECTIVE_OR_PAST");
  assert.equal(resolveSupplyUpstreamRiskAlertWindow(effective,"2026-10-01T00:00:00.000Z"),null);

  const report=buildMainRpSupplyRadarReport({
    endpointsByModel:{"gemini-3.8-flash":[routedEndpoint("gemini-3.8-flash")]},
    ciCatalogByModel:null,
    generatedAt:"2027-01-08T03:47:00.000Z",
  });
  const risk=report.models.find(row=>row.modelId==="gemini-3.8-flash")!.upstreamPriceRisk!;
  assert.equal(risk.alertWindow,"EFFECTIVE_OR_PAST");
  assert.equal(risk.currentProcurementPrice.inputUsdPerMillion,0.375);
  assert.equal(risk.projectedCurrentRouteCostUsd,null);
  assert.equal(risk.projectedCurrentRouteMargin,null);
});

test("forecast markdown explicitly separates upstream schedule from current Flex procurement",()=> {
  const report=buildMainRpSupplyRadarReport({
    endpointsByModel:{"gemini-3.8-flash":[routedEndpoint("gemini-3.8-flash")]},
    ciCatalogByModel:null,
    generatedAt:"2026-12-02T00:00:00.000Z",
  });
  const markdown=renderMainRpSupplyRadarMarkdown(report);
  assert.match(markdown,/Official upstream price schedule risk/);
  assert.match(markdown,/UNCONFIRMED/);
  assert.match(markdown,/REVIEW_CURRENT_ROUTE_PRICING/);
  assert.match(markdown,/does not prove the future price/);
  assert.doesNotMatch(markdown,/projected current-route margin/i);
});

