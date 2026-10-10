/**
 * Operator-only MAIN_RP_STYLE_LENGTH golden create/reload.
 * Reuses PRECALL row load + final-wire assembly. Raw sealed bytes stay in-process
 * or under the private snapshot root. Public stdout is hash-only.
 */
import { createHash } from "node:crypto";

import { MAIN_RP_MODEL_IDS, selectedAIProvider, type SelectedAI } from "@/lib/chatModels";
import { toPublicPersonaDescription } from "@/lib/personaSecretLegacyMarkers";
import { paidRunnerIdentityHash, type PaidRunnerIdentityHashes } from "@/lib/rpQualityPaidRunner";
import {
  MAIN_RP_STYLE_LENGTH_EVALUATION,
  MAIN_RP_STYLE_LENGTH_PRIVATE_ROOT,
  MAIN_RP_STYLE_LENGTH_SNAPSHOT_SCHEMA,
  MAIN_RP_STYLE_LENGTH_TARGET,
  assertMainRpStyleLengthHashes,
  assertMainRpStyleLengthIdentity,
  compareLiveToGolden,
  mainRpStyleLengthSitePolicy,
  type MainRpStyleLengthPublicCall,
  type MainRpStyleLengthPublicManifest,
} from "@/lib/rpMainRpStyleLengthFixture";
import { createMainRpStyleLengthSnapshotStore } from "@/lib/rpMainRpStyleLengthSnapshotStore";
import { RP_QUALITY_PRECALL_FIXTURE_IDS } from "@/lib/rpQualityPrecall";
import { identityHashesFromRows } from "./rpQualityPaidRunnerPrepare";
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
  assertMainRpStyleLengthIdentity({
    characterId: Number(input.rows.character.id),
    characterName: String(input.rows.character.name ?? ""),
    personaName: String(input.rows.persona.name ?? ""),
    personaId: Number(input.rows.persona.id),
    personaGender: String(input.rows.persona.gender ?? ""),
    fixtureKind: input.fixtureKind,
    adminVerified: input.adminVerified ?? true,
    personaCount: 1,
    models: MAIN_RP_MODEL_IDS,
  });
  const assembled = assemblePrecallFinalWireWithSealedRequests(input.rows);
  if (assembled.sealedRequests.length === 0) {
    assertMainRpStyleLengthIdentity({
      characterId: MAIN_RP_STYLE_LENGTH_TARGET.characterId,
      characterName: MAIN_RP_STYLE_LENGTH_TARGET.characterName,
      personaName: MAIN_RP_STYLE_LENGTH_TARGET.personaName,
      fixtureKind: input.fixtureKind,
      finalWireFingerprints: [],
    });
  }
  for (const request of assembled.sealedRequests) {
    if (!MAIN_RP_MODEL_IDS.includes(request.canonicalId as SelectedAI)) {
      assertMainRpStyleLengthIdentity({
        characterId: MAIN_RP_STYLE_LENGTH_TARGET.characterId,
        characterName: MAIN_RP_STYLE_LENGTH_TARGET.characterName,
        personaName: MAIN_RP_STYLE_LENGTH_TARGET.personaName,
        fixtureKind: input.fixtureKind,
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

export function reloadMainRpStyleLengthGolden(input: { root?: string; version: number }) {
  const store = createMainRpStyleLengthSnapshotStore(input.root);
  const loaded = store.loadVersion(input.version);
  const sealed = loaded.sealed as MainRpStyleLengthSealedSnapshot;
  assertMainRpStyleLengthIdentity({
    characterId: sealed.identity.characterId,
    characterName: sealed.identity.characterName,
    personaName: sealed.identity.personaName,
    personaId: sealed.identity.personaId,
    personaGender: sealed.identity.personaGender,
    fixtureKind: "GOLDEN_SNAPSHOT",
    adminVerified: true,
    personaCount: 1,
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
  assertMainRpStyleLengthIdentity({
    characterId: loaded.proof.characterId,
    characterName: loaded.proof.characterName,
    personaName: loaded.proof.personaName,
    personaId: loaded.proof.personaId,
    personaGender: loaded.proof.personaGender,
    fixtureKind: "CURRENT_LIVE",
    adminVerified: true,
    personaCount: 1,
    models: MAIN_RP_MODEL_IDS,
  });
  const assembled = assembleMainRpStyleLengthSnapshot({
    rows: loaded.rows,
    deployedGitSha: input.deployedGitSha,
    version: input.version,
    listing: input.listing,
    personaPublicChars: loaded.proof.personaPublicChars,
    fixtureKind: "CURRENT_LIVE",
    adminVerified: true,
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

export function publicGoldenStdout(input: {
  action: "create" | "reload" | "current-live";
  publicManifest?: MainRpStyleLengthPublicManifest;
  sealedSha256?: string;
  compare?: ReturnType<typeof compareCurrentLiveToGolden>;
  providerPosts?: number;
  dbWrites?: number;
}): string {
  return `${JSON.stringify(
    {
      evaluation: MAIN_RP_STYLE_LENGTH_EVALUATION,
      action: input.action,
      publicManifest: input.publicManifest ?? null,
      sealedSha256: input.sealedSha256 ?? null,
      compare: input.compare ?? null,
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
