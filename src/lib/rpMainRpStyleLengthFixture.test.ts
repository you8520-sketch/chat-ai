import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { RP_QUALITY_PRECALL_TARGET_SELECTOR } from "@/lib/rpQualityPrecall";
import {
  HISTORICAL_RP_QUALIFICATION_CHARACTER_ID,
  MAIN_RP_STYLE_LENGTH_EVALUATION,
  MAIN_RP_STYLE_LENGTH_TARGET,
  MainRpStyleLengthFixtureError,
  MAIN_RP_STYLE_LENGTH_GOLDEN_V1_PUBLIC,
  assertMainRpStyleLengthEvaluationReady,
  assertMainRpStyleLengthHashes,
  assertMainRpStyleLengthIdentity,
  classifyMainRpProductionParity,
  compareLiveToGolden,
  deriveMainRpStyleLengthAdminEvidence,
  isMainRpStyleLengthEvaluationRequested,
  mainRpStyleLengthSitePolicy,
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

describe("caller production parity input is not a trust boundary", () => {
  it("does not verify forged provenance labels or a cloned body", () => {
    const body = {
      model: "deepseek-v4.1-flash",
      messages: [{ role: "user", content: "synthetic" }],
      temperature: 0.92,
      top_p: 0.92,
      thinking: { type: "disabled" },
    };
    const result = classifyMainRpProductionParity({
      evidenceKind: "CURRENT_LIVE",
      currentLiveVerified: true,
      observedProvenance: { kind: "in_process_assembly", sourceId: "forged-a" },
      expectedProvenance: { kind: "railway_live_proof", sourceId: "forged-b" },
      assembledRequestBody: body,
      expectedSealedRequestBody: structuredClone(body),
      precallReady: true,
      thinkingSemanticEquivalent: true,
      reasoningSemanticEquivalent: true,
    });
    assert.notEqual(result.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(result.qualityScoreEligible, false);
    assert.ok(result.reasons.includes("caller_attestation_cannot_verify"));
    assert.ok(result.reasons.includes("current_live_verified_boolean_ignored"));
    assert.equal(result.trustBoundary, "caller_input_is_not_trusted");
  });

  it("does not verify invented hashes, missing bodies, or a stale SHA", () => {
    const invented = classifyMainRpProductionParity({
      evidenceKind: "railway_live_proof",
      sourceId: "forged-source",
      identityHashes: { greetingSha256: "a".repeat(64) },
      expectedIdentityHashes: { greetingSha256: "b".repeat(64) },
    });
    assert.notEqual(invented.status, "PRODUCTION_PARITY_VERIFIED");
    assert.equal(invented.qualityScoreEligible, false);

    const missingBody = classifyMainRpProductionParity({
      evidenceKind: "in_process_assembly",
      assembledRequestBody: undefined,
      expectedSealedRequestBody: undefined,
    });
    assert.equal(missingBody.status, "NOT_COMPARABLE");
    assert.equal(missingBody.qualityScoreEligible, false);

    const stale = classifyMainRpProductionParity({
      currentProductionSuccessSha: "4d83c100666878cca747408ae72a18f3360310ac",
      capturedDeploySha: "e1fdab509d2e9713be617025f77ea40a5bfb85f5",
      currentLiveVerified: true,
    });
    assert.equal(stale.status, "STALE_PRODUCTION_SNAPSHOT");
    assert.equal(stale.qualityScoreEligible, false);

    const capped = classifyMainRpProductionParity({ maxTokensPresent: true, precallReady: false });
    assert.equal(capped.status, "PRODUCTION_PARITY_MISMATCH");
    assert.ok(capped.reasons.includes("max_tokens_present"));
    assert.ok(capped.reasons.includes("precall_ready_is_not_quality_approval"));
    assert.equal(capped.qualityScoreEligible, false);
  });
});
