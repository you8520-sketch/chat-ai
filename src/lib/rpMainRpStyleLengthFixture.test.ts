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
  assertMainRpStyleLengthHashes,
  assertMainRpStyleLengthIdentity,
  compareLiveToGolden,
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
