/**
 * Builds a sealed 12-call paid-runner pack from the PRECALL final-wire owner.
 * Request bodies stay in-process. Public JSON never includes them.
 */
import { createHash } from "node:crypto";

import { MAIN_RP_MODEL_IDS, type SelectedAI } from "@/lib/chatModels";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_PLANNED_CALLS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  type RpQualityPrecallCostPlanning,
} from "@/lib/rpQualityPrecall";
import {
  buildPaidRunnerPublicManifest,
  expectedPaidRunnerProvider,
  paidRunnerIdentityHash,
  paidRunnerRegistrySnapshot,
  verifyPaidRunnerDispatchSeal,
  type PaidRunnerIdentityHashes,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";
import {
  RP_QUALITY_PAID_CHEAPERINFERENCE_KEY_ENV,
  RP_QUALITY_PAID_LIVE_EXECUTE_ENV,
  RP_QUALITY_PAID_OPENROUTER_KEY_ENV,
} from "@/lib/rpQualityPaidRunnerLiveTransport";
import {
  assemblePrecallFinalWireWithSealedRequests,
  type PrecallAssemblyRows,
} from "./rpQualityPrecallFinalWire";

export type PaidRunnerPreparedPack = {
  manifest: PaidRunnerPublicManifest;
  sealedCalls: PaidRunnerSealedCall[];
  sizeRows: ReturnType<typeof assemblePrecallFinalWireWithSealedRequests>["report"]["plans"][number]["size"][];
  canonModes: readonly { canonicalId: string; actualCanonMode: string }[];
  sectionCounts: readonly number[];
};

export const PAID_RUNNER_PREAPPROVAL_DECISIONS = [
  "READY_FOR_GPT_COST_REVIEW",
  "BLOCKED_DEPLOYMENT",
  "BLOCKED_PRODUCTION_IDENTITY",
  "BLOCKED_MANIFEST_INTEGRITY",
  "BLOCKED_COST_EVIDENCE",
  "BLOCKED_PRIVACY",
  "BLOCKED_OTHER",
] as const;
export type PaidRunnerPreapprovalDecision = (typeof PAID_RUNNER_PREAPPROVAL_DECISIONS)[number];

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function identityHashesFromRows(rows: PrecallAssemblyRows): PaidRunnerIdentityHashes {
  return {
    greetingSha256: sha256(String(rows.character.greeting ?? "")),
    systemPromptSha256: sha256(String(rows.character.system_prompt ?? "")),
    worldSha256: sha256(String(rows.character.world ?? "")),
    settingChunksSha256: sha256(String(rows.character.setting_chunks ?? "")),
    personaPublicSha256: sha256(toPublicPersonaDescription(rows.persona.description ?? "")),
  };
}

export function preparePaidRunnerPack(input: {
  rows: PrecallAssemblyRows;
  mainSha: string;
  productionDeploySha: string;
  identityHashes?: PaidRunnerIdentityHashes;
}): PaidRunnerPreparedPack {
  paidRunnerRegistrySnapshot();
  if (input.rows.character.id !== RP_QUALITY_PRECALL_TARGET_SELECTOR.characterId) {
    throw new Error("PAID_RUNNER_CHARACTER_SELECTOR_MISMATCH");
  }
  if (input.rows.persona.name.trim() !== RP_QUALITY_PRECALL_TARGET_SELECTOR.personaName) {
    throw new Error("PAID_RUNNER_PERSONA_SELECTOR_MISMATCH");
  }
  const assembled = assemblePrecallFinalWireWithSealedRequests(input.rows);
  if (assembled.sealedRequests.length !== RP_QUALITY_PRECALL_PLANNED_CALLS) {
    throw new Error(`expected ${RP_QUALITY_PRECALL_PLANNED_CALLS} sealed requests`);
  }
  const sealedCalls: PaidRunnerSealedCall[] = assembled.sealedRequests.map((request, index) => {
    const plan = assembled.report.plans[index];
    if (!plan) throw new Error("sealed request missing plan");
    if ("max_tokens" in request.requestBody || "max_completion_tokens" in request.requestBody) {
      throw new Error("PAID_RUNNER_MAX_TOKENS_PRESENT");
    }
    const canonicalId = request.canonicalId as SelectedAI;
    const provider = expectedPaidRunnerProvider(canonicalId);
    if (request.provider !== provider) {
      throw new Error("PAID_RUNNER_PROVIDER_MAPPING_MISMATCH");
    }
    return {
      requestOrder: index + 1,
      fixtureId: request.fixtureId,
      canonicalId,
      provider,
      wireModel: request.wireModel,
      endpointKind: provider,
      endpoint: request.endpoint,
      finalWireFingerprint: request.finalWireFingerprint,
      requestBodyFingerprint: request.requestBodyFingerprint,
      effectiveCanonMode: plan.canon.actualCanonMode,
      authoringLevel: "NORMAL",
      contentMode: "SAFE",
      maxTokensPresent: false,
      requestBody: request.requestBody,
    };
  });
  const identityHashes = input.identityHashes ?? identityHashesFromRows(input.rows);
  const manifest = buildPaidRunnerPublicManifest({
    mainSha: input.mainSha,
    productionDeploySha: input.productionDeploySha,
    identityHashes,
    sealedCalls,
  });
  return {
    manifest,
    sealedCalls,
    sizeRows: assembled.report.plans.map((plan) => plan.size),
    canonModes: assembled.report.plans.map((plan) => ({
      canonicalId: plan.canonicalId,
      actualCanonMode: plan.canon.actualCanonMode,
    })),
    sectionCounts: assembled.report.plans.map((plan) => plan.sections.length),
  };
}

export function publicPaidRunnerManifestJson(manifest: PaidRunnerPublicManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function paidRunnerIdentityHashesMatchProof(
  hashes: PaidRunnerIdentityHashes,
  proof: PaidRunnerIdentityHashes
): boolean {
  return (
    hashes.greetingSha256 === proof.greetingSha256 &&
    hashes.systemPromptSha256 === proof.systemPromptSha256 &&
    hashes.worldSha256 === proof.worldSha256 &&
    hashes.settingChunksSha256 === proof.settingChunksSha256 &&
    hashes.personaPublicSha256 === proof.personaPublicSha256
  );
}

export function projectPaidRunnerPreapprovalCalls(pack: PaidRunnerPreparedPack) {
  return pack.manifest.calls.map((call, index) => ({
    ...call,
    estimatedInputTokens: pack.sizeRows[index]?.estimatedInputTokens ?? null,
    promptSectionCount: pack.sectionCounts[index] ?? null,
    actualCanonMode: pack.canonModes[index]?.actualCanonMode ?? call.effectiveCanonMode,
  }));
}

export function readPaidRunnerExperimentKeyPresence(
  env: NodeJS.ProcessEnv = process.env
): {
  experimentOpenRouterKeyPresent: boolean;
  experimentCheaperInferenceKeyPresent: boolean;
  liveExecuteEnabled: boolean;
  envNamesOnly: {
    openRouter: typeof RP_QUALITY_PAID_OPENROUTER_KEY_ENV;
    cheaperInference: typeof RP_QUALITY_PAID_CHEAPERINFERENCE_KEY_ENV;
    liveExecute: typeof RP_QUALITY_PAID_LIVE_EXECUTE_ENV;
  };
} {
  return {
    experimentOpenRouterKeyPresent: Boolean(env[RP_QUALITY_PAID_OPENROUTER_KEY_ENV]?.trim()),
    experimentCheaperInferenceKeyPresent: Boolean(env[RP_QUALITY_PAID_CHEAPERINFERENCE_KEY_ENV]?.trim()),
    liveExecuteEnabled: env[RP_QUALITY_PAID_LIVE_EXECUTE_ENV] === "1",
    envNamesOnly: {
      openRouter: RP_QUALITY_PAID_OPENROUTER_KEY_ENV,
      cheaperInference: RP_QUALITY_PAID_CHEAPERINFERENCE_KEY_ENV,
      liveExecute: RP_QUALITY_PAID_LIVE_EXECUTE_ENV,
    },
  };
}

export function publishedPlanningRateSnapshot(canonicalId: (typeof MAIN_RP_MODEL_IDS)[number]) {
  const pricing = getPublishedPricing(canonicalId);
  return {
    canonicalId,
    inputUsdPerMillion: pricing.billingReferenceInputUsdPerMillion,
    outputUsdPerMillion: pricing.billingReferenceOutputUsdPerMillion,
    pricingVersion: pricing.pricingVersion,
    publishedAt: pricing.publishedAt,
    targetMargin: pricing.targetMargin,
    owner: "publishedModelPricing.getPublishedPricing",
    providerCatalogLiveFetch: false,
  };
}

export function decidePaidRunnerPreapproval(input: {
  productionSuccess: boolean;
  productionShaMatchesMain: boolean;
  liveTransportIncluded: boolean;
  proofStatus: string;
  sealOk: boolean;
  callCount: number;
  fixtureCount: number;
  modelCount: number;
  modelsMatchRegistry: boolean;
  approvalStatus: string;
  rawSourceLeak: boolean;
  secretLeak: boolean;
  costPlanningStatus: string;
  providerPosts: number;
  identityHashesMatchProof: boolean;
}): { decision: PaidRunnerPreapprovalDecision; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.productionSuccess || !input.productionShaMatchesMain || !input.liveTransportIncluded) {
    reasons.push("deployment_not_ready");
    return { decision: "BLOCKED_DEPLOYMENT", reasons };
  }
  if (input.proofStatus !== "VERIFIED" || !input.identityHashesMatchProof) {
    reasons.push("production_identity_unverified");
    return { decision: "BLOCKED_PRODUCTION_IDENTITY", reasons };
  }
  if (
    !input.sealOk ||
    input.callCount !== RP_QUALITY_PRECALL_PLANNED_CALLS ||
    input.fixtureCount !== RP_QUALITY_PRECALL_FIXTURE_IDS.length ||
    input.modelCount !== MAIN_RP_MODEL_IDS.length ||
    !input.modelsMatchRegistry
  ) {
    reasons.push("manifest_or_registry_mismatch");
    return { decision: "BLOCKED_MANIFEST_INTEGRITY", reasons };
  }
  if (input.costPlanningStatus !== "PLANNING_ONLY_NOT_APPROVED") {
    reasons.push("cost_planning_not_separated");
    return { decision: "BLOCKED_COST_EVIDENCE", reasons };
  }
  if (input.rawSourceLeak || input.secretLeak) {
    reasons.push("privacy_or_secret_leak");
    return { decision: "BLOCKED_PRIVACY", reasons };
  }
  if (input.approvalStatus !== "NOT_APPROVED" || input.providerPosts !== 0) {
    reasons.push("approval_or_post_policy");
    return { decision: "BLOCKED_OTHER", reasons };
  }
  return { decision: "READY_FOR_GPT_COST_REVIEW", reasons: [] };
}

export function buildPaidRunnerPreapprovalProjection(input: {
  pack: PaidRunnerPreparedPack;
  assemblySourceSha: string;
  proofStatus: string;
  costPlanning: RpQualityPrecallCostPlanning;
  identityHashesMatchProof: boolean;
  productionSuccess: boolean;
  productionShaMatchesMain: boolean;
  liveTransportIncluded: boolean;
  rawSourceLeak: boolean;
  secretLeak: boolean;
  keyPresence: ReturnType<typeof readPaidRunnerExperimentKeyPresence>;
}): {
  manifest: PaidRunnerPublicManifest;
  assemblySourceSha: string;
  identityProofStatus: string;
  identityHash: string;
  combinedIdentityHash: string;
  calls: ReturnType<typeof projectPaidRunnerPreapprovalCalls>;
  seal: ReturnType<typeof verifyPaidRunnerDispatchSeal>;
  fingerprintProtects: {
    productionSha: true;
    identityHash: true;
    requestBodyFingerprint: true;
    finalWireFingerprint: true;
    estimatedInputTokens: false;
    promptSectionCount: false;
    note: string;
  };
  costPlanning: RpQualityPrecallCostPlanning;
  publishedRates: ReturnType<typeof publishedPlanningRateSnapshot>[];
  keyPresence: ReturnType<typeof readPaidRunnerExperimentKeyPresence>;
  decision: ReturnType<typeof decidePaidRunnerPreapproval>;
  approvalStatus: "NOT_APPROVED";
  providerPosts: 0;
  sealedBodiesExported: false;
} {
  const seal = verifyPaidRunnerDispatchSeal({
    manifest: input.pack.manifest,
    sealedCalls: input.pack.sealedCalls,
  });
  const fixtures = new Set(input.pack.manifest.calls.map((call) => call.fixtureId));
  const models = input.pack.manifest.calls.map((call) => call.canonicalId);
  const uniqueModels = [...new Set(models)];
  const decision = decidePaidRunnerPreapproval({
    productionSuccess: input.productionSuccess,
    productionShaMatchesMain: input.productionShaMatchesMain,
    liveTransportIncluded: input.liveTransportIncluded,
    proofStatus: input.proofStatus,
    sealOk: seal.ok,
    callCount: input.pack.manifest.calls.length,
    fixtureCount: fixtures.size,
    modelCount: uniqueModels.length,
    modelsMatchRegistry:
      uniqueModels.length === MAIN_RP_MODEL_IDS.length &&
      MAIN_RP_MODEL_IDS.every((id) => uniqueModels.includes(id)),
    approvalStatus: input.pack.manifest.approvalStatus,
    rawSourceLeak: input.rawSourceLeak,
    secretLeak: input.secretLeak,
    costPlanningStatus: input.costPlanning.status,
    providerPosts: input.pack.manifest.providerPosts,
    identityHashesMatchProof: input.identityHashesMatchProof,
  });
  return {
    manifest: input.pack.manifest,
    assemblySourceSha: input.assemblySourceSha,
    identityProofStatus: input.proofStatus,
    identityHash: input.pack.manifest.identityHash,
    combinedIdentityHash: paidRunnerIdentityHash(input.pack.manifest.identityHashes),
    calls: projectPaidRunnerPreapprovalCalls(input.pack),
    seal,
    fingerprintProtects: {
      productionSha: true,
      identityHash: true,
      requestBodyFingerprint: true,
      finalWireFingerprint: true,
      estimatedInputTokens: false,
      promptSectionCount: false,
      note:
        "Token/section counts are planning metadata. Execution integrity is the request-body and final-wire fingerprints; later paid execution must reassemble through preparePaidRunnerPack and rematch those fingerprints.",
    },
    costPlanning: input.costPlanning,
    publishedRates: MAIN_RP_MODEL_IDS.map((id) => publishedPlanningRateSnapshot(id)),
    keyPresence: input.keyPresence,
    decision,
    approvalStatus: "NOT_APPROVED",
    providerPosts: 0,
    sealedBodiesExported: false,
  };
}
