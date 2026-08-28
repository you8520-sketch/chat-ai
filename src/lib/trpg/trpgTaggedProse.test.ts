import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isWideInlineAsset, withAssetSize } from "@/lib/characterAssets";
import { splitProseForInlineAssets } from "@/lib/inlineTaggedAssets";
import { splitTrpgGmProseForAssets, visibleTrpgGmProse } from "./trpgTaggedProse";

const portrait = withAssetSize({ url: "/tae-anger.webp", tag: "분노", chat: true }, 800, 1200);
const landscapeChar = withAssetSize({ url: "/tae-wide.webp", tag: "전투", chat: true }, 1600, 900);
const scenarioWide = withAssetSize({ url: "/hall.webp", tag: "대합실", chat: true }, 1600, 900);
const scenarioPortrait = withAssetSize({ url: "/cover.webp", tag: "표지", chat: true }, 800, 1200);

describe("TRPG tagged GM prose", () => {
  it("T. accepts a portrait character asset on the TRPG renderer path", () => {
    const parts = splitTrpgGmProseForAssets("태현이 이를 악문다.\n[캐릭터에셋: 12|분노]\n문이 운다.", {
      scenarioAssets: [scenarioWide],
      characterCatalog: [{ participantId: 12, characterId: 15, creatorUserId: null, name: "권태현", assets: [portrait] }],
      campaignId: 9,
      roundNumber: 3,
    });
    const image = parts.find((part) => part.kind === "character");
    assert.equal(image?.kind, "character");
    if (image?.kind !== "character") throw new Error("expected character part");
    assert.equal(image.asset.url, "/tae-anger.webp");
    assert.equal(isWideInlineAsset(image.asset), false);
    const renderer = readFileSync("src/components/TrpgCharacterSceneAsset.tsx", "utf8");
    assert.match(renderer, /data-testid="trpg-character-scene-asset"/);
    assert.match(renderer, /max-w-\[min\(16rem,72vw\)\]/);
    assert.doesNotMatch(renderer, /isWideInlineAsset\(asset\) \? "my-3 w-full"/);
  });

  it("U. still refuses a scenario portrait on the scenario path", () => {
    const parts = splitTrpgGmProseForAssets("[태그: 표지]\n[태그: 대합실]", {
      scenarioAssets: [scenarioPortrait, scenarioWide],
      campaignId: 9,
      roundNumber: 3,
    });
    assert.equal(parts.some((part) => part.kind === "scenario" && part.asset.url === "/cover.webp"), false);
    assert.equal(parts.some((part) => part.kind === "scenario" && part.asset.url === "/hall.webp"), true);
  });

  it("V. does not change global chat inline splitting", () => {
    const parts = splitProseForInlineAssets("본문\n[태그: 분노]\n[태그: 전투]", [portrait, landscapeChar]);
    assert.equal(parts.some((part) => part.kind === "image" && part.asset.url === "/tae-anger.webp"), false);
    assert.equal(parts.some((part) => part.kind === "image" && part.asset.url === "/tae-wide.webp"), true);
  });

  it("W. keeps the same shared-tag character image across rerender logic", () => {
    const catalog = [{
      participantId: 12,
      characterId: 15,
      name: "권태현",
      assets: [
        withAssetSize({ url: "/anger-a.webp", tag: "분노", chat: true }, 800, 1200),
        withAssetSize({ url: "/anger-b.webp", tag: "분노", chat: true }, 800, 1200),
      ],
    }];
    const first = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
    });
    const second = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
    });
    const urlA = first.find((part) => part.kind === "character");
    const urlB = second.find((part) => part.kind === "character");
    assert.ok(urlA && urlA.kind === "character");
    assert.ok(urlB && urlB.kind === "character");
    assert.equal(urlA.asset.url, urlB.asset.url);
  });

  it("X. drops malformed markers from visible prose", () => {
    const parts = splitTrpgGmProseForAssets("앞.\n[캐릭터에셋: 화남]\n[태그: 없는장면]\n뒤.", {
      scenarioAssets: [scenarioWide],
      characterCatalog: [{ participantId: 12, characterId: 15, creatorUserId: null, name: "권태현", assets: [portrait] }],
      campaignId: 9,
      roundNumber: 3,
    });
    const text = parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
    assert.doesNotMatch(text, /캐릭터에셋/);
    assert.doesNotMatch(text, /\[태그:/);
    assert.match(text, /앞/);
    assert.match(text, /뒤/);
    assert.equal(visibleTrpgGmProse("[캐릭터에셋: 12|분노] 문이 운다.").includes("캐릭터에셋"), false);
  });

  it("LOCKED_BLURRED_ASSET_NOT_RENDERED while unlocked asset renders", () => {
    const locked = withAssetSize(
      { url: "/locked.webp", tag: "분노", chat: true, viewerBlur: true },
      800,
      1200
    );
    const unlocked = withAssetSize(
      { url: "/open.webp", tag: "분노", chat: true, viewerBlur: false },
      800,
      1200
    );
    const lockedOnlyCatalog = [
      {
        participantId: 12,
        characterId: 15,
        creatorUserId: 99,
        name: "권태현",
        assets: [locked],
      },
    ];
    const lockedOnly = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: lockedOnlyCatalog,
      campaignId: 9,
      roundNumber: 3,
      viewerUserId: 1,
      unlockedUrlsByCharacterId: new Map([[15, new Set()]]),
    });
    assert.equal(lockedOnly.some((part) => part.kind === "character"), false, "LOCKED_BLURRED_ASSET_NOT_RENDERED");
    const catalog = [
      {
        participantId: 12,
        characterId: 15,
        creatorUserId: 99,
        name: "권태현",
        assets: [locked, unlocked],
      },
    ];
    const unlockedPick = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
      viewerUserId: 1,
      unlockedUrlsByCharacterId: new Map([[15, new Set(["/locked.webp"])]]),
    });
    const rendered = unlockedPick.find((part) => part.kind === "character");
    assert.equal(rendered?.kind, "character");
    if (rendered?.kind === "character") {
      assert.equal(rendered.asset.url, "/locked.webp", "UNLOCKED_ASSET_RENDERED");
    }
    const publicPick = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
      viewerUserId: 1,
      unlockedUrlsByCharacterId: new Map([[15, new Set()]]),
    });
    const publicRendered = publicPick.find((part) => part.kind === "character");
    assert.equal(publicRendered?.kind, "character");
    if (publicRendered?.kind === "character") {
      assert.equal(publicRendered.asset.url, "/open.webp", "PUBLIC_REPRESENTATIVE_RENDERED");
    }
  });
});
