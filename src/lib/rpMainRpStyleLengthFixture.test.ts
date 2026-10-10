import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { UNIFIED_TIER_AIM_CHARS } from "@/lib/responseLengthConstants";
import {
  RP_QUALITY_PRECALL_TARGET_SELECTOR,
  type RpQualityPrecallLiveProofInput,
} from "@/lib/rpQualityPrecall";
import {
  HISTORICAL_RP_QUALIFICATION_CHARACTER_ID,
  MAIN_RP_STYLE_LENGTH_EVALUATION,
  MAIN_RP_STYLE_LENGTH_TARGET,
  MainRpStyleLengthFixtureError,
  MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC,
  PRODUCTION_PARITY_QUALITY_SCORE_RULE,
  assertMainRpStyleLengthEvaluationReady,
  assertMainRpStyleLengthHashes,
  assertMainRpStyleLengthIdentity,
  classifyMainRpProductionParity,
  compareLiveToGolden,
  deriveMainRpStyleLengthAdminEvidence,
  goldenV1StaleAgainstCurrentSuccess,
  isMainRpStyleLengthEvaluationRequested,
  mainRpStyleLengthSitePolicy,
  type ProductionParityInput,
} from "@/lib/rpMainRpStyleLengthFixture";

const LIVE = {
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  personaId: 1,
  personaGender: "male",
  fixtureKind: "CURRENT_LIVE" as const,
  adminUserId: 1,
  adminVerified: true,
  personaCount: 1,
  models: MAIN_RP_MODEL_IDS,
  finalWireFingerprints: ["a".repeat(64)],
};

const HASHES = {
  greetingSha256: "1".repeat(64),
  systemPromptSha256: "2".repeat(64),
  worldSha256: "3".repeat(64),
  settingChunksSha256: "4".repeat(64),
  personaPublicSha256: "5".repeat(64),
};

describe("MAIN_RP_STYLE_LENGTH fixture owner", () => {
  it("reuses the PRECALL selector and deployed NORMAL co-author policy", () => {
    assert.equal(MAIN_RP_STYLE_LENGTH_EVALUATION, "MAIN_RP_STYLE_LENGTH");
    assert.deepEqual(MAIN_RP_STYLE_LENGTH_TARGET, RP_QUALITY_PRECALL_TARGET_SELECTOR);
    const policy = mainRpStyleLengthSitePolicy();
    assert.equal(policy.authoringLevel, "NORMAL");
    assert.deepEqual(policy.userCoauthor, {
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: false,
      allowIrreversibleFate: false,
    });
    assert.equal(policy.contentMode, "SAFE");
    assert.equal(policy.artificialMaxOutputChars, null);
    assert.equal(policy.softAimChars, UNIFIED_TIER_AIM_CHARS);
    assert.equal(policy.targetLengthOwner, "UNIFIED_TIER_AIM_CHARS");
    assert.deepEqual(policy.models, MAIN_RP_MODEL_IDS);
  });

  it("accepts live 라이크 18 / 렌", () => {
    assert.doesNotThrow(() => assertMainRpStyleLengthIdentity(LIVE));
    assert.doesNotThrow(() =>
      assertMainRpStyleLengthEvaluationReady({
        ...LIVE,
        requestBodies: [{ model: "deepseek-v4.1-flash", messages: [{ role: "user", content: "x" }] }],
      })
    );
  });

  it("rejects historical id=10 and HISTORICAL_ONLY", () => {
    assert.throws(
      () =>
        assertMainRpStyleLengthIdentity({
          ...LIVE,
          characterId: HISTORICAL_RP_QUALIFICATION_CHARACTER_ID,
          characterName: "라이크",
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "HISTORICAL_ID10_REJECTED"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, fixtureKind: "HISTORICAL_ONLY" }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "HISTORICAL_ID10_REJECTED"
    );
  });

  it("rejects missing adminVerified, personaCount, personaId, and final-wire evidence", () => {
    const { adminVerified: _admin, ...noAdmin } = LIVE;
    const { adminUserId: _adminUser, ...noAdminUser } = LIVE;
    const { personaCount: _count, ...noCount } = LIVE;
    const { personaId: _id, ...noId } = LIVE;
    const { finalWireFingerprints: _fp, ...noFp } = LIVE;
    assert.throws(
      () => assertMainRpStyleLengthIdentity(noAdmin),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "ADMIN_UNVERIFIED"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity(noAdminUser),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "ADMIN_UNVERIFIED"
    );
    assert.throws(
      () =>
        assertMainRpStyleLengthIdentity({
          ...LIVE,
          adminVerified: 1 as unknown as boolean,
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "ADMIN_UNVERIFIED"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity(noCount),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "PERSONA_MISSING"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity(noId),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "PERSONA_MISSING"
    );
    assert.throws(
      () => assertMainRpStyleLengthEvaluationReady({ ...noFp, requestBodies: [{ model: "x" }] }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FINAL_WIRE_MISSING"
    );
    assert.throws(
      () =>
        assertMainRpStyleLengthEvaluationReady({
          ...LIVE,
          requestBodies: [],
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FINAL_WIRE_MISSING"
    );
    assert.throws(
      () => assertMainRpStyleLengthEvaluationReady({ ...LIVE }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FINAL_WIRE_MISSING"
    );
    assert.throws(
      () =>
        assertMainRpStyleLengthEvaluationReady({
          ...LIVE,
          requestBodies: [{}],
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FINAL_WIRE_MISSING"
    );
    assert.throws(
      () =>
        assertMainRpStyleLengthEvaluationReady({
          ...LIVE,
          requestBodies: [null],
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FINAL_WIRE_MISSING"
    );
    assert.throws(
      () =>
        assertMainRpStyleLengthIdentity({
          ...LIVE,
          expectedPersonaId: MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.personaId,
          personaId: 99,
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FIXTURE_IDENTITY_MISMATCH"
    );
  });

  it("rejects synthetic, wrong persona, unverified admin, and missing/duplicate persona", () => {
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, fixtureKind: "TEST_ONLY_SYNTHETIC" }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "SYNTHETIC_REJECTED"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, characterName: "에녹" }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FIXTURE_IDENTITY_MISMATCH"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, personaName: "다른사람" }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "PERSONA_NOT_REN"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, adminVerified: false }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "ADMIN_UNVERIFIED"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, personaCount: 0 }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "PERSONA_MISSING"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, personaCount: 2 }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "PERSONA_AMBIGUOUS"
    );
  });

  it("rejects inactive models, missing final-wire, and hash drift", () => {
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, models: ["retired-gemini"] }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "INACTIVE_MODEL"
    );
    assert.throws(
      () => assertMainRpStyleLengthIdentity({ ...LIVE, finalWireFingerprints: [] }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "FINAL_WIRE_MISSING"
    );
    assert.throws(
      () =>
        assertMainRpStyleLengthHashes({
          expected: HASHES,
          actual: { ...HASHES, greetingSha256: "9".repeat(64) },
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "SOURCE_HASH_MISMATCH"
    );
  });

  it("reports SOURCE_DRIFT without overwriting a golden version", () => {
    const same = compareLiveToGolden({
      snapshotVersion: 1,
      goldenDeploySha: "a".repeat(40),
      liveDeploySha: "b".repeat(40),
      goldenHashes: HASHES,
      liveHashes: HASHES,
      goldenFinalWires: ["f".repeat(64)],
      liveFinalWires: ["f".repeat(64)],
    });
    assert.equal(same.sourceDrift, false);
    assert.equal(same.deployShaChanged, true);
    const drifted = compareLiveToGolden({
      snapshotVersion: 1,
      goldenDeploySha: "a".repeat(40),
      liveDeploySha: "a".repeat(40),
      goldenHashes: HASHES,
      liveHashes: { ...HASHES, personaPublicSha256: "8".repeat(64) },
      goldenFinalWires: ["f".repeat(64)],
      liveFinalWires: ["e".repeat(64)],
    });
    assert.equal(drifted.sourceDrift, true);
    assert.deepEqual(drifted.driftedFields, ["personaPublicSha256", "finalWireFingerprints"]);
  });

  it("only treats explicit MAIN_RP_STYLE_LENGTH env as the current evaluation", () => {
    assert.equal(isMainRpStyleLengthEvaluationRequested({}), false);
    assert.equal(isMainRpStyleLengthEvaluationRequested({ MAIN_RP_STYLE_LENGTH: "1" }), true);
  });

  it("does not fill adminVerified or personaCount from undefined uniqueness", () => {
    const missing = deriveMainRpStyleLengthAdminEvidence({
      adminUserId: 1,
      personaId: 1,
      personaName: "렌",
      characterId: 18,
      characterName: "라이크",
    });
    assert.equal(missing.adminVerified, false);
    assert.equal(missing.personaCount, 0);
    const numeric = deriveMainRpStyleLengthAdminEvidence({
      adminUserId: 1,
      personaId: 1,
      personaName: "렌",
      characterId: 18,
      characterName: "라이크",
      uniqueAdminRenPersona: 1 as unknown as boolean,
    });
    assert.equal(numeric.adminVerified, false);
    assert.equal(numeric.personaCount, 0);
    const ok = deriveMainRpStyleLengthAdminEvidence({
      adminUserId: 1,
      personaId: 1,
      personaName: "렌",
      characterId: 18,
      characterName: "라이크",
      uniqueAdminRenPersona: true,
    });
    assert.equal(ok.adminVerified, true);
    assert.equal(ok.personaCount, 1);
  });

  it("keeps the public v1 manifest hash-only", () => {
    const raw = readFileSync(
      path.join(process.cwd(), "docs/audits/main-rp-laike-ren-golden/v1.public.json"),
      "utf8"
    );
    const parsed = JSON.parse(raw) as {
      manifest: {
        characterId: number;
        personaId: number;
        personaName: string;
        sealedRequestCount: number;
        qualityScores: null;
      };
      create: { sealedSha256: string; providerPosts: number; dbWrites: number };
      reload: { sealedSha256: string; identicalToCreate: boolean };
      currentLive: { sourceDrift: boolean };
    };
    assert.equal(parsed.manifest.characterId, 18);
    assert.equal(parsed.manifest.personaId, 1);
    assert.equal(parsed.manifest.personaName, "렌");
    assert.equal(parsed.manifest.sealedRequestCount, 12);
    assert.equal(parsed.manifest.qualityScores, null);
    assert.equal(parsed.create.sealedSha256, parsed.reload.sealedSha256);
    assert.equal(parsed.reload.identicalToCreate, true);
    assert.equal(parsed.currentLive.sourceDrift, false);
    assert.equal(parsed.create.providerPosts, 0);
    assert.equal(parsed.create.dbWrites, 0);
    assert.doesNotMatch(raw, /조태형|신입 S급|기계사용|secret_description|Authorization|Bearer /);
  });
});

const LIVE_SHA = "aa".repeat(20);
const HASH = "ab".repeat(32);
const GOLDEN_SHA = MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.deployedGitSha;
const GOLDEN_HASHES = MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.identityHashes;

function selfDeclaredParityInput(
  overrides: Partial<ProductionParityInput> = {}
): ProductionParityInput {
  return {
    evidenceKind: "CURRENT_LIVE",
    currentProductionSuccessSha: LIVE_SHA,
    assemblySourceSha: LIVE_SHA,
    capturedDeploySha: LIVE_SHA,
    currentLiveVerified: true,
    characterId: 18,
    characterName: "라이크",
    personaId: 1,
    personaName: "렌",
    fixtureId: "A_relationship_emotion",
    fixtureIds: ["A_relationship_emotion"],
    authoringLevel: "NORMAL",
    contentMode: "SAFE",
    softAimChars: UNIFIED_TIER_AIM_CHARS,
    maxTokensPresent: false,
    maxCompletionTokensPresent: false,
    identityHashes: HASHES,
    expectedIdentityHashes: HASHES,
    finalWireFingerprint: HASH,
    expectedFinalWireFingerprint: HASH,
    requestBodyFingerprint: HASH,
    expectedRequestBodyFingerprint: HASH,
    thinkingSemanticEquivalent: true,
    reasoningSemanticEquivalent: true,
    featureFlagsMatch: true,
    flattenedLosingMeaning: false,
    recoveryPath: "assemblePrimaryRpRequest",
    expectedRecoveryPath: "assemblePrimaryRpRequest",
    sampling: { temperature: 0.92, top_p: 0.92 },
    expectedSampling: { temperature: 0.92, top_p: 0.92 },
    ...overrides,
  };
}

function independentLiveProof(
  overrides: Partial<RpQualityPrecallLiveProofInput> = {}
): RpQualityPrecallLiveProofInput {
  return {
    source: "railway-readonly-in-process-hash-probe",
    generatedAt: "2026-10-10T05:43:19.680Z",
    deployedGitSha: GOLDEN_SHA,
    characterId: 18,
    characterName: "라이크",
    personaName: "렌",
    personaId: 1,
    authoringLevel: "NORMAL",
    contentMode: "SAFE",
    ...GOLDEN_HASHES,
    ...overrides,
  };
}

function independentAssembledBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "deepseek-v4.1-flash",
    messages: [
      { role: "system", content: "common-style" },
      { role: "user", content: "[채팅 시작]" },
    ],
    temperature: 0.92,
    top_p: 0.92,
    stream: true,
    thinking: { type: "disabled" },
    reasoning_effort: "none",
    ...overrides,
  };
}

function independentStyleSections() {
  return [
    { sectionId: "openrouter-korean-prose-top", sha256: "aa".repeat(8) },
    { sectionId: "prose-style-xml-bundle", sha256: "bb".repeat(8) },
    { sectionId: "deepseek-thinking-off", sha256: "cc".repeat(8) },
  ];
}

function independentParityInput(
  overrides: Partial<ProductionParityInput> = {}
): ProductionParityInput {
  const assembledRequestBody = independentAssembledBody();
  const expectedSealedRequestBody = independentAssembledBody();
  const observedStyleSections = independentStyleSections();
  const expectedStyleSections = independentStyleSections();
  const observedRuntimeFlags = { contentMode: "SAFE", authoringLevel: "NORMAL" };
  const expectedRuntimeFlags = { contentMode: "SAFE", authoringLevel: "NORMAL" };
  return {
    evidenceKind: "CURRENT_LIVE",
    observedProvenance: { kind: "in_process_assembly", sourceId: "in-process-assembly-run" },
    expectedProvenance: { kind: "railway_live_proof", sourceId: "railway-live-expected" },
    liveProofInput: independentLiveProof(),
    expectedIdentityHashes: { ...GOLDEN_HASHES },
    assembledRequestBody,
    expectedSealedRequestBody,
    observedStyleSections,
    expectedStyleSections,
    observedRuntimeFlags,
    expectedRuntimeFlags,
    precallReady: true,
    currentProductionSuccessSha: GOLDEN_SHA,
    assemblySourceSha: GOLDEN_SHA,
    capturedDeploySha: GOLDEN_SHA,
    characterId: 18,
    characterName: "라이크",
    personaId: 1,
    personaName: "렌",
    fixtureId: "A_relationship_emotion",
    fixtureIds: ["A_relationship_emotion"],
    recoveryPath: "assemblePrimaryRpRequest",
    expectedRecoveryPath: "assemblePrimaryRpRequest",
    flattenedLosingMeaning: false,
    ...overrides,
  };
}

describe("MAIN_RP_STYLE_LENGTH production parity gate", () => {
  it("keeps PRECALL_READY and paid authorization separate from quality eligibility", () => {
    assert.equal(PRODUCTION_PARITY_QUALITY_SCORE_RULE.requiredStatus, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(PRODUCTION_PARITY_QUALITY_SCORE_RULE.precallReadyIsSeparate, true);
    assert.equal(PRODUCTION_PARITY_QUALITY_SCORE_RULE.paidAuthorizationIsSeparate, true);
    assert.equal(PRODUCTION_PARITY_QUALITY_SCORE_RULE.syntheticCannotPromoteToQualityScore, true);
    assert.equal(PRODUCTION_PARITY_QUALITY_SCORE_RULE.callerAnnotationCannotVerify, true);
    const verified = classifyMainRpProductionParity(independentParityInput());
    assert.equal(verified.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(verified.qualityScoreEligible, true);
    assert.equal(verified.softAimChars, UNIFIED_TIER_AIM_CHARS);
    assert.equal(verified.precallReadyIsSeparate, true);
  });

  it("fail-before: self-supplied equal fake hashes cannot reach VERIFIED", () => {
    const result = classifyMainRpProductionParity(selfDeclaredParityInput());
    assert.notEqual(result.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(result.qualityScoreEligible, false);
    assert.ok(result.reasons.includes("current_live_verified_boolean_ignored"));
    assert.ok(result.reasons.includes("assembled_request_body_missing"));
    assert.ok(
      result.reasons.includes("caller_annotation_cannot_verify") ||
        result.reasons.includes("provenance_missing")
    );
  });

  it("fail-before: omitted required independent evidence cannot verify", () => {
    const result = classifyMainRpProductionParity(
      independentParityInput({
        assembledRequestBody: null,
        expectedSealedRequestBody: null,
        observedStyleSections: null,
        expectedStyleSections: null,
      })
    );
    assert.equal(result.status, "NOT_COMPARABLE");
    assert.equal(result.qualityScoreEligible, false);
    assert.ok(result.reasons.includes("assembled_request_body_missing"));
  });

  it("does not promote synthetic fixtures to quality scores", () => {
    const result = classifyMainRpProductionParity(
      selfDeclaredParityInput({ evidenceKind: "SYNTHETIC", currentLiveVerified: false })
    );
    assert.equal(result.status, "NOT_COMPARABLE");
    assert.equal(result.qualityScoreEligible, false);
    assert.ok(result.reasons.includes("synthetic_not_quality_score"));
  });

  it("fails closed on a missing current-live snapshot", () => {
    const result = classifyMainRpProductionParity({ evidenceKind: "MISSING" });
    assert.equal(result.status, "NOT_COMPARABLE");
    assert.equal(result.qualityScoreEligible, false);
    assert.ok(result.reasons.includes("current_live_evidence_missing"));
  });

  it("fails closed on a different character or persona", () => {
    const result = classifyMainRpProductionParity(
      selfDeclaredParityInput({ characterId: 10, characterName: "에녹", personaName: "다른사람" })
    );
    assert.equal(result.status, "NOT_COMPARABLE");
    assert.ok(result.reasons.includes("identity_not_laike_ren"));
  });

  it("fails closed when 라이크/렌 names match but live persona id is missing", () => {
    const result = classifyMainRpProductionParity(
      selfDeclaredParityInput({ personaId: undefined })
    );
    assert.equal(result.status, "NOT_COMPARABLE");
    assert.ok(result.reasons.includes("persona_id_unconfirmed"));
    assert.equal(result.reasons.includes("identity_not_laike_ren"), false);
  });

  it("fails closed on a non-A/B/C scene", () => {
    const result = classifyMainRpProductionParity(
      selfDeclaredParityInput({ fixtureId: "B03a", fixtureIds: ["B03a"] })
    );
    assert.equal(result.status, "NOT_COMPARABLE");
    assert.ok(result.reasons.includes("fixture_not_abc"));
  });

  it("marks golden v1 stale against a different production SUCCESS SHA", () => {
    assert.equal(
      goldenV1StaleAgainstCurrentSuccess("4d83c100666878cca747408ae72a18f3360310ac"),
      true
    );
    assert.equal(
      goldenV1StaleAgainstCurrentSuccess(MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.deployedGitSha),
      false
    );
    const result = classifyMainRpProductionParity(
      independentParityInput({
        evidenceKind: "GOLDEN_SNAPSHOT",
        expectedProvenance: {
          kind: "golden_public_manifest",
          sourceId: MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC.sourceId,
        },
        currentProductionSuccessSha: "4d83c100666878cca747408ae72a18f3360310ac",
        liveProofInput: independentLiveProof({
          deployedGitSha: "4d83c100666878cca747408ae72a18f3360310ac",
        }),
      })
    );
    assert.equal(result.status, "STALE_PRODUCTION_SNAPSHOT");
    assert.equal(result.qualityScoreEligible, false);
  });

  it("fails closed when common or model style section hashes change", () => {
    const result = classifyMainRpProductionParity(
      independentParityInput({
        expectedStyleSections: [
          { sectionId: "openrouter-korean-prose-top", sha256: "11".repeat(8) },
          { sectionId: "prose-style-xml-bundle", sha256: "22".repeat(8) },
          { sectionId: "deepseek-thinking-off", sha256: "33".repeat(8) },
        ],
      })
    );
    assert.equal(result.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(result.reasons.includes("commonStyleSectionContentHash_mismatch"));
    assert.ok(result.reasons.includes("modelStyleSectionContentHash_mismatch"));
  });

  it("fails closed on authoring, feature-flag, sampling, length, and max_tokens drift", () => {
    const authoring = classifyMainRpProductionParity(
      independentParityInput({
        liveProofInput: independentLiveProof({ authoringLevel: "LIMITED" }),
      })
    );
    assert.equal(authoring.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(authoring.reasons.includes("authoring_policy_mismatch"));

    const flags = classifyMainRpProductionParity(
      independentParityInput({
        expectedRuntimeFlags: { contentMode: "19+", authoringLevel: "NORMAL" },
      })
    );
    assert.equal(flags.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(flags.reasons.includes("feature_flag_or_runtime_mode_mismatch"));

    const sampling = classifyMainRpProductionParity(
      independentParityInput({
        expectedSealedRequestBody: independentAssembledBody({ temperature: 0.1 }),
      })
    );
    assert.equal(sampling.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(sampling.reasons.includes("sampling_mismatch"));

    const length = classifyMainRpProductionParity(independentParityInput({ softAimChars: 800 }));
    assert.equal(length.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(length.reasons.includes("length_owner_drift"));
    assert.equal(length.softAimChars, UNIFIED_TIER_AIM_CHARS);

    const maxTokens = classifyMainRpProductionParity(
      independentParityInput({
        assembledRequestBody: independentAssembledBody({ max_tokens: 800 }),
        expectedSealedRequestBody: independentAssembledBody({ max_tokens: 800 }),
      })
    );
    assert.equal(maxTokens.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(maxTokens.reasons.includes("max_tokens_present"));
  });

  it("fails closed on a different recovery path or flattened request meaning", () => {
    const recovery = classifyMainRpProductionParity(
      independentParityInput({ recoveryPath: "benchmark-flatten" })
    );
    assert.equal(recovery.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(recovery.reasons.includes("recovery_path_mismatch"));

    const flattened = classifyMainRpProductionParity(
      independentParityInput({ flattenedLosingMeaning: true })
    );
    assert.equal(flattened.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(flattened.reasons.includes("flattened_losing_meaning"));
  });

  it("classifies unproven thinking or reasoning meaning as SEMANTIC_PARITY_UNCONFIRMED", () => {
    const { thinking: _thinking, reasoning_effort: _effort, ...noThinking } =
      independentAssembledBody();
    const result = classifyMainRpProductionParity(
      independentParityInput({
        assembledRequestBody: noThinking,
        expectedSealedRequestBody: { ...noThinking },
      })
    );
    assert.equal(result.status, "SEMANTIC_PARITY_UNCONFIRMED");
    assert.equal(result.qualityScoreEligible, false);
    assert.ok(result.reasons.includes("thinking_or_reasoning_semantic_unconfirmed"));
  });

  it("does not treat PRECALL_READY false as a quality score even when wire evidence matches", () => {
    const result = classifyMainRpProductionParity(independentParityInput({ precallReady: false }));
    assert.equal(result.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(result.qualityScoreEligible, false);
  });
});
