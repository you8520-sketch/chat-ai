/**
 * Canonical owner for MAIN_RP_STYLE_LENGTH evaluation and the reusable
 * production-parity gate.
 *
 * Identity selector stays RP_QUALITY_PRECALL_TARGET_SELECTOR.
 * Live rows stay loadPrecallProductionRows.
 * Final assembly stays assemblePrimaryRpRequest / assemblePrecallFinalWireWithSealedRequests.
 * Length stays UNIFIED_TIER_AIM_CHARS. Prompt wording is not this file's job.
 * This file fail-closes identity/mode, describes the public hash manifest, and
 * classifies PRODUCTION_PARITY_* for quality-score eligibility.
 */
import {
  MAIN_RP_MODEL_IDS,
  isMainRpModel,
  type SelectedAI,
} from "@/lib/chatModels";
import {
  RP_QUALITY_PRECALL_FIXTURE_IDS,
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  validateLiveProof,
  type RpQualityPrecallFixtureId,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";
import {
  paidRunnerRequestBodyFingerprint,
  type PaidRunnerIdentityHashes,
} from "@/lib/rpQualityPaidRunner";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  DEFAULT_USER_AUTHORING_LEVEL,
  capabilitiesFromUserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";

export const MAIN_RP_STYLE_LENGTH_EVALUATION = "MAIN_RP_STYLE_LENGTH" as const;
export const MAIN_RP_STYLE_LENGTH_TARGET = RP_QUALITY_PRECALL_TARGET_SELECTOR;
export const MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA = 1;
export const MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT = "/data/private-golden-fixtures";
export const HISTORICAL_RP_QUALIFICATION_CHARACTER_ID = 10;

/** Pinned public evidence for the already-created Railway Golden v1. Do not rewrite v1. */
export const MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC = Object.freeze({
  sourceId: "docs/audits/main-rp-laike-ren-golden/v1.public.json",
  snapshotVersion: 1,
  sealedSha256: "becd3255c38cfc44932d9dc9da98656206b76b64c679f75a1f20ad20cf1fa1d9",
  characterId: 18,
  characterName: "라이크",
  personaId: 1,
  personaName: "렌",
  personaGender: "male",
  adminUserId: 1,
  uniqueAdminRenPersona: true,
  deployedGitSha: "e1fdab509d2e9713be617025f77ea40a5bfb85f5",
  sealedRequestCount: 12,
  identityHashes: {
    greetingSha256: "29e3149289586f303c3ffc120a299184163b162a78e46e4f264e87231f6d1d58",
    systemPromptSha256: "44c293ce3e6aaa7ab885ad93c93342a0e4d1ed803a2c7e22119f42991ee44d6b",
    worldSha256: "6e197c4e91f3f5dbe9a3b867232c564230272fe6a29e24f26d2f41964a500fa9",
    settingChunksSha256: "8eee31d5ce8cd6a736030613ac615a3755542a718d22f082a02c4d9ba0aa90cc",
    personaPublicSha256: "9ef42c7f92091ca158a53c4321b06dab4e687d3a882210c4a576e87029703a36",
  } satisfies PaidRunnerIdentityHashes,
});

export const MAIN_RP_STYLE_LENGTH_MODES = ["GOLDEN_SNAPSHOT", "CURRENT_LIVE"] as const;
export type MainRpStyleLengthMode = (typeof MAIN_RP_STYLE_LENGTH_MODES)[number];

export const MAIN_RP_STYLE_LENGTH_KINDS = [
  "GOLDEN_SNAPSHOT",
  "CURRENT_LIVE",
  "HISTORICAL_ONLY",
  "TEST_ONLY_SYNTHETIC",
] as const;
export type MainRpStyleLengthKind = (typeof MAIN_RP_STYLE_LENGTH_KINDS)[number];

export const MAIN_RP_STYLE_LENGTH_REJECT_CODES = [
  "FIXTURE_IDENTITY_MISMATCH",
  "HISTORICAL_ID10_REJECTED",
  "SYNTHETIC_REJECTED",
  "PERSONA_NOT_REN",
  "ADMIN_UNVERIFIED",
  "PERSONA_AMBIGUOUS",
  "PERSONA_MISSING",
  "SOURCE_HASH_MISMATCH",
  "SOURCE_DRIFT",
  "FINAL_WIRE_MISSING",
  "INACTIVE_MODEL",
  "GOLDEN_VERSION_EXISTS",
  "GOLDEN_VERSION_MISSING",
  "SNAPSHOT_TAMPERED",
] as const;
export type MainRpStyleLengthRejectCode = (typeof MAIN_RP_STYLE_LENGTH_REJECT_CODES)[number];

export class MainRpStyleLengthFixtureError extends Error {
  constructor(readonly code: MainRpStyleLengthRejectCode) {
    super(code);
    this.name = "MainRpStyleLengthFixtureError";
  }
}

export type MainRpStyleLengthIdentityInput = {
  characterId: number;
  characterName: string;
  personaName: string;
  fixtureKind: MainRpStyleLengthKind;
  personaId?: number;
  personaGender?: string;
  adminUserId?: number;
  adminVerified?: boolean;
  personaCount?: number;
  expectedPersonaId?: number;
  models?: readonly string[];
  finalWireFingerprints?: readonly string[];
  requestBodies?: readonly unknown[];
};

export type MainRpStyleLengthPublicCall = {
  fixtureId: RpQualityPrecallFixtureId;
  canonicalId: SelectedAI;
  provider: "openrouter" | "cheaperinference";
  wireModel: string;
  finalWireFingerprint: string;
  requestBodyFingerprint: string;
};

export type MainRpStyleLengthPublicManifest = {
  evaluation: typeof MAIN_RP_STYLE_LENGTH_EVALUATION;
  snapshotSchema: typeof MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA;
  snapshotVersion: number;
  mode: MainRpStyleLengthMode;
  capturedAt: string;
  deployedGitSha: string;
  characterId: typeof MAIN_RP_STYLE_LENGTH_TARGET.characterId;
  characterName: typeof MAIN_RP_STYLE_LENGTH_TARGET.characterName;
  personaId: number;
  personaName: typeof MAIN_RP_STYLE_LENGTH_TARGET.personaName;
  personaGender: string;
  adminUserId: number;
  uniqueAdminRenPersona: true;
  authoringLevel: typeof DEFAULT_USER_AUTHORING_LEVEL;
  userCoauthor: ReturnType<typeof capabilitiesFromUserAuthoringLevel>;
  contentMode: "SAFE";
  contentKind: string;
  nsfwListing: number | null;
  officialListing: number | null;
  creatorLorebookAttachments: number;
  globalLorebookEnabled: number;
  greetingChars: number | null;
  personaPublicChars: number;
  identityHashes: PaidRunnerIdentityHashes;
  combinedIdentityHash: string;
  fixtureIds: typeof RP_QUALITY_PRECALL_FIXTURE_IDS;
  models: readonly SelectedAI[];
  calls: readonly MainRpStyleLengthPublicCall[];
  sealedRequestCount: number;
  sourceKind: "railway-production-readonly-in-process-v1";
  privateStore: string;
  overwrite: false;
  providerPosts: 0;
  dbWrites: 0;
  qualityScores: null;
};

export type MainRpStyleLengthLiveCompare = {
  mode: "CURRENT_LIVE";
  snapshotVersion: number;
  sourceDrift: boolean;
  deployShaChanged: boolean;
  identityHashMatch: boolean;
  finalWireMatch: boolean;
  driftedFields: readonly string[];
};

function reject(code: MainRpStyleLengthRejectCode): never {
  throw new MainRpStyleLengthFixtureError(code);
}

export function assertMainRpStyleLengthIdentity(
  input: MainRpStyleLengthIdentityInput
): void {
  switch (input.fixtureKind) {
    case "HISTORICAL_ONLY":
      reject("HISTORICAL_ID10_REJECTED");
      break;
    case "TEST_ONLY_SYNTHETIC":
      reject("SYNTHETIC_REJECTED");
      break;
    case "GOLDEN_SNAPSHOT":
    case "CURRENT_LIVE":
      break;
    default: {
      const exhaustive: never = input.fixtureKind;
      throw new Error(`unhandled fixture kind: ${String(exhaustive)}`);
    }
  }

  if (input.characterId === HISTORICAL_RP_QUALIFICATION_CHARACTER_ID) {
    reject("HISTORICAL_ID10_REJECTED");
  }
  if (
    input.characterId !== MAIN_RP_STYLE_LENGTH_TARGET.characterId ||
    input.characterName.trim() !== MAIN_RP_STYLE_LENGTH_TARGET.characterName
  ) {
    reject("FIXTURE_IDENTITY_MISMATCH");
  }
  if (input.personaName.trim() !== MAIN_RP_STYLE_LENGTH_TARGET.personaName) {
    reject("PERSONA_NOT_REN");
  }
  if (input.adminVerified !== true || typeof input.adminUserId !== "number" || input.adminUserId <= 0) {
    reject("ADMIN_UNVERIFIED");
  }
  if (typeof input.personaId !== "number" || input.personaId <= 0) {
    reject("PERSONA_MISSING");
  }
  if (input.personaCount !== 1) {
    if (input.personaCount === 0 || input.personaCount == null) reject("PERSONA_MISSING");
    reject("PERSONA_AMBIGUOUS");
  }
  if (
    typeof input.expectedPersonaId === "number" &&
    input.personaId !== input.expectedPersonaId
  ) {
    reject("FIXTURE_IDENTITY_MISMATCH");
  }
  if (input.models) {
    if (input.models.length === 0) reject("INACTIVE_MODEL");
    for (const modelId of input.models) {
      if (!isMainRpModel(modelId)) reject("INACTIVE_MODEL");
    }
  }
  if (input.finalWireFingerprints && input.finalWireFingerprints.length === 0) {
    reject("FINAL_WIRE_MISSING");
  }
}

function requestBodyPresent(body: unknown): boolean {
  return body !== null && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length > 0;
}

export function deriveMainRpStyleLengthAdminEvidence(input: {
  adminUserId?: number;
  personaId?: number;
  personaName?: string;
  characterId?: number;
  characterName?: string;
  uniqueAdminRenPersona?: boolean;
}): { adminVerified: boolean; personaCount: number; adminUserId: number } {
  const adminUserId = typeof input.adminUserId === "number" ? input.adminUserId : 0;
  const unique = input.uniqueAdminRenPersona === true;
  const verified =
    unique &&
    adminUserId > 0 &&
    typeof input.personaId === "number" &&
    input.personaId > 0 &&
    String(input.personaName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.personaName &&
    input.characterId === MAIN_RP_STYLE_LENGTH_TARGET.characterId &&
    String(input.characterName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.characterName;
  return {
    adminVerified: verified,
    personaCount: unique && verified ? 1 : 0,
    adminUserId,
  };
}

export function assertMainRpStyleLengthEvaluationReady(
  input: MainRpStyleLengthIdentityInput
): void {
  assertMainRpStyleLengthIdentity(input);
  if (!input.models || input.models.length === 0) reject("INACTIVE_MODEL");
  const fingerprints = input.finalWireFingerprints;
  const bodies = input.requestBodies;
  if (!fingerprints || fingerprints.length === 0) reject("FINAL_WIRE_MISSING");
  if (!bodies || bodies.length === 0) reject("FINAL_WIRE_MISSING");
  if (fingerprints.length !== bodies.length) reject("FINAL_WIRE_MISSING");
  if (!fingerprints.every((hash) => /^[a-f0-9]{64}$/.test(hash))) reject("FINAL_WIRE_MISSING");
  if (!bodies.every(requestBodyPresent)) reject("FINAL_WIRE_MISSING");
}

export function assertMainRpStyleLengthHashes(input: {
  expected: PaidRunnerIdentityHashes;
  actual: PaidRunnerIdentityHashes;
}): void {
  const fields: (keyof PaidRunnerIdentityHashes)[] = [
    "greetingSha256",
    "systemPromptSha256",
    "worldSha256",
    "settingChunksSha256",
    "personaPublicSha256",
  ];
  for (const field of fields) {
    if (input.expected[field] !== input.actual[field]) {
      reject("SOURCE_HASH_MISMATCH");
    }
  }
}

export function compareLiveToGolden(input: {
  snapshotVersion: number;
  goldenDeploySha: string;
  liveDeploySha: string;
  goldenHashes: PaidRunnerIdentityHashes;
  liveHashes: PaidRunnerIdentityHashes;
  goldenFinalWires: readonly string[];
  liveFinalWires: readonly string[];
}): MainRpStyleLengthLiveCompare {
  const driftedFields: string[] = [];
  const hashFields: (keyof PaidRunnerIdentityHashes)[] = [
    "greetingSha256",
    "systemPromptSha256",
    "worldSha256",
    "settingChunksSha256",
    "personaPublicSha256",
  ];
  for (const field of hashFields) {
    if (input.goldenHashes[field] !== input.liveHashes[field]) driftedFields.push(field);
  }
  const identityHashMatch = driftedFields.length === 0;
  const finalWireMatch =
    input.goldenFinalWires.length === input.liveFinalWires.length &&
    input.goldenFinalWires.every((hash, index) => hash === input.liveFinalWires[index]);
  if (!finalWireMatch) driftedFields.push("finalWireFingerprints");
  return {
    mode: "CURRENT_LIVE",
    snapshotVersion: input.snapshotVersion,
    sourceDrift: !identityHashMatch || !finalWireMatch,
    deployShaChanged:
      input.goldenDeploySha.trim().toLowerCase() !== input.liveDeploySha.trim().toLowerCase(),
    identityHashMatch,
    finalWireMatch,
    driftedFields,
  };
}

export function mainRpStyleLengthSitePolicy() {
  return {
    authoringLevel: DEFAULT_USER_AUTHORING_LEVEL,
    userCoauthor: capabilitiesFromUserAuthoringLevel(DEFAULT_USER_AUTHORING_LEVEL),
    contentMode: "SAFE" as const,
    contentModeOwner: "rpQualityPrecallFixtures contentMode — PRECALL plan constant, not characters.nsfw",
    nsfwListingOwner: "characters.nsfw listing/content-rating only",
    models: MAIN_RP_MODEL_IDS,
    fixtureIds: RP_QUALITY_PRECALL_FIXTURE_IDS,
    targetLengthOwner: "UNIFIED_TIER_AIM_CHARS" as const,
    softAimChars: UNIFIED_TIER_AIM_CHARS,
    artificialMaxOutputChars: null,
  };
}

export function isMainRpStyleLengthEvaluationRequested(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.MAIN_RP_STYLE_LENGTH === "1" || env.MAIN_RP_STYLE_LENGTH_EVALUATION === "1";
}

export const PRODUCTION_PARITY_STATUSES = [
  "PRODUCTION_PARITY_VERIFIED",
  "PRODUCTION_PARITY_MISMATCH",
  "SEMANTIC_PARITY_UNCONFIRMED",
  "STALE_PRODUCTION_SNAPSHOT",
  "NOT_COMPARABLE",
] as const;
export type ProductionParityStatus = (typeof PRODUCTION_PARITY_STATUSES)[number];

export const PRODUCTION_PARITY_QUALITY_SCORE_RULE = Object.freeze({
  requiredStatus: "PRODUCTION_PARITY_VERIFIED" as const,
  precallReadyIsSeparate: true,
  paidAuthorizationIsSeparate: true,
  syntheticCannotPromoteToQualityScore: true,
  callerAnnotationCannotVerify: true,
  sameSourceHashPairCannotVerify: true,
  currentLiveVerifiedBooleanCannotVerify: true,
});

export const PRODUCTION_PARITY_PROVENANCE_KINDS = [
  "in_process_assembly",
  "railway_live_proof",
  "golden_public_manifest",
  "caller_annotation",
] as const;
export type ProductionParityProvenanceKind =
  (typeof PRODUCTION_PARITY_PROVENANCE_KINDS)[number];

export type ProductionParityProvenance = {
  kind: ProductionParityProvenanceKind;
  sourceId: string;
};

export type ProductionParitySection = {
  sectionId: string;
  sha256: string;
};

export type ProductionParityRuntimeFlags = {
  contentMode?: string;
  authoringLevel?: string;
  [key: string]: unknown;
};

export type ProductionParityFieldClassification =
  | "match"
  | "mismatch"
  | "allowed_provider_inventory"
  | "semantic_unconfirmed"
  | "missing_evidence"
  | "not_applicable";

export type ProductionParityFieldDelta = {
  field: string;
  classification: ProductionParityFieldClassification;
  reason: string;
};

export type ProductionParityEvidenceKind =
  | "CURRENT_LIVE"
  | "GOLDEN_SNAPSHOT"
  | "SYNTHETIC"
  | "MISSING";

export type ProductionParityInput = {
  evidenceKind: ProductionParityEvidenceKind;
  observedProvenance?: ProductionParityProvenance | null;
  expectedProvenance?: ProductionParityProvenance | null;
  liveProofInput?: RpQualityPrecallLiveProofInput | null;
  assembledRequestBody?: Record<string, unknown> | null;
  expectedSealedRequestBody?: Record<string, unknown> | null;
  observedStyleSections?: readonly ProductionParitySection[] | null;
  expectedStyleSections?: readonly ProductionParitySection[] | null;
  observedRuntimeFlags?: ProductionParityRuntimeFlags | null;
  expectedRuntimeFlags?: ProductionParityRuntimeFlags | null;
  precallReady?: boolean | null;
  currentProductionSuccessSha?: string | null;
  assemblySourceSha?: string | null;
  capturedDeploySha?: string | null;
  /** Caller annotation only. Never sufficient for VERIFIED. */
  currentLiveVerified?: boolean;
  characterId?: number;
  characterName?: string;
  personaId?: number;
  personaName?: string;
  fixtureId?: string | null;
  fixtureIds?: readonly string[] | null;
  authoringLevel?: string | null;
  contentMode?: string | null;
  softAimChars?: number | null;
  maxTokensPresent?: boolean;
  maxCompletionTokensPresent?: boolean;
  identityHashes?: PaidRunnerIdentityHashes | null;
  expectedIdentityHashes?: PaidRunnerIdentityHashes | null;
  finalWireFingerprint?: string | null;
  expectedFinalWireFingerprint?: string | null;
  requestBodyFingerprint?: string | null;
  expectedRequestBodyFingerprint?: string | null;
  commonStyleSectionOrderHash?: string | null;
  expectedCommonStyleSectionOrderHash?: string | null;
  modelStyleSectionOrderHash?: string | null;
  expectedModelStyleSectionOrderHash?: string | null;
  commonStyleSectionContentHash?: string | null;
  expectedCommonStyleSectionContentHash?: string | null;
  modelStyleSectionContentHash?: string | null;
  expectedModelStyleSectionContentHash?: string | null;
  messagesFingerprint?: string | null;
  expectedMessagesFingerprint?: string | null;
  sampling?: { temperature?: unknown; top_p?: unknown } | null;
  expectedSampling?: { temperature?: unknown; top_p?: unknown } | null;
  /** Caller annotation only. VERIFIED requires JSON-equal thinking on independent bodies. */
  thinkingSemanticEquivalent?: boolean | null;
  reasoningSemanticEquivalent?: boolean | null;
  recoveryPath?: string | null;
  expectedRecoveryPath?: string | null;
  flattenedLosingMeaning?: boolean;
  featureFlagsMatch?: boolean | null;
  liveCompare?: MainRpStyleLengthLiveCompare | null;
};

export type ProductionParityResult = {
  status: ProductionParityStatus;
  qualityScoreEligible: boolean;
  reasons: readonly string[];
  fields: readonly ProductionParityFieldDelta[];
  softAimChars: typeof UNIFIED_TIER_AIM_CHARS;
  targetLengthOwner: "UNIFIED_TIER_AIM_CHARS";
  precallReadyIsSeparate: true;
  paidAuthorizationIsSeparate: true;
};

function normalizeParitySha(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isRequestBody(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function isTrustedObservedProvenance(value: ProductionParityProvenance | null | undefined): boolean {
  return value?.kind === "in_process_assembly" || value?.kind === "railway_live_proof";
}

function isTrustedExpectedProvenance(value: ProductionParityProvenance | null | undefined): boolean {
  return value?.kind === "golden_public_manifest" || value?.kind === "railway_live_proof";
}

function provenanceSourceId(value: ProductionParityProvenance | null | undefined): string {
  return (value?.sourceId ?? "").trim().toLowerCase();
}

function isOfficialGoldenExpected(value: ProductionParityProvenance | null | undefined): boolean {
  return (
    value?.kind === "golden_public_manifest" &&
    provenanceSourceId(value) === normalizeParitySha(MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.sourceId)
  );
}

function identityHashesFromLiveProof(
  input: RpQualityPrecallLiveProofInput | null | undefined
): PaidRunnerIdentityHashes | null {
  if (!input) return null;
  const hashes: PaidRunnerIdentityHashes = {
    greetingSha256: input.greetingSha256,
    systemPromptSha256: input.systemPromptSha256,
    worldSha256: input.worldSha256,
    settingChunksSha256: input.settingChunksSha256,
    personaPublicSha256: input.personaPublicSha256,
  };
  return Object.values(hashes).every((hash) => /^[a-f0-9]{64}$/i.test(hash)) ? hashes : null;
}

function samplingFromBody(
  body: Record<string, unknown> | null
): { temperature?: unknown; top_p?: unknown } | null {
  if (!body || (!("temperature" in body) && !("top_p" in body))) return null;
  return { temperature: body.temperature, top_p: body.top_p };
}

function messagesFingerprintFromBody(body: Record<string, unknown> | null): string | null {
  if (!body || !Array.isArray(body.messages)) return null;
  return paidRunnerRequestBodyFingerprint({ messages: body.messages });
}

function finalWireFingerprintFromBody(body: Record<string, unknown> | null): string | null {
  if (!body || !Array.isArray(body.messages)) return null;
  return paidRunnerRequestBodyFingerprint({ messages: body.messages, body });
}

function isCommonStyleSection(sectionId: string): boolean {
  return /prose-style|korean-prose/i.test(sectionId);
}

function sectionOrderHash(sections: readonly ProductionParitySection[]): string {
  return paidRunnerRequestBodyFingerprint({
    order: sections.map((section) => section.sectionId),
  });
}

function sectionContentHash(sections: readonly ProductionParitySection[]): string {
  return paidRunnerRequestBodyFingerprint({
    content: sections.map((section) => `${section.sectionId}:${section.sha256}`),
  });
}

function splitStyleSections(sections: readonly ProductionParitySection[] | null | undefined): {
  common: ProductionParitySection[];
  model: ProductionParitySection[];
} {
  const list = sections ?? [];
  return {
    common: list.filter((section) => isCommonStyleSection(section.sectionId)),
    model: list.filter((section) => !isCommonStyleSection(section.sectionId)),
  };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function classifyHashPair(
  actual: string | null | undefined,
  expected: string | null | undefined
): "match" | "mismatch" | "missing_evidence" {
  const left = (actual ?? "").trim();
  const right = (expected ?? "").trim();
  if (!left || !right) return "missing_evidence";
  return left === right ? "match" : "mismatch";
}

function isAbcFixtureId(value: string | null | undefined): boolean {
  return (
    typeof value === "string" &&
    (RP_QUALITY_PRECALL_FIXTURE_IDS as readonly string[]).includes(value)
  );
}

function resolveParityStatus(input: {
  evidenceKind: ProductionParityEvidenceKind;
  identityOk: boolean;
  fixturesOk: boolean;
  independentEvidenceOk: boolean;
  requiredHashMissing: boolean;
  liveProofVerified: boolean;
  currentSha: string;
  assemblySha: string;
  capturedSha: string;
  stale: boolean;
  mismatch: boolean;
  semanticUnconfirmed: boolean;
  thinkingConfirmed: boolean;
  softAimMatchesOwner: boolean;
  maxTokensAbsent: boolean;
  flattenedLosingMeaning: boolean;
  featureFlagsOk: boolean;
}): ProductionParityStatus {
  if (
    input.evidenceKind === "SYNTHETIC" ||
    input.evidenceKind === "MISSING" ||
    !input.identityOk ||
    !input.fixturesOk
  ) {
    return "NOT_COMPARABLE";
  }
  if (input.stale) return "STALE_PRODUCTION_SNAPSHOT";
  if (!input.independentEvidenceOk || !input.liveProofVerified) {
    return "NOT_COMPARABLE";
  }
  if (input.mismatch || input.requiredHashMissing) return "PRODUCTION_PARITY_MISMATCH";
  if (input.semanticUnconfirmed) return "SEMANTIC_PARITY_UNCONFIRMED";
  if (
    input.evidenceKind === "CURRENT_LIVE" &&
    Boolean(input.currentSha) &&
    (!input.assemblySha || input.assemblySha === input.currentSha) &&
    (!input.capturedSha || input.capturedSha === input.currentSha) &&
    input.thinkingConfirmed &&
    input.softAimMatchesOwner &&
    input.maxTokensAbsent &&
    !input.flattenedLosingMeaning &&
    input.featureFlagsOk
  ) {
    return "PRODUCTION_PARITY_VERIFIED";
  }
  return "NOT_COMPARABLE";
}

export function goldenV1StaleAgainstCurrentSuccess(
  currentSuccessSha: string | null | undefined
): boolean {
  const current = normalizeParitySha(currentSuccessSha);
  if (!current) return true;
  return normalizeParitySha(MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.deployedGitSha) !== current;
}

/**
 * Fail-closed quality-score gate. PRECALL_READY and paid authorization stay
 * separate. Synthetic fixtures can exercise this function but never become
 * homepage quality scores unless every live current-production check passes.
 */
export function classifyMainRpProductionParity(
  input: ProductionParityInput
): ProductionParityResult {
  const fields: ProductionParityFieldDelta[] = [];
  const reasons: string[] = [];
  const policy = mainRpStyleLengthSitePolicy();

  const namesOk =
    input.characterId === MAIN_RP_STYLE_LENGTH_TARGET.characterId &&
    (input.characterName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.characterName &&
    (input.personaName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.personaName;
  const personaIdOk = typeof input.personaId === "number" && input.personaId > 0;
  const identityOk = namesOk && personaIdOk;
  if (!namesOk) {
    reasons.push("identity_not_laike_ren");
    fields.push({
      field: "identity",
      classification: input.characterId == null ? "missing_evidence" : "mismatch",
      reason: "requires_character_18_laike_and_persona_ren",
    });
  } else if (!personaIdOk) {
    reasons.push("persona_id_unconfirmed");
    fields.push({
      field: "personaId",
      classification: "missing_evidence",
      reason: "persona_id_must_come_from_verified_live_db",
    });
  } else {
    fields.push({ field: "identity", classification: "match", reason: "laike_18_ren" });
  }

  const fixtures = input.fixtureIds ?? (input.fixtureId ? [input.fixtureId] : []);
  const fixturesOk = fixtures.length > 0 && fixtures.every((id) => isAbcFixtureId(id));
  if (!fixturesOk) {
    reasons.push("fixture_not_abc");
    fields.push({
      field: "fixtureIds",
      classification: fixtures.length === 0 ? "missing_evidence" : "mismatch",
      reason: "requires_abc_fixtures",
    });
  } else {
    fields.push({ field: "fixtureIds", classification: "match", reason: "abc" });
  }

  if (input.evidenceKind === "SYNTHETIC") {
    reasons.push("synthetic_not_quality_score");
    fields.push({
      field: "evidenceKind",
      classification: "missing_evidence",
      reason: "synthetic_cannot_promote_to_quality_score",
    });
  } else if (input.evidenceKind === "MISSING") {
    reasons.push("current_live_evidence_missing");
    fields.push({
      field: "evidenceKind",
      classification: "missing_evidence",
      reason: "current_live_not_provided",
    });
  }

  if (input.currentLiveVerified === true) {
    reasons.push("current_live_verified_boolean_ignored");
    fields.push({
      field: "currentLiveVerified",
      classification: "missing_evidence",
      reason: "caller_boolean_cannot_satisfy_current_live",
    });
  }

  const observedProvenance = input.observedProvenance ?? null;
  const expectedProvenance = input.expectedProvenance ?? null;
  if (!observedProvenance || !expectedProvenance) {
    reasons.push("provenance_missing");
    fields.push({
      field: "provenance",
      classification: "missing_evidence",
      reason: "observed_and_expected_provenance_required",
    });
  } else if (
    observedProvenance.kind === "caller_annotation" ||
    expectedProvenance.kind === "caller_annotation"
  ) {
    reasons.push("caller_annotation_cannot_verify");
    fields.push({
      field: "provenance",
      classification: "missing_evidence",
      reason: "caller_annotation_is_not_independent_evidence",
    });
  } else if (
    !isTrustedObservedProvenance(observedProvenance) ||
    !isTrustedExpectedProvenance(expectedProvenance)
  ) {
    reasons.push("provenance_not_trusted");
    fields.push({
      field: "provenance",
      classification: "missing_evidence",
      reason: "observed_or_expected_provenance_not_trusted",
    });
  } else if (
    !provenanceSourceId(observedProvenance) ||
    provenanceSourceId(observedProvenance) === provenanceSourceId(expectedProvenance)
  ) {
    reasons.push("same_source_hash_pair");
    fields.push({
      field: "provenance",
      classification: "mismatch",
      reason: "expected_and_observed_must_use_distinct_source_ids",
    });
  } else {
    fields.push({
      field: "provenance",
      classification: "match",
      reason: `${observedProvenance.kind}_vs_${expectedProvenance.kind}`,
    });
  }

  const liveProof = validateLiveProof(input.liveProofInput ?? undefined, {
    expectedDeploySha: input.currentProductionSuccessSha ?? input.capturedDeploySha ?? undefined,
  });
  const liveProofVerified = liveProof.status === "VERIFIED";
  if (!input.liveProofInput) {
    reasons.push("live_proof_not_provided");
    fields.push({
      field: "liveProof",
      classification: "missing_evidence",
      reason: "validateLiveProof_required",
    });
  } else if (!liveProofVerified) {
    reasons.push("live_proof_not_verified");
    fields.push({
      field: "liveProof",
      classification: "missing_evidence",
      reason: liveProof.status === "UNVERIFIED" ? liveProof.reasons.join(",") : "not_verified",
    });
  } else {
    fields.push({ field: "liveProof", classification: "match", reason: "validateLiveProof" });
  }

  const assembledBody = isRequestBody(input.assembledRequestBody) ? input.assembledRequestBody : null;
  const expectedBody = isRequestBody(input.expectedSealedRequestBody)
    ? input.expectedSealedRequestBody
    : null;
  if (!assembledBody) {
    reasons.push("assembled_request_body_missing");
    fields.push({
      field: "assembledRequestBody",
      classification: "missing_evidence",
      reason: "observed_wire_must_be_computed_from_assembled_body",
    });
  }
  if (assembledBody && expectedBody && assembledBody === expectedBody) {
    reasons.push("same_source_hash_pair");
    fields.push({
      field: "requestBodies",
      classification: "mismatch",
      reason: "expected_sealed_body_is_the_same_object_as_observed",
    });
  }

  const observedIdentity = identityHashesFromLiveProof(
    liveProof.status === "VERIFIED" || liveProof.status === "UNVERIFIED" ? liveProof.input : null
  );
  const expectedIdentity = isOfficialGoldenExpected(expectedProvenance)
    ? MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.identityHashes
    : input.expectedIdentityHashes ?? null;
  if (observedIdentity && expectedIdentity && observedIdentity === expectedIdentity) {
    reasons.push("same_source_hash_pair");
  }

  const observedRequestBodyFingerprint = assembledBody
    ? paidRunnerRequestBodyFingerprint(assembledBody)
    : null;
  const observedMessagesFingerprint = messagesFingerprintFromBody(assembledBody);
  const observedFinalWireFingerprint = finalWireFingerprintFromBody(assembledBody);
  const expectedRequestBodyFingerprint = expectedBody
    ? paidRunnerRequestBodyFingerprint(expectedBody)
    : isOfficialGoldenExpected(expectedProvenance)
      ? input.expectedRequestBodyFingerprint ?? null
      : input.expectedRequestBodyFingerprint ?? null;
  const expectedMessagesFingerprint = expectedBody
    ? messagesFingerprintFromBody(expectedBody)
    : input.expectedMessagesFingerprint ?? null;
  const expectedFinalWireFingerprint = expectedBody
    ? finalWireFingerprintFromBody(expectedBody)
    : input.expectedFinalWireFingerprint ?? null;

  const observedSampling = samplingFromBody(assembledBody);
  const expectedSampling = samplingFromBody(expectedBody);
  if (input.sampling && input.expectedSampling && input.sampling === input.expectedSampling) {
    reasons.push("same_source_hash_pair");
    fields.push({
      field: "sampling",
      classification: "missing_evidence",
      reason: "tautological_sampling_pair_ignored",
    });
  }

  const observedThinking = assembledBody?.thinking;
  const expectedThinking = expectedBody?.thinking;
  const observedReasoning = assembledBody?.reasoning_effort ?? assembledBody?.reasoning;
  const expectedReasoning = expectedBody?.reasoning_effort ?? expectedBody?.reasoning;
  if (input.thinkingSemanticEquivalent === true || input.reasoningSemanticEquivalent === true) {
    reasons.push("thinking_boolean_ignored");
    fields.push({
      field: "thinking_reasoning",
      classification: "semantic_unconfirmed",
      reason: "caller_boolean_cannot_prove_provider_semantics",
    });
  }

  const observedStyle = splitStyleSections(input.observedStyleSections);
  const expectedStyle = splitStyleSections(input.expectedStyleSections);
  if (
    input.observedStyleSections &&
    input.expectedStyleSections &&
    input.observedStyleSections === input.expectedStyleSections
  ) {
    reasons.push("same_source_hash_pair");
  }
  const observedCommonOrder = observedStyle.common.length ? sectionOrderHash(observedStyle.common) : null;
  const expectedCommonOrder = expectedStyle.common.length ? sectionOrderHash(expectedStyle.common) : null;
  const observedCommonContent = observedStyle.common.length
    ? sectionContentHash(observedStyle.common)
    : null;
  const expectedCommonContent = expectedStyle.common.length
    ? sectionContentHash(expectedStyle.common)
    : null;
  const observedModelOrder = observedStyle.model.length ? sectionOrderHash(observedStyle.model) : null;
  const expectedModelOrder = expectedStyle.model.length ? sectionOrderHash(expectedStyle.model) : null;
  const observedModelContent = observedStyle.model.length ? sectionContentHash(observedStyle.model) : null;
  const expectedModelContent = expectedStyle.model.length ? sectionContentHash(expectedStyle.model) : null;

  const observedFlags = input.observedRuntimeFlags ?? null;
  const expectedFlags = input.expectedRuntimeFlags ?? null;
  if (observedFlags && expectedFlags && observedFlags === expectedFlags) {
    reasons.push("same_source_hash_pair");
  }

  const observedAuthoring =
    liveProof.status === "VERIFIED" || liveProof.status === "UNVERIFIED"
      ? liveProof.input.authoringLevel
      : null;
  const observedContentMode =
    liveProof.status === "VERIFIED" || liveProof.status === "UNVERIFIED"
      ? liveProof.input.contentMode
      : null;

  const currentSha = normalizeParitySha(input.currentProductionSuccessSha);
  const capturedSha = normalizeParitySha(input.capturedDeploySha);
  const assemblySha = normalizeParitySha(input.assemblySourceSha);
  if (!currentSha) {
    reasons.push("current_production_success_sha_missing");
    fields.push({
      field: "currentProductionSuccessSha",
      classification: "missing_evidence",
      reason: "live_success_sha_not_injected",
    });
  }
  if (capturedSha && currentSha && capturedSha !== currentSha) {
    reasons.push("stale_production_snapshot");
    fields.push({
      field: "deployedGitSha",
      classification: "mismatch",
      reason: "captured_sha_ne_current_success_sha",
    });
  } else if (capturedSha && currentSha && capturedSha === currentSha) {
    fields.push({
      field: "deployedGitSha",
      classification: "match",
      reason: "captured_matches_current_success",
    });
  }
  if (assemblySha && currentSha && assemblySha !== currentSha) {
    reasons.push("assembly_source_sha_not_current_success");
    fields.push({
      field: "assemblySourceSha",
      classification: "mismatch",
      reason: "assembly_sha_ne_current_success_sha",
    });
  }

  if (input.liveCompare?.deployShaChanged || input.liveCompare?.sourceDrift) {
    reasons.push("live_compare_drift");
    fields.push({
      field: "liveCompare",
      classification: "mismatch",
      reason: input.liveCompare.driftedFields.join(",") || "source_drift",
    });
  }

  const authoringObserved = observedAuthoring ?? input.authoringLevel ?? null;
  if (authoringObserved != null && authoringObserved !== policy.authoringLevel) {
    reasons.push("authoring_policy_mismatch");
    fields.push({
      field: "authoringLevel",
      classification: "mismatch",
      reason: `expected_${policy.authoringLevel}`,
    });
  } else if (authoringObserved === policy.authoringLevel) {
    fields.push({
      field: "authoringLevel",
      classification: "match",
      reason: policy.authoringLevel,
    });
  } else {
    reasons.push("authoring_evidence_missing");
    fields.push({
      field: "authoringLevel",
      classification: "missing_evidence",
      reason: "authoring_must_come_from_verified_live_proof",
    });
  }

  const contentObserved = observedContentMode ?? input.contentMode ?? null;
  if (contentObserved != null && contentObserved !== policy.contentMode) {
    reasons.push("content_mode_mismatch");
    fields.push({
      field: "contentMode",
      classification: "mismatch",
      reason: `expected_${policy.contentMode}`,
    });
  } else if (contentObserved === policy.contentMode) {
    fields.push({ field: "contentMode", classification: "match", reason: policy.contentMode });
  } else {
    reasons.push("content_mode_evidence_missing");
    fields.push({
      field: "contentMode",
      classification: "missing_evidence",
      reason: "content_mode_must_come_from_verified_live_proof",
    });
  }

  if (input.softAimChars != null && input.softAimChars !== UNIFIED_TIER_AIM_CHARS) {
    reasons.push("length_owner_drift");
    fields.push({
      field: "softAimChars",
      classification: "mismatch",
      reason: "must_read_UNIFIED_TIER_AIM_CHARS",
    });
  } else {
    fields.push({
      field: "softAimChars",
      classification: "match",
      reason: "UNIFIED_TIER_AIM_CHARS",
    });
  }

  const maxTokensOnWire =
    Boolean(assembledBody && ("max_tokens" in assembledBody || "max_completion_tokens" in assembledBody)) ||
    input.maxTokensPresent === true ||
    input.maxCompletionTokensPresent === true;
  if (maxTokensOnWire) {
    reasons.push("max_tokens_present");
    fields.push({
      field: "max_tokens",
      classification: "mismatch",
      reason: "eval_must_not_add_generation_ceiling",
    });
  }

  const requiredHashFields = [
    "identityHashes",
    "finalWireFingerprint",
    "requestBodyFingerprint",
    "messagesFingerprint",
    "commonStyleSectionOrderHash",
    "modelStyleSectionOrderHash",
    "commonStyleSectionContentHash",
    "modelStyleSectionContentHash",
  ] as const;
  const hashPairs: Array<[string, string | null | undefined, string | null | undefined]> = [
    [
      "identityHashes",
      observedIdentity ? JSON.stringify(observedIdentity) : null,
      expectedIdentity ? JSON.stringify(expectedIdentity) : null,
    ],
    ["finalWireFingerprint", observedFinalWireFingerprint, expectedFinalWireFingerprint],
    ["requestBodyFingerprint", observedRequestBodyFingerprint, expectedRequestBodyFingerprint],
    ["messagesFingerprint", observedMessagesFingerprint, expectedMessagesFingerprint],
    ["commonStyleSectionOrderHash", observedCommonOrder, expectedCommonOrder],
    ["modelStyleSectionOrderHash", observedModelOrder, expectedModelOrder],
    ["commonStyleSectionContentHash", observedCommonContent, expectedCommonContent],
    ["modelStyleSectionContentHash", observedModelContent, expectedModelContent],
  ];

  let comparableHashMismatch = false;
  let requiredHashMissing = false;
  for (const [field, actual, expected] of hashPairs) {
    const result = classifyHashPair(actual, expected);
    if (result === "mismatch") {
      comparableHashMismatch = true;
      reasons.push(`${field}_mismatch`);
      fields.push({ field, classification: "mismatch", reason: "hash_mismatch" });
      continue;
    }
    if (result === "match") {
      fields.push({ field, classification: "match", reason: "hash_match" });
      continue;
    }
    if (
      input.evidenceKind === "CURRENT_LIVE" &&
      (requiredHashFields as readonly string[]).includes(field)
    ) {
      requiredHashMissing = true;
      reasons.push(`${field}_missing`);
      fields.push({
        field,
        classification: "missing_evidence",
        reason: "required_fingerprint_owner_unobserved",
      });
    }
  }

  if (observedSampling && expectedSampling) {
    const samplingMatch =
      observedSampling.temperature === expectedSampling.temperature &&
      observedSampling.top_p === expectedSampling.top_p;
    if (!samplingMatch) {
      reasons.push("sampling_mismatch");
      fields.push({
        field: "sampling",
        classification: "mismatch",
        reason: "temperature_or_top_p_changed",
      });
    } else {
      fields.push({
        field: "sampling",
        classification: "match",
        reason: "temperature_top_p_preserved",
      });
    }
  } else {
    reasons.push("sampling_evidence_missing");
    fields.push({
      field: "sampling",
      classification: "missing_evidence",
      reason: "sampling_must_be_read_from_independent_request_bodies",
    });
  }

  const thinkingPresent = observedThinking !== undefined && expectedThinking !== undefined;
  const reasoningPresent = observedReasoning !== undefined && expectedReasoning !== undefined;
  if (input.thinkingSemanticEquivalent === false || input.reasoningSemanticEquivalent === false) {
    reasons.push("thinking_or_reasoning_semantic_mismatch");
    fields.push({
      field: "thinking_reasoning",
      classification: "mismatch",
      reason: "semantic_not_equivalent",
    });
  } else if (!thinkingPresent && !reasoningPresent) {
    reasons.push("thinking_or_reasoning_semantic_unconfirmed");
    fields.push({
      field: "thinking_reasoning",
      classification: "semantic_unconfirmed",
      reason: "provider_field_meaning_not_proven",
    });
  } else if (
    (thinkingPresent && !jsonEqual(observedThinking, expectedThinking)) ||
    (reasoningPresent && !jsonEqual(observedReasoning, expectedReasoning))
  ) {
    reasons.push("thinking_or_reasoning_semantic_mismatch");
    fields.push({
      field: "thinking_reasoning",
      classification: "mismatch",
      reason: "independent_bodies_do_not_match",
    });
  } else if (thinkingPresent && reasoningPresent) {
    fields.push({
      field: "thinking_reasoning",
      classification: "match",
      reason: "json_equal_on_independent_bodies",
    });
  } else {
    reasons.push("thinking_or_reasoning_semantic_unconfirmed");
    fields.push({
      field: "thinking_reasoning",
      classification: "semantic_unconfirmed",
      reason: "provider_field_meaning_not_proven",
    });
  }

  if (input.recoveryPath == null || input.expectedRecoveryPath == null) {
    reasons.push("recovery_path_missing");
    fields.push({
      field: "recoveryPath",
      classification: "missing_evidence",
      reason: "recovery_path_must_be_provided_on_both_sides",
    });
  } else if (input.recoveryPath !== input.expectedRecoveryPath) {
    reasons.push("recovery_path_mismatch");
    fields.push({
      field: "recoveryPath",
      classification: "mismatch",
      reason: "different_history_or_recovery_path",
    });
  }

  if (input.flattenedLosingMeaning === true) {
    reasons.push("flattened_losing_meaning");
    fields.push({
      field: "requestStructure",
      classification: "mismatch",
      reason: "flatten_lost_semantic_structure",
    });
  }

  if (!observedFlags || !expectedFlags) {
    reasons.push("runtime_flags_missing");
    fields.push({
      field: "featureFlags",
      classification: "missing_evidence",
      reason: "runtime_flags_must_come_from_independent_observations",
    });
  } else if (!jsonEqual(observedFlags, expectedFlags) || input.featureFlagsMatch === false) {
    reasons.push("feature_flag_or_runtime_mode_mismatch");
    fields.push({
      field: "featureFlags",
      classification: "mismatch",
      reason: "runtime_or_flag_changed",
    });
  }

  const uniqueReasons = [...new Set(reasons)];
  const stale =
    Boolean(capturedSha && currentSha && capturedSha !== currentSha) ||
    (input.evidenceKind === "GOLDEN_SNAPSHOT" &&
      normalizeParitySha(MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.deployedGitSha) !== currentSha) ||
    Boolean(input.liveCompare?.deployShaChanged) ||
    (isOfficialGoldenExpected(expectedProvenance) &&
      goldenV1StaleAgainstCurrentSuccess(input.currentProductionSuccessSha));
  const mismatch =
    comparableHashMismatch ||
    [
      "authoring_policy_mismatch",
      "content_mode_mismatch",
      "length_owner_drift",
      "max_tokens_present",
      "sampling_mismatch",
      "recovery_path_mismatch",
      "flattened_losing_meaning",
      "feature_flag_or_runtime_mode_mismatch",
      "thinking_or_reasoning_semantic_mismatch",
      "live_compare_drift",
      "assembly_source_sha_not_current_success",
    ].some((reason) => uniqueReasons.includes(reason));

  const independentEvidenceOk =
    isTrustedObservedProvenance(observedProvenance) &&
    isTrustedExpectedProvenance(expectedProvenance) &&
    Boolean(provenanceSourceId(observedProvenance)) &&
    provenanceSourceId(observedProvenance) !== provenanceSourceId(expectedProvenance) &&
    Boolean(assembledBody) &&
    Boolean(expectedBody || expectedRequestBodyFingerprint) &&
    !uniqueReasons.includes("same_source_hash_pair") &&
    !uniqueReasons.includes("caller_annotation_cannot_verify") &&
    !uniqueReasons.includes("provenance_missing") &&
    !uniqueReasons.includes("provenance_not_trusted") &&
    !uniqueReasons.includes("assembled_request_body_missing") &&
    !uniqueReasons.includes("sampling_evidence_missing") &&
    !uniqueReasons.includes("runtime_flags_missing") &&
    !uniqueReasons.includes("recovery_path_missing") &&
    !uniqueReasons.includes("authoring_evidence_missing") &&
    !uniqueReasons.includes("content_mode_evidence_missing") &&
    Boolean(observedCommonOrder && expectedCommonOrder && observedModelOrder && expectedModelOrder);

  const status = resolveParityStatus({
    evidenceKind: input.evidenceKind,
    identityOk,
    fixturesOk,
    independentEvidenceOk,
    requiredHashMissing,
    liveProofVerified,
    currentSha,
    assemblySha,
    capturedSha,
    stale,
    mismatch,
    semanticUnconfirmed:
      uniqueReasons.includes("thinking_or_reasoning_semantic_unconfirmed") ||
      uniqueReasons.includes("thinking_boolean_ignored"),
    thinkingConfirmed:
      thinkingPresent &&
      reasoningPresent &&
      jsonEqual(observedThinking, expectedThinking) &&
      jsonEqual(observedReasoning, expectedReasoning),
    softAimMatchesOwner: true,
    maxTokensAbsent: !maxTokensOnWire,
    flattenedLosingMeaning: input.flattenedLosingMeaning === true,
    featureFlagsOk: Boolean(observedFlags && expectedFlags && jsonEqual(observedFlags, expectedFlags)),
  });

  return {
    status,
    qualityScoreEligible: status === "PRODUCTION_PARITY_VERIFIED" && input.precallReady === true,
    reasons: uniqueReasons,
    fields,
    softAimChars: UNIFIED_TIER_AIM_CHARS,
    targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
    precallReadyIsSeparate: true,
    paidAuthorizationIsSeparate: true,
  };
}
