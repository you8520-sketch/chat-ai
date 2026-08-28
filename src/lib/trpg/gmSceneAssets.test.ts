import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withAssetSize } from "@/lib/characterAssets";
import {
  CHARACTER_TAG_PAIR_MAX,
  MAX_IMAGES_PER_GM_SCENE,
  MAX_SCENARIO_IMAGES_WITH_AI,
  MAX_SCENARIO_IMAGES_WITHOUT_AI,
  buildAiCharacterImageTagCatalog,
  enforceGmSceneAssetMarkers,
  gmCatalogTrpgCharacterAssets,
  isTrpgCharacterAssetVisibleToViewer,
  selectStableTaggedAsset,
  selectStableViewerVisibleTaggedAsset,
  uniqueCharacterAssetTags,
  viewerVisibleTrpgCharacterAssets,
} from "./gmSceneAssets";
import { filterTrpgCharacterCatalogForViewer } from "./aiCharacterContext";
import { playableScenarioAssets } from "./scenarioAssets";

function enforce(
  narration: string,
  opts?: {
    aiIds?: number[];
    characterTags?: Array<[number, string[]]>;
    scenarioTags?: string[];
  }
) {
  return enforceGmSceneAssetMarkers(narration, {
    aiParticipantIds: new Set(opts?.aiIds ?? [12, 13]),
    characterTagsByParticipant: new Map(
      (opts?.characterTags ?? [
        [12, ["분노", "무표정"]],
        [13, ["분노", "웃음"]],
      ]).map(([id, tags]) => [id, new Set(tags)])
    ),
    scenarioTags: new Set(opts?.scenarioTags ?? ["대합실", "폐역"]),
  });
}

describe("TRPG GM scene asset budget", () => {
  it("I. namespaces the same tag across two characters", () => {
    const out = enforce("태현이 이를 악문다.\n[캐릭터에셋: 12|분노]\n이현도 같이 붉어진다.\n[캐릭터에셋: 13|분노]");
    assert.equal(out.kept.length, 2);
    assert.deepEqual(out.kept, [
      { kind: "character", participantId: 12, tag: "분노" },
      { kind: "character", participantId: 13, tag: "분노" },
    ]);
    assert.match(out.text, /\[캐릭터에셋: 12\|분노\]/);
    assert.match(out.text, /\[캐릭터에셋: 13\|분노\]/);
  });

  it("J. strips an unknown character tag", () => {
    const out = enforce("그가 웃는다.\n[캐릭터에셋: 12|없는태그]\n그리고 문을 본다.");
    assert.equal(out.kept.length, 0);
    assert.doesNotMatch(out.text, /캐릭터에셋/);
    assert.doesNotMatch(out.text, /없는태그/);
  });

  it("K. strips an invalid participantId", () => {
    const out = enforce("장면.\n[캐릭터에셋: 99|분노]\n끝.");
    assert.equal(out.kept.length, 0);
    assert.doesNotMatch(out.text, /캐릭터에셋/);
    const human = enforce("장면.\n[캐릭터에셋: 1|분노]\n끝.", {
      aiIds: [12],
      characterTags: [[12, ["분노"]], [1, ["분노"]]],
    });
    assert.equal(human.kept.length, 0);
  });

  it("L. allows character + scenario when AI characters are present", () => {
    const out = enforce("[캐릭터에셋: 12|분노]\n대합실이 흔들린다.\n[태그: 대합실]");
    assert.equal(out.kept.length, 2);
    assert.equal(out.kept.filter((item) => item.kind === "scenario").length, 1);
    assert.equal(out.kept.filter((item) => item.kind === "character").length, 1);
  });

  it("M. allows two valid character assets when AI characters are present", () => {
    const out = enforce("[캐릭터에셋: 12|분노]\n[캐릭터에셋: 13|웃음]");
    assert.equal(out.kept.length, 2);
    assert.equal(out.kept.every((item) => item.kind === "character"), true);
  });

  it("N. rejects a second scenario image when AI characters are present", () => {
    const out = enforce("[태그: 대합실]\n[태그: 폐역]\n[캐릭터에셋: 12|분노]");
    assert.deepEqual(
      out.kept.map((item) => item.kind),
      ["scenario", "character"]
    );
    assert.doesNotMatch(out.text, /\[태그: 폐역\]/);
    assert.match(out.text, /\[태그: 대합실\]/);
  });

  it("O. allows two different scenario tags when no AI characters are present", () => {
    const out = enforce("[태그: 대합실]\n[태그: 폐역]", { aiIds: [], characterTags: [] });
    assert.equal(out.kept.length, 2);
    assert.match(out.text, /\[태그: 대합실\]/);
    assert.match(out.text, /\[태그: 폐역\]/);
  });

  it("P. rejects a third scenario image without AI characters", () => {
    const out = enforce("[태그: 대합실]\n[태그: 폐역]\n[태그: 옥상]", {
      aiIds: [],
      characterTags: [],
      scenarioTags: ["대합실", "폐역", "옥상"],
    });
    assert.equal(out.kept.length, 2);
    assert.doesNotMatch(out.text, /\[태그: 옥상\]/);
  });

  it("Q. keeps only one copy of the same character+tag pair", () => {
    const out = enforce("[캐릭터에셋: 12|분노]\n다시.\n[캐릭터에셋: 12|분노]");
    assert.equal(out.kept.length, 1);
    assert.equal((out.text.match(/\[캐릭터에셋: 12\|분노\]/g) ?? []).length, 1);
  });

  it("R. keeps only one copy of the same scenario tag", () => {
    const out = enforce("[태그: 대합실]\n또.\n[태그: 대합실]", { aiIds: [], characterTags: [] });
    assert.equal(out.kept.length, 1);
    assert.equal((out.text.match(/\[태그: 대합실\]/g) ?? []).length, 1);
  });

  it("S. does not auto-fill the image quota", () => {
    const out = enforce("대합실 안이 차갑고 태현은 분노한다.");
    assert.equal(out.kept.length, 0);
    assert.doesNotMatch(out.text, /\[태그:/);
    assert.doesNotMatch(out.text, /캐릭터에셋/);
    assert.match(out.text, /대합실 안이 차갑고/);
  });

  it("X. never leaves malformed or unknown control syntax visible", () => {
    const out = enforce("앞.\n[캐릭터에셋: 화남]\n[캐릭터에셋: 12]\n[캐릭터에셋: abc|분노]\n[태그: 없는장면]\n[내부마커: 비밀]\n뒤.");
    assert.doesNotMatch(out.text, /캐릭터에셋/);
    assert.doesNotMatch(out.text, /\[태그:/);
    assert.match(out.text, /\[내부마커: 비밀\]/);
    assert.match(out.text, /앞/);
    assert.match(out.text, /뒤/);
  });

  it("U. keeps the existing scenario landscape-only playable pool", () => {
    const assets = [
      withAssetSize({ url: "/cover.webp", tag: "표지" }, 800, 1200),
      withAssetSize({ url: "/hall.webp", tag: "대합실" }, 1600, 900),
    ];
    assert.deepEqual(
      playableScenarioAssets(assets).map((asset) => asset.tag),
      ["대합실"]
    );
  });

  it("deduplicates catalog tags and exposes budget constants", () => {
    assert.equal(MAX_IMAGES_PER_GM_SCENE, 2);
    assert.equal(MAX_SCENARIO_IMAGES_WITH_AI, 1);
    assert.equal(MAX_SCENARIO_IMAGES_WITHOUT_AI, 2);
    assert.equal(CHARACTER_TAG_PAIR_MAX, 1);
    assert.deepEqual(
      uniqueCharacterAssetTags([
        withAssetSize({ url: "/a.webp", tag: "분노" }, 800, 1200),
        withAssetSize({ url: "/b.webp", tag: "분노" }, 800, 1200),
        withAssetSize({ url: "/c.webp", tag: "전투" }, 800, 1200),
        { url: "/reject.webp", tag: "침실", chat: true, moderationReject: true },
      ]),
      ["분노", "전투"]
    );
    const catalog = buildAiCharacterImageTagCatalog([
      { participantId: 12, name: "권태현", tags: uniqueCharacterAssetTags([
        withAssetSize({ url: "/a.webp", tag: "분노" }, 800, 1200),
        withAssetSize({ url: "/b.webp", tag: "분노" }, 800, 1200),
      ]) },
    ]);
    assert.match(catalog, /tags=분노$/m);
    assert.doesNotMatch(catalog, /\/a\.webp/);
  });

  it("W. picks the same concrete image for a shared tag across reloads", () => {
    const assets = [
      withAssetSize({ url: "/anger-a.webp", tag: "분노" }, 800, 1200),
      withAssetSize({ url: "/anger-b.webp", tag: "분노" }, 800, 1200),
    ];
    const seed = "9:3:12:분노";
    const first = selectStableTaggedAsset(assets, "분노", seed);
    const second = selectStableTaggedAsset(assets, "분노", seed);
    assert.ok(first);
    assert.equal(first?.url, second?.url);
    const other = selectStableTaggedAsset(assets, "분노", "9:4:12:분노");
    assert.ok(other);
  });

  it("LOCKED_BLURRED_ASSET_NOT_IN_TRPG_CANDIDATES", () => {
    const publicAsset = withAssetSize({ url: "/public.webp", tag: "분노", chat: true, viewerBlur: false }, 800, 1200);
    const lockedAsset = withAssetSize({ url: "/locked.webp", tag: "분노", chat: true, viewerBlur: true }, 800, 1200);
    const visible = viewerVisibleTrpgCharacterAssets([publicAsset, lockedAsset], {
      viewerIsCreator: false,
      unlockedUrls: new Set(),
    });
    assert.equal(visible.length, 1);
    assert.equal(visible[0]?.url, "/public.webp");
    const tags = uniqueCharacterAssetTags(gmCatalogTrpgCharacterAssets([publicAsset, lockedAsset]));
    assert.deepEqual(tags, ["분노"]);
    const catalog = filterTrpgCharacterCatalogForViewer(
      [{ participantId: 12, characterId: 15, creatorUserId: 99, name: "권태현", assets: [publicAsset, lockedAsset] }],
      { viewerUserId: 1, unlockedUrlsByCharacterId: new Map([[15, new Set()]]) }
    );
    assert.equal(catalog[0]?.assets.length, 1);
    assert.equal(catalog[0]?.assets[0]?.url, "/public.webp");
  });

  it("UNLOCKED_AND_CREATOR_ASSETS_REMAIN_VISIBLE", () => {
    const lockedAsset = withAssetSize({ url: "/locked.webp", tag: "웃음", chat: true, viewerBlur: true }, 800, 1200);
    assert.equal(
      isTrpgCharacterAssetVisibleToViewer(lockedAsset, {
        viewerIsCreator: false,
        unlockedUrls: new Set(["/locked.webp"]),
      }),
      true
    );
    assert.equal(
      isTrpgCharacterAssetVisibleToViewer(lockedAsset, {
        viewerIsCreator: true,
        unlockedUrls: new Set(),
      }),
      true
    );
    const picked = selectStableViewerVisibleTaggedAsset(
      [lockedAsset],
      "웃음",
      "seed",
      { viewerIsCreator: true, unlockedUrls: new Set() }
    );
    assert.equal(picked?.url, "/locked.webp");
  });
});
