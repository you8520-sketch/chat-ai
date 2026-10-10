/**
 * Operator-only MAIN_RP_STYLE_LENGTH golden create/reload.
 * Reuses PRECALL row load + final-wire assembly. Raw sealed bytes stay in-process
 * or under the private snapshot root. Public stdout is hash-only.
 */
import { createHash } from "node:crypto";

import { MAIN_RP_MODEL_IDS, selectedAIProvider, type SelectedAI } from "@/lib/chatModels";
import { readRailwayDeploymentSha } from "@/lib/opsRequestIncidents";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import {
  buildPaidRunnerPublicManifest,
  createMockPaidRunnerTransport,
  expectedPaidRunnerProvider,
  paidRunnerIdentityHash,
  runPaidRunner,
  verifyPaidRunnerDispatchSeal,
  type PaidRunnerIdentityHashes,
  type PaidRunnerSealedCall,
} from "@/lib/rpQualityPaidRunner";
import {
  MAIN_RP_STYLE_LENGTH_EVALUATION,
  MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC,
  MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT,
  MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA,
  MAIN_RP_STYLE_LENGTH_TARGET,
  MainRpStyleLengthFixtureError,
  assertMainRpStyleLengthEvaluationReady,
  assertMainRpStyleLengthHashes,
  assertMainRpStyleLengthIdentity,
  compareLiveToGolden,
  deriveMainRpStyleLengthAdminEvidence,
  mainRpStyleLengthSitePolicy,
  type MainRpStyleLengthMode,
  type MainRpStyleLengthPublicCall,
  type MainRpStyleLengthPublicManifest,
} from "@/lib/rpMainRpStyleLengthFixture";
import { createMainRpStyleLengthSnapshotStore } from "@/lib/rpMainRpStyleLengthSnapshotStore";
import { RP_QUALITY_PRECALL_FIXTURE_IDS } from "@/lib/rpQualityPrecall";
import { identityHashesFromRows, preparePaidRunnerPack } from "./rpQualityPaidRunnerPrepare";
import {
  assemblePrecallFinalWireWithSealedRequests,
  type PrecallAssemblyRows,
} from "./rpQualityPrecallFinalWire";
import { loadPrecallProductionRows } from "./rpQualityPrecallProductionRows";

export type GoldenListingMeta = {
  nsfwListing: number | null;
  officialListing: number | null;
  greetingChars: number | null;
};

export type MainRpStyleLengthSealedSnapshot = {
  schema: typeof MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA;
  version: number;
  capturedAt: string;
  deployedGitSha: string;
  identity: {
    characterId: number;
    characterName: string;
    personaId: number;
    personaName: string;
    personaGender: string;
    adminUserId: number;
  };
  identityHashes: PaidRunnerIdentityHashes;
  rows: PrecallAssemblyRows;
  listing: GoldenListingMeta;
  sealedRequests: ReturnType<typeof assemblePrecallFinalWireWithSealedRequests>["sealedRequests"];
  plans: ReturnType<typeof assemblePrecallFinalWireWithSealedRequests>["report"]["plans"];
};

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function jsonPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function publicCalls(
  sealed: ReturnType<typeof assemblePrecallFinalWireWithSealedRequests>["sealedRequests"]
): MainRpStyleLengthPublicCall[] {
  return sealed.map((request) => ({
    fixtureId: request.fixtureId,
    canonicalId: request.canonicalId as SelectedAI,
    provider: request.provider,
    wireModel: request.wireModel,
    finalWireFingerprint: request.finalWireFingerprint,
    requestBodyFingerprint: request.requestBodyFingerprint,
  }));
}

export function buildMainRpStyleLengthPublicManifest(input: {
  version: number;
  capturedAt: string;
  deployedGitSha: string;
  rows: PrecallAssemblyRows;
  identityHashes: PaidRunnerIdentityHashes;
  sealedRequests: ReturnType<typeof assemblePrecallFinalWireWithSealedRequests>["sealedRequests"];
  listing: GoldenListingMeta;
  privateStore: string;
  personaPublicChars: number;
}): MainRpStyleLengthPublicManifest {
  const policy = mainRpStyleLengthSitePolicy();
  const personaId = Number(input.rows.persona.id);
  const adminUserId = Number(input.rows.user.id);
  return {
    evaluation: MAIN_RP_STYLE_LENGTH_EVALUATION,
    snapshotSchema: MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA,
    snapshotVersion: input.version,
    mode: "GOLDEN_SNAPSHOT",
    capturedAt: input.capturedAt,
    deployedGitSha: input.deployedGitSha,
    characterId: MAIN_RP_STYLE_LENGTH_TARGET.characterId,
    characterName: MAIN_RP_STYLE_LENGTH_TARGET.characterName,
    personaId,
    personaName: MAIN_RP_STYLE_LENGTH_TARGET.personaName,
    personaGender: String(input.rows.persona.gender ?? ""),
    adminUserId,
    uniqueAdminRenPersona: true,
    authoringLevel: policy.authoringLevel,
    userCoauthor: policy.userCoauthor,
    contentMode: policy.contentMode,
    contentKind: String(input.rows.character.content_kind ?? "character"),
    nsfwListing: input.listing.nsfwListing,
    officialListing: input.listing.officialListing,
    creatorLorebookAttachments: input.rows.creatorLorebookAttachments,
    globalLorebookEnabled: input.rows.globalLorebook.length,
    greetingChars: input.listing.greetingChars,
    personaPublicChars: input.personaPublicChars,
    identityHashes: input.identityHashes,
    combinedIdentityHash: paidRunnerIdentityHash(input.identityHashes),
    fixtureIds: RP_QUALITY_PRECALL_FIXTURE_IDS,
    models: MAIN_RP_MODEL_IDS,
    calls: publicCalls(input.sealedRequests),
    sealedRequestCount: input.sealedRequests.length,
    sourceKind: "railway-production-readonly-in-process-v1",
    privateStore: input.privateStore,
    overwrite: false,
    providerPosts: 0,
    dbWrites: 0,
    qualityScores: null,
  };
}

export function assembleMainRpStyleLengthSnapshot(input: {
  rows: PrecallAssemblyRows;
  deployedGitSha: string;
  version: number;
  listing: GoldenListingMeta;
  personaPublicChars?: number;
  fixtureKind: "CURRENT_LIVE" | "GOLDEN_SNAPSHOT";
  adminVerified?: boolean;
}): {
  sealed: MainRpStyleLengthSealedSnapshot;
  publicManifest: MainRpStyleLengthPublicManifest;
} {
  const identityHashes = identityHashesFromRows(input.rows);
  const assembledIdentity = deriveMainRpStyleLengthAdminEvidence({
    adminUserId: Number(input.rows.user.id),
    personaId: Number(input.rows.persona.id),
    personaName: String(input.rows.persona.name ?? ""),
    characterId: Number(input.rows.character.id),
    characterName: String(input.rows.character.name ?? ""),
    uniqueAdminRenPersona: input.adminVerified === true,
  });
  assertMainRpStyleLengthIdentity({
    characterId: Number(input.rows.character.id),
    characterName: String(input.rows.character.name ?? ""),
    personaName: String(input.rows.persona.name ?? ""),
    personaId: Number(input.rows.persona.id),
    personaGender: String(input.rows.persona.gender ?? ""),
    fixtureKind: input.fixtureKind,
    adminUserId: assembledIdentity.adminUserId,
    adminVerified: assembledIdentity.adminVerified,
    personaCount: assembledIdentity.personaCount,
    models: MAIN_RP_MODEL_IDS,
  });
  const assembled = assemblePrecallFinalWireWithSealedRequests(input.rows);
  if (assembled.sealedRequests.length === 0) {
    assertMainRpStyleLengthIdentity({
      characterId: MAIN_RP_STYLE_LENGTH_TARGET.characterId,
      characterName: MAIN_RP_STYLE_LENGTH_TARGET.characterName,
      personaName: MAIN_RP_STYLE_LENGTH_TARGET.personaName,
      personaId: Number(input.rows.persona.id),
      fixtureKind: input.fixtureKind,
      adminUserId: assembledIdentity.adminUserId,
      adminVerified: assembledIdentity.adminVerified,
      personaCount: assembledIdentity.personaCount,
      finalWireFingerprints: [],
    });
  }
  for (const request of assembled.sealedRequests) {
    if (!MAIN_RP_MODEL_IDS.includes(request.canonicalId as SelectedAI)) {
      assertMainRpStyleLengthIdentity({
        characterId: MAIN_RP_STYLE_LENGTH_TARGET.characterId,
        characterName: MAIN_RP_STYLE_LENGTH_TARGET.characterName,
        personaName: MAIN_RP_STYLE_LENGTH_TARGET.personaName,
        personaId: Number(input.rows.persona.id),
        fixtureKind: input.fixtureKind,
        adminUserId: assembledIdentity.adminUserId,
        adminVerified: assembledIdentity.adminVerified,
        personaCount: assembledIdentity.personaCount,
        models: [request.canonicalId],
      });
    }
    if (selectedAIProvider(request.canonicalId as SelectedAI) !== request.provider) {
      throw new Error("WIRE_PROVIDER_MISMATCH");
    }
  }
  const capturedAt = new Date().toISOString();
  const sealed: MainRpStyleLengthSealedSnapshot = {
    schema: MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA,
    version: input.version,
    capturedAt,
    deployedGitSha: input.deployedGitSha,
    identity: {
      characterId: Number(input.rows.character.id),
      characterName: String(input.rows.character.name ?? ""),
      personaId: Number(input.rows.persona.id),
      personaName: String(input.rows.persona.name ?? ""),
      personaGender: String(input.rows.persona.gender ?? ""),
      adminUserId: Number(input.rows.user.id),
    },
    identityHashes,
    rows: jsonPlain(input.rows),
    listing: input.listing,
    sealedRequests: jsonPlain(assembled.sealedRequests),
    plans: jsonPlain(assembled.report.plans),
  };
  const publicManifest = buildMainRpStyleLengthPublicManifest({
    version: input.version,
    capturedAt,
    deployedGitSha: input.deployedGitSha,
    rows: input.rows,
    identityHashes,
    sealedRequests: assembled.sealedRequests,
    listing: input.listing,
    privateStore: `${MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT}/v${input.version}`,
    personaPublicChars:
      input.personaPublicChars ??
      toPublicPersonaDescription(String(input.rows.persona.description ?? "")).length,
  });
  return { sealed, publicManifest };
}

export function persistMainRpStyleLengthGolden(input: {
  root?: string;
  version: number;
  sealed: MainRpStyleLengthSealedSnapshot;
  publicManifest: MainRpStyleLengthPublicManifest;
}) {
  const store = createMainRpStyleLengthSnapshotStore(input.root);
  return store.createVersion({
    version: input.version,
    sealed: input.sealed,
    publicManifest: input.publicManifest,
  });
}

function goldenSnapshotIdentity(manifest: MainRpStyleLengthPublicManifest, sealed: MainRpStyleLengthSealedSnapshot) {
  return deriveMainRpStyleLengthAdminEvidence({
    adminUserId:
      Number(manifest.adminUserId) === Number(sealed.identity.adminUserId)
        ? Number(sealed.identity.adminUserId)
        : 0,
    personaId: sealed.identity.personaId,
    personaName: sealed.identity.personaName,
    characterId: sealed.identity.characterId,
    characterName: sealed.identity.characterName,
    uniqueAdminRenPersona:
      manifest.uniqueAdminRenPersona === true &&
      Number(manifest.personaId) === Number(sealed.identity.personaId),
  });
}

function livePrecallIdentity(live: ReturnType<typeof loadPrecallProductionRows>) {
  return deriveMainRpStyleLengthAdminEvidence({
    adminUserId: Number(live.rows.user.id),
    personaId: Number(live.proof.personaId),
    personaName: live.proof.personaName,
    characterId: live.proof.characterId,
    characterName: live.proof.characterName,
    uniqueAdminRenPersona:
      Number(live.rows.user.id) > 0 &&
      Number(live.proof.personaId) > 0 &&
      String(live.proof.personaName ?? "").trim() === MAIN_RP_STYLE_LENGTH_TARGET.personaName,
  });
}

export function reloadMainRpStyleLengthGolden(input: { root?: string; version: number }) {
  const store = createMainRpStyleLengthSnapshotStore(input.root);
  const loaded = store.loadVersion(input.version);
  const sealed = loaded.sealed as MainRpStyleLengthSealedSnapshot;
  const identity = goldenSnapshotIdentity(loaded.publicManifest, sealed);
  assertMainRpStyleLengthIdentity({
    characterId: sealed.identity.characterId,
    characterName: sealed.identity.characterName,
    personaName: sealed.identity.personaName,
    personaId: sealed.identity.personaId,
    personaGender: sealed.identity.personaGender,
    fixtureKind: "GOLDEN_SNAPSHOT",
    adminUserId: identity.adminUserId,
    adminVerified: identity.adminVerified,
    personaCount: identity.personaCount,
    expectedPersonaId: loaded.publicManifest.personaId,
    models: sealed.sealedRequests.map((request) => request.canonicalId),
    finalWireFingerprints: sealed.sealedRequests.map((request) => request.finalWireFingerprint),
  });
  assertMainRpStyleLengthHashes({
    expected: loaded.publicManifest.identityHashes,
    actual: sealed.identityHashes,
  });
  return loaded;
}

export function createLiveMainRpStyleLengthGolden(input: {
  dbPath: string;
  deployedGitSha: string;
  env: Readonly<Record<string, string | undefined>>;
  version: number;
  root?: string;
  listing: GoldenListingMeta;
}) {
  const loaded = loadPrecallProductionRows({
    dbPath: input.dbPath,
    deployedGitSha: input.deployedGitSha,
    env: input.env,
  });
  const liveIdentity = livePrecallIdentity(loaded);
  assertMainRpStyleLengthIdentity({
    characterId: loaded.proof.characterId,
    characterName: loaded.proof.characterName,
    personaName: loaded.proof.personaName,
    personaId: loaded.proof.personaId,
    personaGender: loaded.proof.personaGender,
    fixtureKind: "CURRENT_LIVE",
    adminUserId: liveIdentity.adminUserId,
    adminVerified: liveIdentity.adminVerified,
    personaCount: liveIdentity.personaCount,
    models: MAIN_RP_MODEL_IDS,
  });
  const assembled = assembleMainRpStyleLengthSnapshot({
    rows: loaded.rows,
    deployedGitSha: input.deployedGitSha,
    version: input.version,
    listing: input.listing,
    personaPublicChars: loaded.proof.personaPublicChars,
    fixtureKind: "CURRENT_LIVE",
    adminVerified: liveIdentity.adminVerified,
  });
  assembled.publicManifest.privateStore = `${input.root ?? MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT}/v${input.version}`;
  const persisted = persistMainRpStyleLengthGolden({
    root: input.root,
    version: input.version,
    sealed: assembled.sealed,
    publicManifest: assembled.publicManifest,
  });
  return {
    proof: loaded.proof,
    publicManifest: persisted.publicManifest,
    sealedSha256: persisted.sealedSha256,
    providerPosts: 0,
    dbWrites: 0,
  };
}

export function compareCurrentLiveToGolden(input: {
  dbPath: string;
  deployedGitSha: string;
  env: Readonly<Record<string, string | undefined>>;
  version: number;
  root?: string;
}) {
  const golden = reloadMainRpStyleLengthGolden({ root: input.root, version: input.version });
  const live = loadPrecallProductionRows({
    dbPath: input.dbPath,
    deployedGitSha: input.deployedGitSha,
    env: input.env,
  });
  const assembled = assemblePrecallFinalWireWithSealedRequests(live.rows);
  return compareLiveToGolden({
    snapshotVersion: input.version,
    goldenDeploySha: golden.publicManifest.deployedGitSha,
    liveDeploySha: input.deployedGitSha,
    goldenHashes: golden.publicManifest.identityHashes,
    liveHashes: identityHashesFromRows(live.rows),
    goldenFinalWires: golden.publicManifest.calls.map((call) => call.finalWireFingerprint),
    liveFinalWires: assembled.sealedRequests.map((request) => request.finalWireFingerprint),
  });
}

const RAILWAY_PRODUCTION_DB_PATH = "/data/app.db";

export type OwnedFingerprintParity =
  | "MATCH"
  | "MISMATCH"
  | "STALE_PRODUCTION_SNAPSHOT"
  | "NOT_COMPARABLE";

export type OwnedProductionRequestParity = {
  productionRequestParity: OwnedFingerprintParity;
  fixtureFingerprintParity: OwnedFingerprintParity;
  providerSemanticParity: "NOT_IN_SCOPE";
  qualityScoreEligible: false;
  reasons: readonly string[];
  railwayProductionDb: boolean;
  runtimeDeployShaObserved: boolean;
};

function observedRuntimeDeploySha(
  env: Readonly<Record<string, string | undefined>>
): string {
  const sha = readRailwayDeploymentSha(env as NodeJS.ProcessEnv);
  return /^[0-9a-f]{40}$/.test(sha) ? sha : "";
}

/**
 * Reloads the sealed golden and the given DB itself. Caller hashes are not
 * evidence. Operational MATCH requires Railway `/data/app.db` plus an observed
 * 40-hex `RAILWAY_GIT_COMMIT_SHA` that equals both the caller SHA and the
 * golden SHA. A temp-DB fingerprint hit is fixture diagnostic only.
 */
export function evaluateOwnedProductionRequestParity(input: {
  dbPath: string;
  deployedGitSha: string;
  env: Readonly<Record<string, string | undefined>>;
  version: number;
  root?: string;
}): OwnedProductionRequestParity {
  const golden = reloadMainRpStyleLengthGolden({ root: input.root, version: input.version });
  const live = loadPrecallProductionRows({
    dbPath: input.dbPath,
    deployedGitSha: input.deployedGitSha,
    env: input.env,
  });
  const assembled = assemblePrecallFinalWireWithSealedRequests(live.rows);
  const reasons: string[] = [];
  const goldenSha = golden.publicManifest.deployedGitSha.trim().toLowerCase();
  const callerSha = input.deployedGitSha.trim().toLowerCase();
  const runtimeSha = observedRuntimeDeploySha(input.env);
  const runtimeDeployShaObserved = runtimeSha.length === 40;
  const railwayProductionDb = input.dbPath === RAILWAY_PRODUCTION_DB_PATH;
  if (!railwayProductionDb) reasons.push("db_path_is_not_railway_production");
  if (!runtimeDeployShaObserved) reasons.push("runtime_deploy_sha_unobserved");
  else if (runtimeSha !== callerSha) reasons.push("caller_deploy_sha_does_not_match_runtime");
  if (goldenSha !== callerSha || (runtimeDeployShaObserved && runtimeSha !== goldenSha)) {
    reasons.push("stale_production_snapshot");
  }
  const goldenByKey = new Map(
    golden.publicManifest.calls.map((call) => [`${call.fixtureId}:${call.canonicalId}`, call])
  );
  let fingerprintMismatch = golden.publicManifest.calls.length !== assembled.sealedRequests.length;
  for (const request of assembled.sealedRequests) {
    const expected = goldenByKey.get(`${request.fixtureId}:${request.canonicalId}`);
    if (
      !expected ||
      expected.finalWireFingerprint !== request.finalWireFingerprint ||
      expected.requestBodyFingerprint !== request.requestBodyFingerprint
    ) {
      fingerprintMismatch = true;
    }
  }
  if (fingerprintMismatch) reasons.push("final_wire_or_body_fingerprint_mismatch");
  const fixtureFingerprintParity: OwnedFingerprintParity =
    goldenSha !== callerSha
      ? "STALE_PRODUCTION_SNAPSHOT"
      : fingerprintMismatch
        ? "MISMATCH"
        : "MATCH";
  let productionRequestParity: OwnedFingerprintParity = "NOT_COMPARABLE";
  if (railwayProductionDb && runtimeDeployShaObserved && runtimeSha === callerSha) {
    if (runtimeSha !== goldenSha) productionRequestParity = "STALE_PRODUCTION_SNAPSHOT";
    else if (fingerprintMismatch) productionRequestParity = "MISMATCH";
    else productionRequestParity = "MATCH";
  }
  reasons.push("provider_semantic_parity_not_evaluated");
  reasons.push("quality_score_requires_separate_gate");
  return {
    productionRequestParity,
    fixtureFingerprintParity,
    providerSemanticParity: "NOT_IN_SCOPE",
    qualityScoreEligible: false,
    reasons,
    railwayProductionDb,
    runtimeDeployShaObserved,
  };
}

export function paidSealedCallsFromGoldenSnapshot(
  sealed: MainRpStyleLengthSealedSnapshot
): PaidRunnerSealedCall[] {
  if (sealed.sealedRequests.length === 0) {
    throw new MainRpStyleLengthFixtureError("FINAL_WIRE_MISSING");
  }
  return sealed.sealedRequests.map((request, index) => {
    const plan = sealed.plans[index];
    if (!plan) throw new MainRpStyleLengthFixtureError("FINAL_WIRE_MISSING");
    if (!request.requestBody || typeof request.requestBody !== "object") {
      throw new MainRpStyleLengthFixtureError("FINAL_WIRE_MISSING");
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
}

export function prepareMainRpStyleLengthEvaluation(input: {
  mode: MainRpStyleLengthMode;
  version: number;
  root?: string;
  dbPath?: string;
  deployedGitSha?: string;
  env?: Readonly<Record<string, string | undefined>>;
  verifyPinnedPublicV1?: boolean;
}): {
  mode: MainRpStyleLengthMode;
  sealedSha256: string;
  publicManifest: MainRpStyleLengthPublicManifest;
  sealedCalls: PaidRunnerSealedCall[];
  paidManifest: ReturnType<typeof buildPaidRunnerPublicManifest>;
  seal: ReturnType<typeof verifyPaidRunnerDispatchSeal>;
  compare: ReturnType<typeof compareLiveToGolden> | null;
  fingerprintsMatchPinnedV1: boolean;
} {
  const loaded = reloadMainRpStyleLengthGolden({ root: input.root, version: input.version });
  const sealed = loaded.sealed as MainRpStyleLengthSealedSnapshot;
  if (input.verifyPinnedPublicV1 && input.version === MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.snapshotVersion) {
    if (loaded.sealedSha256 !== MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.sealedSha256) {
      throw new MainRpStyleLengthFixtureError("SNAPSHOT_TAMPERED");
    }
    if (sealed.identity.personaId !== MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.personaId) {
      throw new MainRpStyleLengthFixtureError("FIXTURE_IDENTITY_MISMATCH");
    }
  }
  const live =
    input.mode === "CURRENT_LIVE"
      ? (() => {
          if (!input.dbPath || !input.deployedGitSha) {
            throw new MainRpStyleLengthFixtureError("SOURCE_DRIFT");
          }
          return loadPrecallProductionRows({
            dbPath: input.dbPath,
            deployedGitSha: input.deployedGitSha,
            env: input.env ?? {},
          });
        })()
      : null;
  const sealedCalls =
    input.mode === "GOLDEN_SNAPSHOT"
      ? paidSealedCallsFromGoldenSnapshot(sealed)
      : preparePaidRunnerPack({
          rows: live!.rows,
          mainSha: input.deployedGitSha ?? sealed.deployedGitSha,
          productionDeploySha: input.deployedGitSha ?? sealed.deployedGitSha,
        }).sealedCalls;
  const identity =
    input.mode === "GOLDEN_SNAPSHOT"
      ? goldenSnapshotIdentity(loaded.publicManifest, sealed)
      : livePrecallIdentity(live!);
  const evaluationIdentity =
    input.mode === "GOLDEN_SNAPSHOT"
      ? sealed.identity
      : {
          characterId: live!.proof.characterId,
          characterName: live!.proof.characterName,
          personaName: live!.proof.personaName,
          personaId: live!.proof.personaId,
          personaGender: live!.proof.personaGender,
        };
  assertMainRpStyleLengthEvaluationReady({
    characterId: evaluationIdentity.characterId,
    characterName: evaluationIdentity.characterName,
    personaName: evaluationIdentity.personaName,
    personaId: evaluationIdentity.personaId,
    personaGender: evaluationIdentity.personaGender,
    fixtureKind: input.mode,
    adminUserId: identity.adminUserId,
    adminVerified: identity.adminVerified,
    personaCount: identity.personaCount,
    expectedPersonaId:
      input.mode === "GOLDEN_SNAPSHOT"
        ? loaded.publicManifest.personaId
        : MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.personaId,
    models: sealedCalls.map((call) => call.canonicalId),
    finalWireFingerprints: sealedCalls.map((call) => call.finalWireFingerprint),
    requestBodies: sealedCalls.map((call) => call.requestBody),
  });
  const paidManifest = buildPaidRunnerPublicManifest({
    mainSha: sealed.deployedGitSha,
    productionDeploySha: sealed.deployedGitSha,
    identityHashes: loaded.publicManifest.identityHashes,
    sealedCalls,
  });
  const seal = verifyPaidRunnerDispatchSeal({
    manifest: paidManifest,
    sealedCalls,
  });
  if (!seal.ok) throw new MainRpStyleLengthFixtureError("FINAL_WIRE_MISSING");
  const compare =
    input.mode === "CURRENT_LIVE" && input.dbPath && input.deployedGitSha
      ? compareCurrentLiveToGolden({
          dbPath: input.dbPath,
          deployedGitSha: input.deployedGitSha,
          env: input.env ?? {},
          version: input.version,
          root: input.root,
        })
      : null;
  if (compare?.sourceDrift) throw new MainRpStyleLengthFixtureError("SOURCE_DRIFT");
  const pinned = MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC;
  const fingerprintsMatchPinnedV1 =
    input.version === pinned.snapshotVersion &&
    loaded.publicManifest.calls.every((call, index) => {
      const sealedCall = sealedCalls[index];
      return (
        sealedCall != null &&
        call.finalWireFingerprint === sealedCall.finalWireFingerprint &&
        call.requestBodyFingerprint === sealedCall.requestBodyFingerprint
      );
    });
  if (input.verifyPinnedPublicV1 && !fingerprintsMatchPinnedV1) {
    throw new MainRpStyleLengthFixtureError("SOURCE_HASH_MISMATCH");
  }
  return {
    mode: input.mode,
    sealedSha256: loaded.sealedSha256,
    publicManifest: loaded.publicManifest,
    sealedCalls,
    paidManifest,
    seal,
    compare,
    fingerprintsMatchPinnedV1,
  };
}

export async function dryRunMainRpStyleLengthEvaluation(
  input: Parameters<typeof prepareMainRpStyleLengthEvaluation>[0]
) {
  const prepared = prepareMainRpStyleLengthEvaluation(input);
  const result = await runPaidRunner({
    mode: "AUTHORIZED",
    manifest: prepared.paidManifest,
    sealedCalls: prepared.sealedCalls,
    authorization: {
      userCostApproved: true,
      approvedManifestFingerprint: prepared.paidManifest.manifestFingerprint,
      expectedProductionSha: prepared.paidManifest.productionDeploySha,
      expectedIdentityHash: prepared.paidManifest.identityHash,
      experimentSecret: "rpq-paid-style-length-dryrun-0000001",
      allowlist: [...MAIN_RP_MODEL_IDS],
      plannedCalls: prepared.sealedCalls.length,
    },
    transport: createMockPaidRunnerTransport(),
  });
  return {
    ...prepared,
    providerPosts: result.providerPosts,
    transportPosts: result.transportPosts,
    networkAttempts: result.networkAttempts,
    dbWrites: result.dbWrites,
    authorized: result.authorized,
    requestBodiesPresent: prepared.sealedCalls.every(
      (call) => call.requestBody && Object.keys(call.requestBody).length > 0
    ),
    qualityScores: null as const,
  };
}

export function publicGoldenStdout(input: {
  action: "create" | "reload" | "current-live" | "evaluate";
  publicManifest?: MainRpStyleLengthPublicManifest;
  sealedSha256?: string;
  compare?: ReturnType<typeof compareCurrentLiveToGolden> | null;
  providerPosts?: number;
  dbWrites?: number;
  evaluation?: {
    mode: MainRpStyleLengthMode;
    sealOk: boolean;
    requestBodiesPresent: boolean;
    fingerprintsMatchPinnedV1: boolean;
    transportPosts: number;
    networkAttempts: number;
  };
}): string {
  return `${JSON.stringify(
    {
      evaluation: MAIN_RP_STYLE_LENGTH_EVALUATION,
      action: input.action,
      publicManifest: input.publicManifest ?? null,
      sealedSha256: input.sealedSha256 ?? null,
      compare: input.compare ?? null,
      evaluationDryRun: input.evaluation ?? null,
      providerPosts: input.providerPosts ?? 0,
      dbWrites: input.dbWrites ?? 0,
      qualityScores: null,
    },
    null,
    2
  )}\n`;
}

export function sealedSnapshotFingerprint(sealed: unknown): string {
  return sha256Text(`${JSON.stringify(sealed)}\n`);
}
