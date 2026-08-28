import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterAsset } from "@/lib/characterAssets";
import {
  buildClientVisibleVisualSubjects,
  buildClientScopedCastImageMetadata,
  createLegacySimulationVisualSubjectKey,
  createVisualSubjectKey,
  extractVisualSubjectsFromBody,
  isGenericVisualSubjectKey,
  isLegacySimulationVisualSubjectKey,
  isVisualSubjectKey,
  parseSubmittedVisualSubjectsJson,
  parseVisualSubjectsJson,
  serializeVisualSubjectsJson,
  validateAssetVisualSubjectOwnership,
  validateCharacterPrimaryAssetAssignment,
  validateCharacterPrimarySlotCandidate,
  validateRepresentativeAsset,
  VisualSubjectsInputError,
  assetsForMainCharacterPool,
} from "@/lib/visualSubjects";

function asset(url: string, tag: string, visualSubjectKey?: string): CharacterAsset {
  return { url, tag, ...(visualSubjectKey ? { visualSubjectKey } : {}) };
}

describe("visualSubjects domain", () => {
  it("accepts legacy simvis and generic vis keys", () => {
    const simvis = createLegacySimulationVisualSubjectKey();
    const vis = createVisualSubjectKey();
    assert.equal(isLegacySimulationVisualSubjectKey(simvis), true);
    assert.equal(isGenericVisualSubjectKey(vis), true);
    assert.equal(isVisualSubjectKey(simvis), true);
    assert.equal(isVisualSubjectKey(vis), true);
  });

  it("roundtrips parse and serialize", () => {
    const key = createVisualSubjectKey();
    const doc = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: key,
          name: "민준",
          savedAppearance: "검은 머리",
          representativeAssetUrl: "/uploads/a.webp",
          sourceCharacterId: null,
        },
      ],
    };
    const json = serializeVisualSubjectsJson(doc);
    const parsed = parseVisualSubjectsJson(json);
    assert.deepEqual(parsed, doc);
  });

  it("rejects duplicate subject keys and normalized names on submit", () => {
    const keyA = createVisualSubjectKey();
    const keyB = createVisualSubjectKey();
    assert.throws(
      () =>
        parseSubmittedVisualSubjectsJson(
          JSON.stringify({
            version: 1,
            subjects: [
              {
                subjectKey: keyA,
                name: "민준",
                savedAppearance: "",
                representativeAssetUrl: null,
                sourceCharacterId: null,
              },
              {
                subjectKey: keyB,
                name: "민준",
                savedAppearance: "",
                representativeAssetUrl: null,
                sourceCharacterId: null,
              },
            ],
          })
        ),
      VisualSubjectsInputError
    );
  });

  it("requires representative exact ownership", () => {
    const key = createVisualSubjectKey();
    const assets = [asset("/uploads/main.webp", "main"), asset("/uploads/a.webp", "a", key)];
    const subject = {
      subjectKey: key,
      name: "민준",
      savedAppearance: "",
      representativeAssetUrl: "/uploads/main.webp",
      sourceCharacterId: null,
    };
    assert.equal(validateRepresentativeAsset(subject, assets), null);
    subject.representativeAssetUrl = "/uploads/a.webp";
    assert.equal(validateRepresentativeAsset(subject, assets), "/uploads/a.webp");
  });

  it("rejects unknown asset owner assignment on character primary asset", () => {
    const key = createVisualSubjectKey();
    const assets = [asset("/uploads/main.webp", "main", key)];
    const primary = validateCharacterPrimaryAssetAssignment(assets);
    assert.equal(primary.ok, false);
  });

  it("enforces exact visual subject ownership for character content kind", () => {
    const keyA = createVisualSubjectKey();
    const keyB = createVisualSubjectKey();
    const assets = [
      asset("/uploads/a.webp", "a", keyA),
      asset("/uploads/b.webp", "b", keyB),
      asset("/uploads/main.webp", "main"),
    ];
    assert.equal(
      validateAssetVisualSubjectOwnership({
        contentKind: "character",
        assetUrl: "/uploads/a.webp",
        subjectKey: keyA,
        assets,
      }).ok,
      true
    );
    assert.equal(
      validateAssetVisualSubjectOwnership({
        contentKind: "character",
        assetUrl: "/uploads/b.webp",
        subjectKey: keyA,
        assets,
      }).ok,
      false
    );
    assert.equal(
      validateAssetVisualSubjectOwnership({
        contentKind: "character",
        assetUrl: "/uploads/main.webp",
        subjectKey: keyA,
        assets,
      }).ok,
      false
    );
  });

  it("extractVisualSubjectsFromBody distinguishes absent from explicit empty", () => {
    assert.deepEqual(extractVisualSubjectsFromBody({}), { provided: false, raw: "" });
    assert.equal(
      extractVisualSubjectsFromBody({ visual_subjects: { version: 1, subjects: [] } }).provided,
      true
    );
  });

  it("buildClientVisibleVisualSubjects strips private fields", () => {
    const key = createVisualSubjectKey();
    const assets = [asset("/uploads/a.webp", "a", key)];
    const visible = buildClientVisibleVisualSubjects({
      subjects: [
        {
          subjectKey: key,
          name: "태현",
          savedAppearance: "비밀 외형",
          representativeAssetUrl: "/uploads/a.webp",
          sourceCharacterId: 99,
        },
      ],
      assets,
      visibleNames: ["태현"],
    });
    assert.deepEqual(visible, [
      { subjectKey: key, name: "태현", representativeAssetUrl: "/uploads/a.webp" },
    ]);
    assert.equal(JSON.stringify(visible).includes("savedAppearance"), false);
    assert.equal(JSON.stringify(visible).includes("sourceCharacterId"), false);
  });

  it("buildClientScopedCastImageMetadata hides unrevealed support for non-owner", () => {
    const keyA = createVisualSubjectKey();
    const keyB = createVisualSubjectKey();
    const keyC = createVisualSubjectKey();
    const subjects = [
      {
        subjectKey: keyA,
        name: "태현",
        savedAppearance: "A",
        representativeAssetUrl: "/uploads/a.webp",
        sourceCharacterId: null,
      },
      {
        subjectKey: keyB,
        name: "이현",
        savedAppearance: "B",
        representativeAssetUrl: "/uploads/b.webp",
        sourceCharacterId: null,
      },
      {
        subjectKey: keyC,
        name: "비밀NPC",
        savedAppearance: "C",
        representativeAssetUrl: "/uploads/c.webp",
        sourceCharacterId: null,
      },
    ];
    const assets = [
      asset("/uploads/a.webp", "a", keyA),
      asset("/uploads/b.webp", "b", keyB),
      asset("/uploads/c.webp", "c", keyC),
    ];
    const castSelectableAssets = assets.map((row) => ({
      url: row.url,
      tag: row.tag,
      visualSubjectKey: row.visualSubjectKey,
    }));
    const scoped = buildClientScopedCastImageMetadata({
      contentKind: "character",
      isCreator: false,
      subjects,
      assets,
      castSelectableAssets,
      visibleNames: ["태현"],
      scope: "source_scoped",
    });
    assert.deepEqual(scoped.configuredCastNames, ["태현"]);
    assert.equal(scoped.visualSubjects.some((row) => row.name === "이현"), false);
    assert.equal(scoped.visualSubjects.some((row) => row.name === "비밀NPC"), false);
    assert.equal(
      scoped.castSelectableAssets.some((row) => row.url === "/uploads/b.webp"),
      false
    );
    assert.equal(
      scoped.castSelectableAssets.some((row) => row.url === "/uploads/c.webp"),
      false
    );
  });

  it("assetsForMainCharacterPool keeps legacy zero-diff main pool", () => {
    const assets = [asset("/uploads/main.webp", "main"), asset("/uploads/extra.webp", "extra")];
    assert.deepEqual(
      assetsForMainCharacterPool(assets, "character").map((row) => row.url),
      ["/uploads/main.webp", "/uploads/extra.webp"]
    );
  });

  it("keeps simulation unassigned assets in viewer source-scoped pool", () => {
    const key = createVisualSubjectKey();
    const assets = [
      asset("/uploads/general.webp", "general"),
      asset("/uploads/support.webp", "support", key),
    ];
    const scoped = buildClientScopedCastImageMetadata({
      contentKind: "simulation",
      isCreator: false,
      subjects: [
        {
          subjectKey: key,
          name: "조연",
          savedAppearance: "",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
      assets,
      castSelectableAssets: assets.map((row) => ({
        url: row.url,
        tag: row.tag,
        visualSubjectKey: row.visualSubjectKey,
      })),
      visibleNames: ["조연"],
      scope: "source_scoped",
    });
    assert.equal(
      scoped.castSelectableAssets.some((row) => row.url === "/uploads/general.webp"),
      true
    );
  });

  it("blocks character reorder that would expose support-owned asset at index 0", () => {
    const key = createVisualSubjectKey();
    const assets = [
      asset("/uploads/main.webp", "main"),
      asset("/uploads/support.webp", "support", key),
      asset("/uploads/main2.webp", "main2"),
    ];
    const candidate = [assets[1]!, assets[2]!, assets[0]!];
    const check = validateCharacterPrimarySlotCandidate(candidate);
    assert.equal(check.ok, false);
  });
});
