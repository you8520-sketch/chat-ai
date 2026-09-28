import assert from "node:assert/strict";
import { test } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import type { CatalogPricingEvidence } from "./mainRpMonthlyCacheAudit";
import {
  buildMainRpSupplyRadarReport,
  compareSupplyEndpoint,
  listMainRpSupplyIdentities,
  parseOpenRouterEndpoints,
  parseProviderMetadata,
  resolveOpenRouterSupplyRadarCredential,
  sanitizeOpenRouterSupplyRadarCredentialText,
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
        latency_last_30m:{p50:1.55},
        throughput_last_30m:{p50:62},
        uptime_last_1d:99.85,
        uptime_last_30m:100,
        status:0,
        supported_parameters:["max_tokens","reasoning_effort"]
      }
    ]
  }
};

test("active Main RP supply identities are derived exhaustively from canonical registry",()=>{
  const ids=listMainRpSupplyIdentities();
  assert.deepEqual(ids.map(x=>x.internalModelId),MAIN_RP_MODEL_IDS);
  assert.equal(ids.length,5);
  assert.equal(ids.find(x=>x.internalModelId==="deepseek-v4.1-flash")?.openRouterSlug,"deepseek/deepseek-v4.1-flash");
  assert.equal(ids.find(x=>x.internalModelId==="claude-opus-5.5")?.openRouterSlug,"anthropic/claude-opus-5.5");
});

test("credential resolver prefers dedicated radar key and never fabricates a key",()=>{
  assert.deepEqual(resolveOpenRouterSupplyRadarCredential({} as NodeJS.ProcessEnv),{
    ok:false,status:"NOT_RUN",reason:"missing_openrouter_supply_radar_credential",providerGenerationCalls:0
  });
  assert.equal(resolveOpenRouterSupplyRadarCredential({
    OPENROUTER_SUPPLY_RADAR_API_KEY:" radar ",
    OPENROUTER_API_KEY:" compat "
  } as NodeJS.ProcessEnv).ok,true);
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
  const providers=parseProviderMetadata(providerPayload);
  const rows=parseOpenRouterEndpoints(endpointsPayload,providers);
  assert.equal(rows.length,1);
  const row=rows[0]!;
  assert.equal(row.providerName,"DeepInfra");
  assert.equal(row.provider?.statusPageUrl,"https://status.example.com");
  assert.equal(row.inputUsdPerMillion,0.14);
  assert.equal(row.outputUsdPerMillion,0.42);
  assert.ok(Math.abs((row.cacheReadUsdPerMillion ?? 0)-0.0042)<1e-12);
  assert.equal(row.latencyP50SecondsLast30m,1.55);
  assert.equal(row.throughputP50TokensPerSecondLast30m,62);
  assert.equal(row.uptimeLast1dPercent,99.85);
  assert.equal(row.supportsImplicitCaching,true);
});

test("price comparison uses canonical tracker representative workload and exposes deltas, not a composite score",()=>{
  const endpoint=parseOpenRouterEndpoints(endpointsPayload,parseProviderMetadata(providerPayload))[0]!;
  const comparison=compareSupplyEndpoint(endpoint,{
    provider:"cheaperinference",
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
  assert.ok(comparison.currentCiRepresentativeUncachedProcurementUsd != null);
  assert.equal(comparison.lowerRawEndpointRateThanCurrentCi,true);
  assert.ok((comparison.rawEndpointRateDeltaVsCurrentCiPercent ?? 0)<0);
  assert.ok(comparison.evidenceFlags.includes("LOWER_RAW_ENDPOINT_RATE_THAN_CURRENT_CI"));
  assert.equal("score" in comparison,false);
});

test("report follows all current active models and stays OBSERVE_ONLY",()=>{
  const endpoints=parseOpenRouterEndpoints(endpointsPayload,parseProviderMetadata(providerPayload));
  const ci=Object.fromEntries(MAIN_RP_MODEL_IDS.map(id=>[id,ciCatalog(id)]));
  const report=buildMainRpSupplyRadarReport({
    endpointsByModel:{"deepseek-v4.1-flash":endpoints},
    ciCatalogByModel:ci,
    credentialSource:"fixture",
    generatedAt:"2026-09-28T00:00:00.000Z",
  });
  assert.equal(report.providerGenerationCalls,0);
  assert.deepEqual(report.activeModelIds,MAIN_RP_MODEL_IDS);
  assert.equal(report.models.length,MAIN_RP_MODEL_IDS.length);
  assert.equal(report.status,"PARTIAL");
  assert.equal(report.marketEvidence,"openrouter_endpoint_metrics");
  assert.equal(report.currentProcurementEvidence,"cheaperinference_catalog");
  assert.match(report.notes.join("\n"),/not this site's own live provider benchmark/i);
});

test("missing CI baseline or market evidence is PARTIAL/NOT_RUN rather than guessed",()=>{
  const market=buildMainRpSupplyRadarReport({
    endpointsByModel:{"deepseek-v4.1-flash":parseOpenRouterEndpoints(endpointsPayload)},
    ciCatalogByModel:null,
  });
  assert.equal(market.status,"PARTIAL");
  assert.equal(market.currentProcurementEvidence,"unavailable");

  const none=buildMainRpSupplyRadarReport({endpointsByModel:{},ciCatalogByModel:null});
  assert.equal(none.status,"NOT_RUN");
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


test("OK requires market and current-procurement evidence for every active model",()=>{
  const providers=parseProviderMetadata(providerPayload);
  const endpoint=parseOpenRouterEndpoints(endpointsPayload,providers)[0]!;
  const ci=Object.fromEntries(MAIN_RP_MODEL_IDS.map(id=>[id,ciCatalog(id)]));
  const endpointsByModel=Object.fromEntries(
    MAIN_RP_MODEL_IDS.map(id=>[
      id,
      [{...endpoint,modelId:id,providerName:`fixture-${id}`}]
    ])
  );
  const report=buildMainRpSupplyRadarReport({
    endpointsByModel:endpointsByModel as Parameters<typeof buildMainRpSupplyRadarReport>[0]["endpointsByModel"],
    ciCatalogByModel:ci,
  });
  assert.equal(report.status,"OK");
});
