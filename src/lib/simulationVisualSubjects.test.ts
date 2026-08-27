import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterAsset } from "@/lib/characterAssets";
import {
  draftCastIntentFromCandidatePool,
  type ChatImageCastIntentManifest,
} from "@/lib/chatImageCast";
import {
  groundCastIntent,
  type GroundCastContext,
} from "@/lib/chatImageCastManifest";
import { buildChatComicGenerationPlan } from "@/lib/chatComicGeneration";
import { buildLdSceneGenerationPlan } from "@/lib/chatLdIllustrationGeneration";
import {
  assignAssetsToVisualSubject,
  assetsForVisualSubject,
  clearStaleRepresentativeAssets,
  createSimulationVisualSubjectKey,
  emptySimulationVisualSubjectsDocument,
  isSimulationVisualSubjectKey,
  parseSimulationVisualSubjectsJson,
  prepareSimulationVisualSubjectsForSave,
  reconcileSimulationVisualSubjects,
  resolveVisualSubjectByName,
  serializeSimulationVisualSubjectsJson,
  unassignVisualAssets,
  validateAssetVisualSubjectOwnership,
  validateRepresentativeAsset,
  validateSimulationVisualSubjectsDocument,
  configuredSimulationCastNames,
  buildPublicVisualSubjectSummaries,
} from "@/lib/simulationVisualSubjects";

const SIM_TITLE = "WW2 시뮬레이터";
const MEMBER_A = "이현";
const MEMBER_B = "태형";
const MEMBER_C = "렌";

const URL_A = "/uploads/a.webp";
const URL_B = "/uploads/b.webp";
const URL_C = "/uploads/c.webp";
const URL_U = "/uploads/unassigned.webp";

function asset(url: string, tag: string, visualSubjectKey?: string): CharacterAsset {
  return { url, tag, ...(visualSubjectKey ? { visualSubjectKey } : {}) };
}

function subject(name: string, key = createSimulationVisualSubjectKey(), appearance = "") {
  return {
    subjectKey: key,
    name,
    savedAppearance: appearance,
    representativeAssetUrl: null as string | null,
    sourceCharacterId: null,
  };
}

function simGroundCtx(
  visualSubjects: ReturnType<typeof subject>[],
  assets: CharacterAsset[]
): GroundCastContext {
  return {
    persona: {
      name: "나",
      gender: "female",
      referenceImageUrl: "/uploads/persona.webp",
    },
    mainCharacter: {
      name: SIM_TITLE,
      gender: "other",
      referenceImageUrl: "",
    },
    selectableAssets: assets.map((row) => ({
      url: row.url,
      tag: row.tag,
      visualSubjectKey: row.visualSubjectKey,
    })),
    simulationVisualSubjects: visualSubjects,
    characterAssets: assets,
  };
}

function castIntentThree(): ChatImageCastIntentManifest {
  return {
    compositionGoal: "trio_group",
    subjects: [
      {
        key: "persona",
        role: "persona",
        name: "나",
        included: false,
        importance: "primary",
        visibility: "required_visible",
      },
      ...[MEMBER_A, MEMBER_B, MEMBER_C].map((name, index) => ({
        key: `supporting:${name}`,
        role: "supporting_character" as const,
        name,
        included: true,
        importance: "primary" as const,
        visibility: "required_visible" as const,
        requestedReferenceAssetUrl: [URL_A, URL_B, URL_C][index],
      })),
    ],
  };
}

describe("simulationVisualSubjects data", () => {
  it("D1: legacy empty metadata parses without auto-write shape", () => {
    const doc = parseSimulationVisualSubjectsJson("");
    assert.deepEqual(doc, emptySimulationVisualSubjectsDocument());
  });

  it("D2/D3: save assigns stable subjectKey and preserves appearance edits", () => {
    const key = createSimulationVisualSubjectKey();
    assert.ok(isSimulationVisualSubjectKey(key));
    const prepared = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]\n- 역할: 리더`,
      simulationTitle: SIM_TITLE,
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [{ ...subject(MEMBER_A, key, "검은 머리") }],
      }),
      storedRaw: "",
      assets: [],
    });
    const saved = prepared.subjects.find((row) => row.name === MEMBER_A);
    assert.equal(saved?.subjectKey, key);
    assert.equal(saved?.savedAppearance, "검은 머리");
  });

  it("D5: removed cast name keeps stored visual metadata as orphaned", () => {
    const stored = subject(MEMBER_A, createSimulationVisualSubjectKey(), "유지");
    const reconciled = reconcileSimulationVisualSubjects({
      configuredNames: [MEMBER_B],
      storedSubjects: [stored],
    });
    assert.equal(reconciled.active[0]?.name, MEMBER_B);
    assert.equal(reconciled.orphaned.length, 1);
    assert.equal(reconciled.orphaned[0]?.savedAppearance, "유지");
  });

  it("D6: ambiguous duplicate stored names fail closed on resolve", () => {
    const a = subject(MEMBER_A, createSimulationVisualSubjectKey());
    const b = subject(MEMBER_A, createSimulationVisualSubjectKey());
    assert.equal(resolveVisualSubjectByName([a, b], MEMBER_A), null);
  });

  it("D4: unrelated simulation_cast edit keeps existing visual subject keys", () => {
    const key = createSimulationVisualSubjectKey();
    const first = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]\n- 성격: 리더`,
      simulationTitle: SIM_TITLE,
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [{ ...subject(MEMBER_A, key, "유지 외형") }],
      }),
      storedRaw: "",
      assets: [],
    });
    const second = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]\n- 성격: 리더\n- 목표: 생존`,
      simulationTitle: SIM_TITLE,
      submittedRaw: serializeSimulationVisualSubjectsJson(first),
      storedRaw: serializeSimulationVisualSubjectsJson(first),
      assets: [],
    });
    const saved = second.subjects.find((row) => row.name === MEMBER_A);
    assert.equal(saved?.subjectKey, key);
    assert.equal(saved?.savedAppearance, "유지 외형");
  });

  it("G6: simulation title is never a configured visual subject name", () => {
    const names = configuredSimulationCastNames(
      `[${SIM_TITLE}]\n- 역할: 컨테이너\n[${MEMBER_A}]\n- 역할: 리더`,
      SIM_TITLE
    );
    assert.deepEqual(names, [MEMBER_A]);
    assert.equal(resolveVisualSubjectByName([subject(MEMBER_A)], SIM_TITLE), null);
  });
});

describe("simulationVisualSubjects asset ownership", () => {
  const keyA = createSimulationVisualSubjectKey();
  const keyB = createSimulationVisualSubjectKey();

  it("A1/A2: grouped uploads bind all assets to one subject key", () => {
    let assets = [asset(URL_A, "a"), asset("/uploads/a2.webp", "a2")];
    assets = assignAssetsToVisualSubject(assets, assets.map((row) => row.url), keyA);
    assert.equal(assets.every((row) => row.visualSubjectKey === keyA), true);

    assets = assignAssetsToVisualSubject([asset(URL_B, "b")], [URL_B], keyB);
    assert.equal(assets[0]?.visualSubjectKey, keyB);
  });

  it("A3: generic assets remain unassigned", () => {
    assert.equal(asset(URL_U, "u").visualSubjectKey, undefined);
  });

  it("A4/A5: bulk assign and unassign", () => {
    let assets = [asset(URL_A, "a"), asset(URL_B, "b"), asset(URL_C, "c")];
    assets = assignAssetsToVisualSubject(assets, [URL_A, URL_B, URL_C], keyA);
    assets = unassignVisualAssets(assets, [URL_B]);
    assert.equal(assetBy(assets, URL_A)?.visualSubjectKey, keyA);
    assert.equal(assetBy(assets, URL_B)?.visualSubjectKey, undefined);
    assert.equal(assetBy(assets, URL_C)?.visualSubjectKey, keyA);
  });

  it("A6/A7: reassignment keeps one owner; duplicate subject assignment impossible at field level", () => {
    let assets = [asset(URL_A, "a", keyA)];
    assets = assignAssetsToVisualSubject(assets, [URL_A], keyB);
    assert.equal(assets[0]?.visualSubjectKey, keyB);
    assert.notEqual(assets[0]?.visualSubjectKey, keyA);
  });
});

function assetBy(assets: CharacterAsset[], url: string) {
  return assets.find((row) => row.url === url);
}

describe("simulationVisualSubjects representative consistency", () => {
  it("R1/R2: representative must belong to the same subject", () => {
    const keyA = createSimulationVisualSubjectKey();
    const keyB = createSimulationVisualSubjectKey();
    const assets = [asset(URL_A, "a", keyA), asset(URL_B, "b", keyB)];
    const valid = subject(MEMBER_A, keyA);
    valid.representativeAssetUrl = URL_A;
    assert.equal(validateRepresentativeAsset(valid, assets), URL_A);

    const invalid = { ...valid, representativeAssetUrl: URL_B };
    assert.equal(validateRepresentativeAsset(invalid, assets), null);

    const doc = validateSimulationVisualSubjectsDocument(
      { version: 1, subjects: [invalid] },
      assets
    );
    assert.equal(doc.ok, false);
  });

  it("R3: stale representative cleared after ownership move", () => {
    const keyA = createSimulationVisualSubjectKey();
    const keyB = createSimulationVisualSubjectKey();
    const assets = [asset(URL_A, "a", keyB)];
    const subjects = clearStaleRepresentativeAssets(
      [{ ...subject(MEMBER_A, keyA), representativeAssetUrl: URL_A }],
      assets
    );
    assert.equal(subjects[0]?.representativeAssetUrl, null);
  });
});

describe("simulationVisualSubjects generation grounding", () => {
  it("G1/G2/G3: owned vs unassigned vs cross-subject references", () => {
    const keyA = createSimulationVisualSubjectKey();
    const keyB = createSimulationVisualSubjectKey();
    const appearanceA = "짧은 검은 머리, 회색 눈";
    const subjects = [
      { ...subject(MEMBER_A, keyA, appearanceA) },
      subject(MEMBER_B, keyB),
      subject(MEMBER_C, createSimulationVisualSubjectKey()),
    ];
    const assets = [
      asset(URL_A, "a", keyA),
      asset(URL_B, "b", keyB),
      asset(URL_C, "c", subjects[2]!.subjectKey),
      asset(URL_U, "u"),
    ];

    const passOwned = groundCastIntent(
      {
        ...castIntentThree(),
        subjects: castIntentThree().subjects.map((row) =>
          row.name === MEMBER_A ? { ...row, requestedReferenceAssetUrl: URL_A } : row
        ),
      },
      simGroundCtx(subjects, assets),
      undefined,
      "simulation"
    );
    assert.equal(passOwned.ok, true);
    if (!passOwned.ok) throw new Error(passOwned.reason);
    const groundedA = passOwned.manifest.subjects.find((row) => row.name === MEMBER_A);
    assert.ok(groundedA?.savedAppearance?.includes("검은 머리"));
    assert.equal(groundedA?.appearanceMode, "image_plus_saved");

    const passLegacy = groundCastIntent(
      {
        ...castIntentThree(),
        subjects: castIntentThree().subjects.map((row) =>
          row.name === MEMBER_A ? { ...row, requestedReferenceAssetUrl: URL_U } : row
        ),
      },
      simGroundCtx(subjects, assets),
      undefined,
      "simulation"
    );
    assert.equal(passLegacy.ok, true);

    const failCross = groundCastIntent(
      {
        ...castIntentThree(),
        subjects: castIntentThree().subjects.map((row) =>
          row.name === MEMBER_A ? { ...row, requestedReferenceAssetUrl: URL_B } : row
        ),
      },
      simGroundCtx(subjects, assets),
      undefined,
      "simulation"
    );
    assert.equal(failCross.ok, false);
    if (failCross.ok) throw new Error("expected cross-subject failure");
  });

  it("3-person regression: each member keeps own appearance in LD/comic plans", () => {
    const subjects = [
      subject(MEMBER_A, createSimulationVisualSubjectKey(), "appearance A"),
      subject(MEMBER_B, createSimulationVisualSubjectKey(), "appearance B"),
      subject(MEMBER_C, createSimulationVisualSubjectKey(), "appearance C"),
    ];
    const assets = [
      asset(URL_A, "a", subjects[0]!.subjectKey),
      asset(URL_B, "b", subjects[1]!.subjectKey),
      asset(URL_C, "c", subjects[2]!.subjectKey),
    ];
    const grounded = groundCastIntent(castIntentThree(), simGroundCtx(subjects, assets), undefined, "simulation");
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);

    const ld = buildLdSceneGenerationPlan({
      characterName: SIM_TITLE,
      characterGender: "other",
      personaName: "나",
      personaGender: "female",
      characterImageUrl: "",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      castManifest: grounded.manifest,
      contentKind: "simulation",
    });
    const comic = buildChatComicGenerationPlan({
      characterName: SIM_TITLE,
      characterGender: "other",
      personaName: "나",
      personaGender: "female",
      characterImageUrl: "",
      characterSavedAppearance: "",
      characterAppearanceMode: "image_only",
      personaImageUrl: "",
      personaSavedAppearance: "",
      personaAppearanceMode: "image_only",
      plan: {
        sceneBackground: "stage",
        events: [],
        heroEventIds: [],
        heroScene: "stage",
        recommendedPanelCount: 2,
        panels: [],
      },
      castManifest: grounded.manifest,
      contentKind: "simulation",
    });
    assert.match(ld.prompt, /Exactly 3 recurring identities/);
    assert.match(comic.prompt, /Exactly 3 recurring human identities/);
    assert.doesNotMatch(ld.prompt, new RegExp(SIM_TITLE));
    assert.match(ld.prompt, /appearance A/);
    assert.match(ld.prompt, /appearance B/);
    assert.match(ld.prompt, /appearance C/);
  });
});

describe("simulationVisualSubjects ownership validation", () => {
  it("validateAssetVisualSubjectOwnership enforces explicit metadata", () => {
    const keyA = createSimulationVisualSubjectKey();
    const assets = [asset(URL_A, "a", keyA)];
    assert.equal(
      validateAssetVisualSubjectOwnership({
        assetUrl: URL_A,
        subjectKey: keyA,
        assets,
      }).ok,
      true
    );
    assert.equal(
      validateAssetVisualSubjectOwnership({
        assetUrl: URL_A,
        subjectKey: createSimulationVisualSubjectKey(),
        assets,
      }).ok,
      false
    );
  });
});

describe("simulationVisualSubjects privacy", () => {
  it("public summaries omit raw savedAppearance text", () => {
    const key = createSimulationVisualSubjectKey();
    const summaries = buildPublicVisualSubjectSummaries(
      [subject(MEMBER_A, key, "비밀 외형 원문")],
      [asset(URL_A, "a", key)]
    );
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0]?.hasSavedAppearance, true);
    assert.equal(summaries[0]?.ownedAssetCount, 1);
    assert.equal(JSON.stringify(summaries).includes("비밀 외형 원문"), false);
  });
});

describe("simulationVisualSubjects roundtrip", () => {
  it("save/reload semantic deep-equivalent", () => {
    const key = createSimulationVisualSubjectKey();
    const assets = [asset(URL_A, "a", key), asset(URL_U, "u")];
    const prepared = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]`,
      simulationTitle: SIM_TITLE,
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [{ ...subject(MEMBER_A, key, "비 내리는 서울역 옥상"), representativeAssetUrl: URL_A }],
      }),
      storedRaw: "",
      assets,
    });
    const raw = serializeSimulationVisualSubjectsJson(prepared);
    const reloaded = parseSimulationVisualSubjectsJson(raw);
    assert.deepEqual(reloaded.subjects, prepared.subjects);
    assert.equal(assetsForVisualSubject(assets, key).length, 1);
  });
});
