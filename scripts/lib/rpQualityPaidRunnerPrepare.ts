/**
 * Builds a sealed 12-call paid-runner pack from the PRECALL final-wire owner.
 * Request bodies stay in-process. Public JSON never includes them.
 */
import { createHash } from "node:crypto";

import { type SelectedAI } from "@/lib/chatModels";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import {
  RP_QUALITY_PRECALL_PLANNED_CALLS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
} from "@/lib/rpQualityPrecall";
import {
  buildPaidRunnerPublicManifest,
  paidRunnerRegistrySnapshot,
  type PaidRunnerIdentityHashes,
  type PaidRunnerPublicManifest,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";
import {
  assemblePrecallFinalWireWithSealedRequests,
  type PrecallAssemblyRows,
} from "./rpQualityPrecallFinalWire";

export type PaidRunnerPreparedPack = {
  manifest: PaidRunnerPublicManifest;
  sealedCalls: PaidRunnerSealedCall[];
  sizeRows: ReturnType<typeof assemblePrecallFinalWireWithSealedRequests>["report"]["plans"][number]["size"][];
  canonModes: readonly { canonicalId: string; actualCanonMode: string }[];
};

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
    return {
      requestOrder: index + 1,
      fixtureId: request.fixtureId,
      canonicalId: request.canonicalId as SelectedAI,
      provider: request.provider,
      wireModel: request.wireModel,
      endpointKind: request.provider,
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
  };
}

export function publicPaidRunnerManifestJson(manifest: PaidRunnerPublicManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
