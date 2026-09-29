import { mkdirSync, writeFileSync } from "node:fs";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import { resolveUsageReportingCheaperInferenceApiKey } from "./lib/cheaperInferenceUsageReportingCredential";
import { fetchCatalogPricingForModels } from "./lib/mainRpMonthlyCacheAudit";
import {
  collectDirectSupplierPublicEvidence,
  renderDirectSupplierRadarMarkdown,
} from "./lib/mainRpDirectSupplierRadar";
import {
  buildMainRpSupplyRadarReport,
  fetchOpenRouterEndpointsForModel,
  fetchOpenRouterProviderMetadata,
  listMainRpSupplyIdentities,
  renderMainRpSupplyRadarMarkdown,
  resolveOpenRouterSupplyRadarCredential,
  sanitizeOpenRouterSupplyRadarCredentialText,
  type SupplyEndpointEvidence,
} from "./lib/mainRpSupplyRadar";

const OUT_DIR=process.env.MAIN_RP_SUPPLY_RADAR_OUTPUT_DIR?.trim() || "artifacts/main-rp-supply-radar";

async function main(){
  mkdirSync(OUT_DIR,{recursive:true});

  const orCredential=resolveOpenRouterSupplyRadarCredential();
  const ciCredential=resolveUsageReportingCheaperInferenceApiKey();

  const currentCiModelIds = MAIN_RP_USER_SELECTABLE_OPTIONS
    .filter((option) => option.provider === "cheaperinference")
    .map((option) => option.id);
  let ciCatalog: Awaited<ReturnType<typeof fetchCatalogPricingForModels>> | null=null;
  if(ciCredential.ok && currentCiModelIds.length>0){
    try{
      ciCatalog=await fetchCatalogPricingForModels({
        apiKey:ciCredential.apiKey,
        modelIds:currentCiModelIds,
      });
    }catch(error){
      console.error("[supply-radar] CheaperInference catalog unavailable:",sanitizeOpenRouterSupplyRadarCredentialText(String(error)));
    }
  }

  const endpointsByModel: Partial<Record<(typeof MAIN_RP_MODEL_IDS)[number],SupplyEndpointEvidence[]>>={};
  let credentialSource:string|null=null;
  const errors:string[]=[];

  if(orCredential.ok){
    credentialSource=orCredential.source;
    let providers=new Map();
    try{
      providers=await fetchOpenRouterProviderMetadata({apiKey:orCredential.apiKey});
    }catch(error){
      errors.push(`providers:${sanitizeOpenRouterSupplyRadarCredentialText(String(error))}`);
    }
    for(const identity of listMainRpSupplyIdentities()){
      try{
        endpointsByModel[identity.internalModelId]=await fetchOpenRouterEndpointsForModel({
          apiKey:orCredential.apiKey,
          openRouterSlug:identity.openRouterSlug,
          providerMetadata:providers,
        });
      }catch(error){
        errors.push(`${identity.internalModelId}:${sanitizeOpenRouterSupplyRadarCredentialText(String(error))}`);
      }
    }
  }else{
    errors.push(orCredential.reason);
  }

  const report=buildMainRpSupplyRadarReport({
    endpointsByModel,
    ciCatalogByModel:ciCatalog,
    credentialSource,
  });
  const directSupplierReport=await collectDirectSupplierPublicEvidence({
    currentRadar: report,
  });
  const jsonPath=`${OUT_DIR}/report.json`;
  const mdPath=`${OUT_DIR}/REPORT.md`;
  writeFileSync(jsonPath,JSON.stringify({...report,errors},null,2));
  writeFileSync(mdPath,renderMainRpSupplyRadarMarkdown(report)+(errors.length?"\n## Collection notes\n\n"+errors.map(x=>`- ${x}`).join("\n")+"\n":""));
  writeFileSync(
    `${OUT_DIR}/direct-suppliers.json`,
    JSON.stringify(directSupplierReport,null,2)
  );
  writeFileSync(
    `${OUT_DIR}/DIRECT-SUPPLIERS.md`,
    renderDirectSupplierRadarMarkdown(directSupplierReport)
  );

  const summary={
    status:report.status,
    provider_generation_calls:report.providerGenerationCalls,
    active_models:report.activeModelIds,
    market_evidence:report.marketEvidence,
    current_procurement_evidence:report.currentProcurementEvidence,
    endpoints_discovered:report.models.reduce((n,m)=>n+m.endpointCount,0),
    lower_raw_endpoint_rate_candidates:report.models.reduce((n,m)=>n+m.lowerRawEndpointRateCount,0),
    direct_supplier_public_rows:directSupplierReport.evidence.length,
    direct_supplier_ready_for_credentialled_live:directSupplierReport.evidence.filter(
      row=>row.screeningStatus==="READY_FOR_CREDENTIALLED_LIVE_QUALIFICATION"
    ).length,
    direct_supplier_generation_calls:directSupplierReport.providerGenerationCalls,
    errors,
    jsonPath,
    mdPath,
  };
  console.log(JSON.stringify(summary,null,2));
}

main().catch((error)=>{
  console.error(sanitizeOpenRouterSupplyRadarCredentialText(error instanceof Error?error.stack??error.message:String(error)));
  console.log("provider_generation_calls=0");
  process.exitCode=1;
});
