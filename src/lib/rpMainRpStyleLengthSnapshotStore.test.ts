import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { MAIN_RP_MODEL_IDS } from "@/lib/chatModels";
import { RP_QUALITY_PRECALL_FIXTURE_IDS } from "@/lib/rpQualityPrecall";
import {
  MainRpStyleLengthFixtureError,
  type MainRpStyleLengthPublicManifest,
} from "@/lib/rpMainRpStyleLengthFixture";
import { createMainRpStyleLengthSnapshotStore } from "@/lib/rpMainRpStyleLengthSnapshotStore";

function publicManifest(version: number): MainRpStyleLengthPublicManifest {
  return {
    evaluation: "MAIN_RP_STYLE_LENGTH",
    snapshotSchema: 1,
    snapshotVersion: version,
    mode: "GOLDEN_SNAPSHOT",
    capturedAt: "2026-10-10T05:39:03.221Z",
    deployedGitSha: "e1fdab509d2e9713be617025f77ea40a5bfb85f5",
    characterId: 18,
    characterName: "라이크",
    personaId: 1,
    personaName: "렌",
    personaGender: "male",
    adminUserId: 1,
    uniqueAdminRenPersona: true,
    authoringLevel: "NORMAL",
    userCoauthor: {
      allowDialogue: true,
      allowMajorActions: true,
      allowInnerPov: false,
      allowIrreversibleFate: false,
    },
    contentMode: "SAFE",
    contentKind: "character",
    nsfwListing: 1,
    officialListing: 0,
    creatorLorebookAttachments: 0,
    globalLorebookEnabled: 1,
    greetingChars: 1318,
    personaPublicChars: 583,
    identityHashes: {
      greetingSha256: "1".repeat(64),
      systemPromptSha256: "2".repeat(64),
      worldSha256: "3".repeat(64),
      settingChunksSha256: "4".repeat(64),
      personaPublicSha256: "5".repeat(64),
    },
    combinedIdentityHash: "6".repeat(64),
    fixtureIds: RP_QUALITY_PRECALL_FIXTURE_IDS,
    models: MAIN_RP_MODEL_IDS,
    calls: [],
    sealedRequestCount: 0,
    sourceKind: "railway-production-readonly-in-process-v1",
    privateStore: `/data/private-golden-fixtures/v${version}`,
    overwrite: false,
    providerPosts: 0,
    dbWrites: 0,
    qualityScores: null,
  };
}

describe("MAIN_RP_STYLE_LENGTH snapshot store", () => {
  let dir = "";

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "golden-store-"));
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it("creates a version once and reloads the same sealed bytes", () => {
    const store = createMainRpStyleLengthSnapshotStore(dir);
    const sealed = { marker: "TEST_ONLY_SYNTHETIC", body: "private-bytes" };
    const created = store.createVersion({
      version: 1,
      sealed,
      publicManifest: publicManifest(1),
    });
    const loaded = store.loadVersion(1);
    assert.equal(loaded.sealedSha256, created.sealedSha256);
    assert.deepEqual(loaded.sealed, sealed);
    assert.equal(loaded.publicManifest.characterId, 18);
    assert.equal(loaded.publicManifest.personaName, "렌");
    assert.throws(
      () =>
        store.createVersion({
          version: 1,
          sealed: { marker: "overwrite" },
          publicManifest: publicManifest(1),
        }),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "GOLDEN_VERSION_EXISTS"
    );
  });

  it("fail-closes a missing version and a tampered sealed file", () => {
    const store = createMainRpStyleLengthSnapshotStore(dir);
    assert.throws(
      () => store.loadVersion(9),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "GOLDEN_VERSION_MISSING"
    );
    store.createVersion({
      version: 2,
      sealed: { marker: "tamper-base" },
      publicManifest: publicManifest(2),
    });
    writeFileSync(path.join(dir, "v2", "sealed.json"), '{"marker":"tampered"}\n');
    assert.throws(
      () => store.loadVersion(2),
      (error: unknown) =>
        error instanceof MainRpStyleLengthFixtureError && error.code === "SNAPSHOT_TAMPERED"
    );
  });
});
