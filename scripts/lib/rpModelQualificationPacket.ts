import crypto from "node:crypto";

import {
  MAIN_RP_MODEL_IDS,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  COLLABORATIVE_INTERACTIVE_OWNER_TITLE,
  USER_COAUTHOR_OWNER_TITLE,
} from "@/lib/noGodmodding";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import { resolvePublishedPricingExact } from "@/lib/publishedModelPricing";
import { buildContext } from "@/services/contextBuilder";
import {
  CANONICAL_RP_QUALIFICATION_SOURCE,
  RP_MODEL_QUALIFICATION_FIXTURE_VERSION,
  buildCanonicalRpQualificationCases,
  buildCanonicalRpQualificationContextInput,
  type CanonicalQualificationCaseId,
} from "./rpModelQualificationFixture";

export const RP_MODEL_QUALIFICATION_PACKET_VERSION = 2;

export const RP_MODEL_QUALIFICATION_PACKET_OWNERS = Object.freeze({
  activeModelRegistry: "src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS",
  frozenFixture: "scripts/lib/rpModelQualificationFixture.ts",
  promptAssembly: "src/services/contextBuilder.ts#buildContext",
  wireAssembly: "src/lib/openRouterAdult.ts#assemblePrimaryRpRequest",
  pricing: "src/lib/publishedModelPricing.ts",
  providerCost: "src/lib/providerCostLedger.ts",
  userAuthoring: "src/lib/noGodmodding.ts#COLLABORATIVE_INTERACTIVE_OWNER_BLOCK",
});

type JsonObject = Record<string, unknown>;

function sha256Text(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(value));
}

function countSectionHeader(text: string, title: string): number {
  return text
    .split("\n")
    .filter((line) => line.trim() === title)
    .length;
}

function wireControls(body: JsonObject): JsonObject {
  const keys = [
    "model",
    "max_tokens",
    "temperature",
    "top_p",
    "thinking",
    "reasoning",
    "reasoning_effort",
    "output_config",
    "stream",
  ] as const;
  const out: JsonObject = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) out[key] = body[key];
  }
  return out;
}

export type RpModelQualificationCasePacket = {
  caseId: CanonicalQualificationCaseId;
  targetResponseChars: number;
  reviewFocus: readonly string[];
  systemPromptSha256: string;
  systemPromptChars: number;
  wireMessagesSha256: string;
  wireMessageCount: number;
  requestBodySha256: string;
  requestBodyKeys: string[];
  wireControls: JsonObject;
  adaptationKeyDiff: {
    removed: string[];
    added: string[];
    changed: string[];
  };
  collaborativeOwnerCount: number;
  effectiveCoauthorOwnerCount: number;
};

export type RpModelQualificationModelPacket = {
  modelId: SelectedAI;
  label: string;
  provider: "cheaperinference";
  pricing: {
    canonicalModelId: string;
    pricingVersion: number;
    publishedAt: string;
    billingReferenceInputUsdPerMillion: number;
    billingReferenceOutputUsdPerMillion: number;
    billingReferenceCacheReadUsdPerMillion: number | null;
    billingReferenceCacheWriteUsdPerMillion: number | null;
    targetMargin: number;
    minimumMarginFloor: number;
  };
  cases: RpModelQualificationCasePacket[];
};

export type RpModelQualificationPacket = {
  packetVersion: number;
  fixtureVersion: number;
  source: typeof CANONICAL_RP_QUALIFICATION_SOURCE;
  owners: typeof RP_MODEL_QUALIFICATION_PACKET_OWNERS;
  activeModelIds: readonly SelectedAI[];
  providerCalls: 0;
  runtimeObservations: "NOT_RUN";
  models: RpModelQualificationModelPacket[];
};

function buildCasePacket(
  modelId: SelectedAI,
  provider: "cheaperinference",
  caseId: CanonicalQualificationCaseId
): RpModelQualificationCasePacket {
  const caseData = buildCanonicalRpQualificationCases().find((entry) => entry.id === caseId);
  if (!caseData) throw new Error(`Unknown canonical qualification case: ${caseId}`);

  const contextInput = buildCanonicalRpQualificationContextInput({
    modelId,
    caseData,
    provider,
  });
  const built = buildContext(contextInput);
  const wire = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? [],
    modelId,
    targetResponseChars: caseData.targetResponseChars,
    messageOpts: {
      transportProvider: provider,
      charName: CANONICAL_RP_QUALIFICATION_SOURCE.characterName,
      personaName: CANONICAL_RP_QUALIFICATION_SOURCE.personaName,
    },
    stream: true,
  });
  const body = wire.requestBody as JsonObject;
  const messages = Array.isArray(body.messages) ? body.messages : wire.messages;

  return {
    caseId: caseData.id,
    targetResponseChars: caseData.targetResponseChars,
    reviewFocus: caseData.reviewFocus,
    systemPromptSha256: sha256Text(built.systemPrompt),
    systemPromptChars: built.systemPrompt.length,
    wireMessagesSha256: sha256Json(messages),
    wireMessageCount: messages.length,
    requestBodySha256: sha256Json(body),
    requestBodyKeys: Object.keys(body).sort(),
    wireControls: wireControls(body),
    adaptationKeyDiff: wire.adaptationKeyDiff,
    collaborativeOwnerCount: countSectionHeader(
      built.systemPrompt,
      COLLABORATIVE_INTERACTIVE_OWNER_TITLE
    ),
    effectiveCoauthorOwnerCount: countSectionHeader(
      built.systemPrompt,
      USER_COAUTHOR_OWNER_TITLE
    ),
  };
}

export function buildActiveRpModelQualificationPacket(): RpModelQualificationPacket {
  const cases = buildCanonicalRpQualificationCases();

  const models = MAIN_RP_USER_SELECTABLE_OPTIONS.map((option) => {
    if (option.provider !== "cheaperinference") {
      throw new Error(
        `Canonical active-model qualification currently supports CheaperInference Main RP only: ${option.id}`
      );
    }
    const exactPricing = resolvePublishedPricingExact(option.id);
    if (!exactPricing) {
      throw new Error(
        `Active Main RP model is missing exact published pricing: ${option.id}`
      );
    }
    const p = exactPricing.pricing;
    return {
      modelId: option.id,
      label: option.label,
      provider: option.provider,
      pricing: {
        canonicalModelId: exactPricing.canonicalModelId,
        pricingVersion: p.pricingVersion,
        publishedAt: p.publishedAt,
        billingReferenceInputUsdPerMillion: p.billingReferenceInputUsdPerMillion,
        billingReferenceOutputUsdPerMillion: p.billingReferenceOutputUsdPerMillion,
        billingReferenceCacheReadUsdPerMillion:
          p.billingReferenceCacheReadUsdPerMillion ?? null,
        billingReferenceCacheWriteUsdPerMillion:
          p.billingReferenceCacheWriteUsdPerMillion ?? null,
        targetMargin: p.targetMargin,
        minimumMarginFloor: p.minimumMarginFloor,
      },
      cases: cases.map((caseData) =>
        buildCasePacket(option.id, option.provider, caseData.id)
      ),
    } satisfies RpModelQualificationModelPacket;
  });

  return {
    packetVersion: RP_MODEL_QUALIFICATION_PACKET_VERSION,
    fixtureVersion: RP_MODEL_QUALIFICATION_FIXTURE_VERSION,
    source: CANONICAL_RP_QUALIFICATION_SOURCE,
    owners: RP_MODEL_QUALIFICATION_PACKET_OWNERS,
    activeModelIds: MAIN_RP_MODEL_IDS,
    providerCalls: 0,
    runtimeObservations: "NOT_RUN",
    models,
  };
}
