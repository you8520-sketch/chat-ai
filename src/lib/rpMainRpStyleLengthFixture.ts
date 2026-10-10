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
  type RpQualityPrecallFixtureId,
} from "@/lib/rpQualityPrecall";
import type { PaidRunnerIdentityHashes } from "@/lib/rpQualityPaidRunner";
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
});

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
  currentProductionSuccessSha?: string | null;
  assemblySourceSha?: string | null;
  capturedDeploySha?: string | null;
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
  requiredHashMissing: boolean;
  currentLiveVerified: boolean;
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
  if (input.mismatch) return "PRODUCTION_PARITY_MISMATCH";
  if (input.semanticUnconfirmed) return "SEMANTIC_PARITY_UNCONFIRMED";
  if (
    input.evidenceKind === "CURRENT_LIVE" &&
    input.currentLiveVerified &&
    Boolean(input.currentSha) &&
    (!input.assemblySha || input.assemblySha === input.currentSha) &&
    (!input.capturedSha || input.capturedSha === input.currentSha) &&
    !input.requiredHashMissing &&
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

  const identityOk =
    input.characterId === MAIN_RP_STYLE_LENGTH_TARGET.characterId &&
    (input.characterName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.characterName &&
    (input.personaName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.personaName &&
    typeof input.personaId === "number" &&
    input.personaId > 0;
  if (!identityOk) {
    reasons.push("identity_not_laike_ren");
    fields.push({
      field: "identity",
      classification: input.characterId == null ? "missing_evidence" : "mismatch",
      reason: "requires_character_18_laike_and_persona_ren",
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

  if (input.authoringLevel != null && input.authoringLevel !== policy.authoringLevel) {
    reasons.push("authoring_policy_mismatch");
    fields.push({
      field: "authoringLevel",
      classification: "mismatch",
      reason: `expected_${policy.authoringLevel}`,
    });
  } else if (input.authoringLevel === policy.authoringLevel) {
    fields.push({
      field: "authoringLevel",
      classification: "match",
      reason: policy.authoringLevel,
    });
  }

  if (input.contentMode != null && input.contentMode !== policy.contentMode) {
    reasons.push("content_mode_mismatch");
    fields.push({
      field: "contentMode",
      classification: "mismatch",
      reason: `expected_${policy.contentMode}`,
    });
  } else if (input.contentMode === policy.contentMode) {
    fields.push({ field: "contentMode", classification: "match", reason: policy.contentMode });
  }

  if (input.softAimChars != null && input.softAimChars !== UNIFIED_TIER_AIM_CHARS) {
    reasons.push("length_owner_drift");
    fields.push({
      field: "softAimChars",
      classification: "mismatch",
      reason: "must_read_UNIFIED_TIER_AIM_CHARS",
    });
  } else if (input.softAimChars === UNIFIED_TIER_AIM_CHARS) {
    fields.push({
      field: "softAimChars",
      classification: "match",
      reason: "UNIFIED_TIER_AIM_CHARS",
    });
  }

  if (input.maxTokensPresent === true || input.maxCompletionTokensPresent === true) {
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
  ] as const;
  const hashPairs: Array<[string, string | null | undefined, string | null | undefined]> = [
    [
      "identityHashes",
      input.identityHashes ? JSON.stringify(input.identityHashes) : null,
      input.expectedIdentityHashes ? JSON.stringify(input.expectedIdentityHashes) : null,
    ],
    ["finalWireFingerprint", input.finalWireFingerprint, input.expectedFinalWireFingerprint],
    ["requestBodyFingerprint", input.requestBodyFingerprint, input.expectedRequestBodyFingerprint],
    ["messagesFingerprint", input.messagesFingerprint, input.expectedMessagesFingerprint],
    [
      "commonStyleSectionOrderHash",
      input.commonStyleSectionOrderHash,
      input.expectedCommonStyleSectionOrderHash,
    ],
    [
      "modelStyleSectionOrderHash",
      input.modelStyleSectionOrderHash,
      input.expectedModelStyleSectionOrderHash,
    ],
    [
      "commonStyleSectionContentHash",
      input.commonStyleSectionContentHash,
      input.expectedCommonStyleSectionContentHash,
    ],
    [
      "modelStyleSectionContentHash",
      input.modelStyleSectionContentHash,
      input.expectedModelStyleSectionContentHash,
    ],
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

  if (input.sampling && input.expectedSampling) {
    const samplingMatch =
      input.sampling.temperature === input.expectedSampling.temperature &&
      input.sampling.top_p === input.expectedSampling.top_p;
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
  }

  if (input.thinkingSemanticEquivalent === false || input.reasoningSemanticEquivalent === false) {
    reasons.push("thinking_or_reasoning_semantic_mismatch");
    fields.push({
      field: "thinking_reasoning",
      classification: "mismatch",
      reason: "semantic_not_equivalent",
    });
  } else if (
    input.thinkingSemanticEquivalent == null ||
    input.reasoningSemanticEquivalent == null
  ) {
    reasons.push("thinking_or_reasoning_semantic_unconfirmed");
    fields.push({
      field: "thinking_reasoning",
      classification: "semantic_unconfirmed",
      reason: "provider_field_meaning_not_proven",
    });
  } else {
    fields.push({
      field: "thinking_reasoning",
      classification: "match",
      reason: "semantic_equivalent",
    });
  }

  if (
    input.recoveryPath != null &&
    input.expectedRecoveryPath != null &&
    input.recoveryPath !== input.expectedRecoveryPath
  ) {
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

  if (input.featureFlagsMatch === false) {
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
    (input.evidenceKind === "GOLDEN_SNAPSHOT" && input.currentLiveVerified !== true) ||
    Boolean(input.liveCompare?.deployShaChanged);
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

  const status = resolveParityStatus({
    evidenceKind: input.evidenceKind,
    identityOk,
    fixturesOk,
    requiredHashMissing,
    currentLiveVerified: input.currentLiveVerified === true,
    currentSha,
    assemblySha,
    capturedSha,
    stale,
    mismatch,
    semanticUnconfirmed: uniqueReasons.includes("thinking_or_reasoning_semantic_unconfirmed"),
    thinkingConfirmed:
      input.thinkingSemanticEquivalent === true && input.reasoningSemanticEquivalent === true,
    softAimMatchesOwner: input.softAimChars === UNIFIED_TIER_AIM_CHARS,
    maxTokensAbsent:
      input.maxTokensPresent !== true && input.maxCompletionTokensPresent !== true,
    flattenedLosingMeaning: input.flattenedLosingMeaning === true,
    featureFlagsOk: input.featureFlagsMatch !== false,
  });

  return {
    status,
    qualityScoreEligible: status === "PRODUCTION_PARITY_VERIFIED",
    reasons: uniqueReasons,
    fields,
    softAimChars: UNIFIED_TIER_AIM_CHARS,
    targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
    precallReadyIsSeparate: true,
    paidAuthorizationIsSeparate: true,
  };
}
