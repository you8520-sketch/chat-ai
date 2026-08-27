import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterAsset } from "@/lib/characterAssets";
import {
  draftCastIntentFromCandidatePool,
  type ChatImageCastIntentManifest,
} from "@/lib/chatImageCast";
import {
  bindApprovedCastManifest,
  groundCastIntent,
  renderCastFidelityTiers,
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
  materializeSimulationVisualSubjectsForEditor,
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
const URL_D = "/uploads/d.webp";
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
      simulationCast: `[${MEMBER_A}]\n외형: 검은 머리\n- 역할: 리더`,
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
      simulationCast: `[${MEMBER_A}]\n외형: 검은 머리\n- 성격: 리더`,
      simulationTitle: SIM_TITLE,
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [{ ...subject(MEMBER_A, key, "유지 외형") }],
      }),
      storedRaw: "",
      assets: [],
    });
    const second = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]\n외형: 검은 머리\n- 성격: 리더\n- 목표: 생존`,
      simulationTitle: SIM_TITLE,
      submittedRaw: serializeSimulationVisualSubjectsJson(first),
      storedRaw: serializeSimulationVisualSubjectsJson(first),
      assets: [],
    });
    const saved = second.subjects.find((row) => row.name === MEMBER_A);
    assert.equal(saved?.subjectKey, key);
    assert.equal(saved?.savedAppearance, "검은 머리");
  });

  it("G6: simulation title is never a configured visual subject name", () => {
    const names = configuredSimulationCastNames(
      `[${SIM_TITLE}]\n- 역할: 컨테이너\n[${MEMBER_A}]\n- 역할: 리더`,
      SIM_TITLE
    );
    assert.deepEqual(names, [MEMBER_A]);
    assert.equal(resolveVisualSubjectByName([subject(MEMBER_A)], SIM_TITLE), null);
  });

  it("derives each subject appearance only from explicit character settings", () => {
    const keyA = createSimulationVisualSubjectKey();
    const keyB = createSimulationVisualSubjectKey();
    const prepared = prepareSimulationVisualSubjectsForSave({
      simulationCast: [
        `[${MEMBER_A}]`,
        "외형: 짧은 검은 머리, 붉은 눈",
        "성격: 무뚝뚝함",
        `[${MEMBER_B}]`,
        "성격: 다정함",
        "관계: 이현의 동료",
      ].join("\n"),
      simulationTitle: SIM_TITLE,
      storedRaw: "",
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [subject(MEMBER_A, keyA), subject(MEMBER_B, keyB)],
      }),
      assets: [],
    });
    assert.equal(
      prepared.subjects.find((row) => row.name === MEMBER_A)?.savedAppearance,
      "짧은 검은 머리, 붉은 눈"
    );
    assert.equal(
      prepared.subjects.find((row) => row.name === MEMBER_B)?.savedAppearance,
      ""
    );
  });

  it("existing stored key remains authoritative over a forged submitted key", () => {
    const storedKey = createSimulationVisualSubjectKey();
    const forgedKey = createSimulationVisualSubjectKey();
    const stored = { version: 1 as const, subjects: [subject(MEMBER_A, storedKey, "검은 머리")] };
    const prepared = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]`,
      simulationTitle: SIM_TITLE,
      storedRaw: serializeSimulationVisualSubjectsJson(stored),
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [subject(MEMBER_A, forgedKey, "회색 눈")],
      }),
      assets: [],
    });
    assert.equal(prepared.subjects[0]?.subjectKey, storedKey);
    assert.equal(prepared.subjects[0]?.savedAppearance, "검은 머리");
  });

  it("rejects malformed and duplicate submitted subject keys", () => {
    assert.throws(() =>
      prepareSimulationVisualSubjectsForSave({
        simulationCast: `[${MEMBER_A}]`,
        simulationTitle: SIM_TITLE,
        storedRaw: "",
        submittedRaw: JSON.stringify({
          version: 1,
          subjects: [{ ...subject(MEMBER_A), subjectKey: "simvis_bad" }],
        }),
        assets: [],
      })
    );
    const duplicateKey = createSimulationVisualSubjectKey();
    assert.throws(() =>
      prepareSimulationVisualSubjectsForSave({
        simulationCast: `[${MEMBER_A}]\n[${MEMBER_B}]`,
        simulationTitle: SIM_TITLE,
        storedRaw: "",
        submittedRaw: JSON.stringify({
          version: 1,
          subjects: [subject(MEMBER_A, duplicateKey), subject(MEMBER_B, duplicateKey)],
        }),
        assets: [],
      })
    );
  });

  it("keeps stored orphans but ignores client-created title and fake subjects", () => {
    const orphan = subject("기존 인물", createSimulationVisualSubjectKey(), "은발");
    const materialized = materializeSimulationVisualSubjectsForEditor({
      configuredNames: [MEMBER_A],
      document: emptySimulationVisualSubjectsDocument(),
    });
    const active = materialized.subjects[0]!;
    const prepared = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[${MEMBER_A}]`,
      simulationTitle: SIM_TITLE,
      storedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [orphan],
      }),
      submittedRaw: serializeSimulationVisualSubjectsJson({
        version: 1,
        subjects: [
          active,
          subject(SIM_TITLE),
          subject("가짜인물"),
        ],
      }),
      assets: [],
    });
    assert.deepEqual(
      prepared.subjects.map((row) => row.name),
      [MEMBER_A, "기존 인물"]
    );
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

  it("owned bulk unassign and reassignment operate on owned selections", () => {
    let assets = [
      asset(URL_A, "a", keyA),
      asset(URL_B, "b", keyA),
      asset(URL_C, "c", keyA),
    ];
    assets = unassignVisualAssets(assets, [URL_A, URL_B]);
    assert.equal(assetBy(assets, URL_A)?.visualSubjectKey, undefined);
    assert.equal(assetBy(assets, URL_B)?.visualSubjectKey, undefined);
    assert.equal(assetBy(assets, URL_C)?.visualSubjectKey, keyA);

    assets = assignAssetsToVisualSubject(assets, [URL_A, URL_B], keyB);
    assert.equal(assetBy(assets, URL_A)?.visualSubjectKey, keyB);
    assert.equal(assetBy(assets, URL_B)?.visualSubjectKey, keyB);
    assert.equal(assetBy(assets, URL_C)?.visualSubjectKey, keyA);
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

  it("unassigned assets cannot be representative images", () => {
    const key = createSimulationVisualSubjectKey();
    const candidate = { ...subject(MEMBER_A, key), representativeAssetUrl: URL_U };
    assert.equal(validateRepresentativeAsset(candidate, [asset(URL_U, "u")]), null);
    assert.equal(
      clearStaleRepresentativeAssets([candidate], [asset(URL_U, "u")])[0]
        ?.representativeAssetUrl,
      null
    );
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

  it("4-person regression: fourth subject keeps trusted saved appearance after ref cap", () => {
    const names = [MEMBER_A, MEMBER_B, MEMBER_C, "도윤"];
    const urls = [URL_A, URL_B, URL_C, URL_D];
    const subjects = names.map((name, index) =>
      subject(name, createSimulationVisualSubjectKey(), `appearance ${index + 1}`)
    );
    const assets = subjects.map((row, index) =>
      asset(urls[index]!, `asset ${index + 1}`, row.subjectKey)
    );
    const intent: ChatImageCastIntentManifest = {
      compositionGoal: "ensemble_scene",
      subjects: [
        {
          key: "persona",
          role: "persona",
          name: "나",
          included: false,
          importance: "primary",
          visibility: "required_visible",
        },
        ...names.map((name, index) => ({
          key: `supporting:${name}`,
          role: "supporting_character" as const,
          name,
          included: true,
          importance: "primary" as const,
          visibility: "required_visible" as const,
          requestedReferenceAssetUrl: urls[index],
        })),
      ],
    };
    const grounded = groundCastIntent(intent, simGroundCtx(subjects, assets), undefined, "simulation");
    assert.equal(grounded.ok, true);
    if (!grounded.ok) throw new Error(grounded.reason);
    const bound = bindApprovedCastManifest(grounded.manifest, {
      contentKind: "simulation",
    });
    assert.equal(bound.selected.length, 4);
    assert.equal(bound.referenceUrls.length, 3);
    const fourth = bound.subjects.find((row) => row.name === "도윤");
    assert.equal(fourth?.referenceIndex, null);
    assert.equal(fourth?.savedAppearance, "appearance 4");
    assert.equal(fourth?.trustedSavedAppearance, true);
    const fidelity = renderCastFidelityTiers(bound.selected, bound.subjects);
    assert.match(fidelity, /도윤: Saved appearance only; no photo attached/);
    assert.doesNotMatch(fidelity, /도윤: BACKGROUND \/ CAMEO\. No bound identity evidence/);
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
