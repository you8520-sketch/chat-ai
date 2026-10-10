/**
 * Canonical owner for MAIN_RP_STYLE_LENGTH evaluation.
 *
 * Identity selector stays RP_QUALITY_PRECALL_TARGET_SELECTOR.
 * Live rows stay loadPrecallProductionRows.
 * Final assembly stays assemblePrecallFinalWireWithSealedRequests.
 * This file only fail-closes identity/mode and describes the public hash manifest.
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
import {
  DEFAULT_USER_AUTHORING_LEVEL,
  capabilitiesFromUserAuthoringLevel,
} from "@/lib/userAuthoringPolicy";

export const MAIN_RP_STYLE_LENGTH_EVALUATION = "MAIN_RP_STYLE_LENGTH" as const;
export const MAIN_RP_STYLE_LENGTH_TARGET = RP_QUALITY_PRECALL_TARGET_SELECTOR;
export const MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA = 1;
export const MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT = "/data/private-golden-fixtures";
export const HISTORICAL_RP_QUALIFICATION_CHARACTER_ID = 10;

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
  adminVerified?: boolean;
  personaCount?: number;
  models?: readonly string[];
  finalWireFingerprints?: readonly string[];
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
  if (input.adminVerified === false) {
    reject("ADMIN_UNVERIFIED");
  }
  if (input.personaCount === 0) {
    reject("PERSONA_MISSING");
  }
  if (typeof input.personaCount === "number" && input.personaCount > 1) {
    reject("PERSONA_AMBIGUOUS");
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
    targetLengthOwner: "UNIFIED_TIER_AIM_CHARS",
    artificialMaxOutputChars: null,
  };
}

export function isMainRpStyleLengthEvaluationRequested(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.MAIN_RP_STYLE_LENGTH === "1" || env.MAIN_RP_STYLE_LENGTH_EVALUATION === "1";
}
