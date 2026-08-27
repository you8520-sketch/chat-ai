import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  normalizeCharacterAssets,
  reorderCharacterAssets,
  toggleCharacterAssetViewerBlur,
  updateCharacterAssetTag,
} from "@/lib/characterAssets";
import { parseCharacterFormBody } from "@/lib/characterFormSave";
import {
  assignAssetsToVisualSubject,
  createSimulationVisualSubjectKey,
  parseSimulationVisualSubjectsJson,
  prepareSimulationVisualSubjectsForSave,
  serializeSimulationVisualSubjectsJson,
  unassignVisualAssets,
  unassignedVisualAssets,
} from "@/lib/simulationVisualSubjects";

const adultCreator = { id: 1, nickname: "creator", is_adult: 1 as const };

/** Mirrors CreateCharacter AssetManagerGrid onChange normalization boundary. */
function creatorNormalizeAssets<T extends { url: string; tag: string }>(assets: T[]) {
  return normalizeCharacterAssets(assets);
}

function simulationBody(overrides: Record<string, unknown> = {}) {
  return {
    content_kind: "simulation",
    name: "생존 시뮬레이션",
    tagline: "테스트 시뮬레이션",
    description: "설명",
    greeting: "시작합니다.",
    simulation_cast: `[김태환]\n외형: 검은 머리\n[김성찬]\n외형: 회색 눈\n${"상황 설정 ".repeat(80)}`,
    simulation_rules: "",
    world: "폐허가 된 도시의 생존 세계관. ".repeat(100),
    genres: ["시뮬레이션"],
    nsfw: false,
    participant_min_age: 20,
    ...overrides,
  };
}

describe("simulation creator asset normalization boundary", () => {
  it("preserves visualSubjectKey after individual assignment and creator normalization", () => {
    const keyA = createSimulationVisualSubjectKey();
    const urlA = "/uploads/a.webp";
    let assets = creatorNormalizeAssets([{ url: urlA, tag: "표정 A" }]);
    assets = creatorNormalizeAssets(assignAssetsToVisualSubject(assets, [urlA], keyA));
    assert.equal(assets[0]?.visualSubjectKey, keyA);
  });

  it("preserves visualSubjectKey after bulk assignment and creator normalization", () => {
    const keyA = createSimulationVisualSubjectKey();
    const keyB = createSimulationVisualSubjectKey();
    const urls = ["/uploads/a.webp", "/uploads/b.webp", "/uploads/c.webp", "/uploads/d.webp"].map(
      (url, index) => ({ url, tag: `표정 ${index + 1}` })
    );
    let assets = creatorNormalizeAssets(urls);
    assets = creatorNormalizeAssets(
      assignAssetsToVisualSubject(assets, ["/uploads/a.webp", "/uploads/b.webp"], keyA)
    );
    assets = creatorNormalizeAssets(
      assignAssetsToVisualSubject(assets, ["/uploads/c.webp", "/uploads/d.webp"], keyB)
    );
    assert.equal(assets.find((asset) => asset.url === "/uploads/a.webp")?.visualSubjectKey, keyA);
    assert.equal(assets.find((asset) => asset.url === "/uploads/b.webp")?.visualSubjectKey, keyA);
    assert.equal(assets.find((asset) => asset.url === "/uploads/c.webp")?.visualSubjectKey, keyB);
    assert.equal(assets.find((asset) => asset.url === "/uploads/d.webp")?.visualSubjectKey, keyB);
    assert.equal(unassignedVisualAssets(assets).length, 0);
  });

  it("clears visualSubjectKey after unassign and creator normalization", () => {
    const keyA = createSimulationVisualSubjectKey();
    let assets = creatorNormalizeAssets([
      { url: "/uploads/a.webp", tag: "A", visualSubjectKey: keyA },
      { url: "/uploads/b.webp", tag: "B", visualSubjectKey: keyA },
    ]);
    assets = creatorNormalizeAssets(unassignVisualAssets(assets, ["/uploads/a.webp"]));
    assert.equal(assets.find((asset) => asset.url === "/uploads/a.webp")?.visualSubjectKey, undefined);
    assert.equal(assets.find((asset) => asset.url === "/uploads/b.webp")?.visualSubjectKey, keyA);
  });

  it("preserves visualSubjectKey through tag edit, reorder, blur, and upload completion", () => {
    const keyA = createSimulationVisualSubjectKey();
    let assets = creatorNormalizeAssets([
      { url: "/uploads/a.webp", tag: "A", visualSubjectKey: keyA, viewerBlur: false },
      { url: "/uploads/b.webp", tag: "B", visualSubjectKey: keyA, viewerBlur: true },
    ]);
    assets = creatorNormalizeAssets(updateCharacterAssetTag(assets, 1, "전투"));
    assets = creatorNormalizeAssets(reorderCharacterAssets(assets, 1, 0));
    assets = creatorNormalizeAssets(toggleCharacterAssetViewerBlur(assets, 1));
    assets = creatorNormalizeAssets([
      ...assets,
      {
        url: "/uploads/c.webp",
        tag: "업로드",
        visualSubjectKey: keyA,
        width: 800,
        height: 1200,
        orientation: "portrait" as const,
      },
    ]);
    assert.equal(assets.every((asset) => asset.visualSubjectKey === keyA), true);
    assert.equal(assets[0]?.tag, "전투");
    const uploaded = assets.find((asset) => asset.url === "/uploads/c.webp");
    assert.equal(uploaded?.width, 800);
    assert.equal(uploaded?.orientation, "portrait");
  });

  it("save/reload keeps 4+4 visual subject ownership through form boundary", () => {
    const keyA = createSimulationVisualSubjectKey();
    const keyB = createSimulationVisualSubjectKey();
    const assets = [
      ...["/uploads/a.webp", "/uploads/b.webp", "/uploads/c.webp", "/uploads/d.webp"].map((url, index) => ({
        url,
        tag: `김태환 ${index + 1}`,
        visualSubjectKey: keyA,
      })),
      ...["/uploads/e.webp", "/uploads/f.webp", "/uploads/g.webp", "/uploads/h.webp"].map((url, index) => ({
        url,
        tag: `김성찬 ${index + 1}`,
        visualSubjectKey: keyB,
      })),
    ];
    const submitted = {
      version: 1 as const,
      subjects: [
        {
          subjectKey: keyA,
          name: "김태환",
          savedAppearance: "검은 머리",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
        {
          subjectKey: keyB,
          name: "김성찬",
          savedAppearance: "회색 눈",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    };

    const parsed = parseCharacterFormBody(
      simulationBody({
        assets: creatorNormalizeAssets(assets),
        simulation_visual_subjects: submitted,
      }),
      adultCreator
    );
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    if (!parsed.ok) throw new Error(parsed.error);

    const savedAssets = parsed.data.assets;
    assert.equal(savedAssets.filter((asset) => asset.visualSubjectKey === keyA).length, 4);
    assert.equal(savedAssets.filter((asset) => asset.visualSubjectKey === keyB).length, 4);
    assert.equal(unassignedVisualAssets(savedAssets).length, 0);

    const reloaded = parseCharacterFormBody(
      simulationBody({
        assets: savedAssets,
        simulation_visual_subjects: parseSimulationVisualSubjectsJson(
          parsed.data.simulationVisualSubjectsJson
        ),
      }),
      adultCreator,
      {
        requireStructuredAge: false,
        trustedStoredSimulationVisualSubjectsJson: parsed.data.simulationVisualSubjectsJson,
      }
    );
    assert.equal(reloaded.ok, true, reloaded.ok ? undefined : reloaded.error);
    if (!reloaded.ok) throw new Error(reloaded.error);
    assert.equal(
      reloaded.data.assets.filter((asset) => asset.visualSubjectKey === keyA).length,
      4
    );
    assert.equal(
      reloaded.data.assets.filter((asset) => asset.visualSubjectKey === keyB).length,
      4
    );
    assert.equal(unassignedVisualAssets(reloaded.data.assets).length, 0);
  });
});

describe("simulation appearance explicit clear boundary", () => {
  it("keeps stored appearance without heading, replaces with heading, and clears on empty heading", () => {
    const key = createSimulationVisualSubjectKey();
    const stored = serializeSimulationVisualSubjectsJson({
      version: 1,
      subjects: [
        {
          subjectKey: key,
          name: "김태환",
          savedAppearance: "흰 머리",
          representativeAssetUrl: null,
          sourceCharacterId: null,
        },
      ],
    });

    const noHeading = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[김태환]\n성격: 냉정함`,
      simulationTitle: "생존",
      submittedRaw: stored,
      storedRaw: stored,
      assets: [],
    });
    assert.equal(noHeading.subjects[0]?.savedAppearance, "흰 머리");

    const replace = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[김태환]\n외형: 검은 머리`,
      simulationTitle: "생존",
      submittedRaw: stored,
      storedRaw: stored,
      assets: [],
    });
    assert.equal(replace.subjects[0]?.savedAppearance, "검은 머리");

    const explicitClear = prepareSimulationVisualSubjectsForSave({
      simulationCast: `[김태환]\n외형:\n성격: 냉정함`,
      simulationTitle: "생존",
      submittedRaw: stored,
      storedRaw: stored,
      assets: [],
    });
    assert.equal(explicitClear.subjects[0]?.savedAppearance, "");
  });
});
