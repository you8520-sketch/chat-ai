import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withAssetSize } from "@/lib/characterAssets";
import {
  resolveTrpgCharacterAssetViewerContext,
  trpgCharacterSceneAssetWouldRender,
} from "./trpgCharacterAssetViewerContext";
import { splitTrpgGmProseForAssets } from "./trpgTaggedProse";

const locked = withAssetSize(
  { url: "/locked.webp", tag: "분노", chat: true, viewerBlur: true },
  800,
  1200
);
const open = withAssetSize(
  { url: "/open.webp", tag: "분노", chat: true, viewerBlur: false },
  800,
  1200
);

const catalog = [
  {
    participantId: 12,
    characterId: 15,
    viewerIsCreator: false,
    name: "권태현",
    assets: [locked, open],
  },
];

describe("TRPG character asset viewer context", () => {
  it("FINAL_RENDER_CONTEXT_ALIGNED across split and component gate", () => {
    const unlockedUrls = new Map<number, Set<string>>([[15, new Set(["/locked.webp"])]]);
    const ctx = resolveTrpgCharacterAssetViewerContext(catalog, 12, unlockedUrls);

    const lockedOnly = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: [{ ...catalog[0]!, assets: [locked] }],
      campaignId: 9,
      roundNumber: 3,
      unlockedUrlsByCharacterId: new Map([[15, new Set()]]),
    });
    assert.equal(lockedOnly.some((part) => part.kind === "character"), false, "LOCKED_NOT_UNLOCKED");
    assert.equal(
      trpgCharacterSceneAssetWouldRender(locked, catalog, 12, new Map([[15, new Set()]])),
      false,
      "LOCKED_ASSET_RENDER"
    );

    const unlockedSplit = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: catalog,
      campaignId: 9,
      roundNumber: 3,
      unlockedUrlsByCharacterId: unlockedUrls,
    });
    const unlockedPart = unlockedSplit.find((part) => part.kind === "character");
    assert.equal(unlockedPart?.kind, "character");
    if (unlockedPart?.kind === "character") {
      assert.equal(unlockedPart.asset.url, "/locked.webp", "LOCKED_BUT_UNLOCKED split");
      assert.equal(
        trpgCharacterSceneAssetWouldRender(unlockedPart.asset, catalog, 12, unlockedUrls),
        true,
        "UNLOCKED_ASSET_RENDER"
      );
    }

    const creatorCatalog = [{ ...catalog[0]!, viewerIsCreator: true, assets: [locked] }];
    const creatorSplit = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: creatorCatalog,
      campaignId: 9,
      roundNumber: 3,
      unlockedUrlsByCharacterId: new Map([[15, new Set()]]),
    });
    const creatorPart = creatorSplit.find((part) => part.kind === "character");
    assert.equal(creatorPart?.kind, "character", "LOCKED_BUT_CREATOR split");
    if (creatorPart?.kind === "character") {
      assert.equal(
        trpgCharacterSceneAssetWouldRender(creatorPart.asset, creatorCatalog, 12, new Map()),
        true,
        "CREATOR_ASSET_RENDER"
      );
    }

    const publicSplit = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: [{ ...catalog[0]!, assets: [open] }],
      campaignId: 9,
      roundNumber: 3,
      unlockedUrlsByCharacterId: new Map([[15, new Set()]]),
    });
    const publicPart = publicSplit.find((part) => part.kind === "character");
    assert.equal(publicPart?.kind, "character", "PUBLIC split");
    if (publicPart?.kind === "character") {
      assert.equal(
        trpgCharacterSceneAssetWouldRender(publicPart.asset, catalog, 12, new Map([[15, new Set()]])),
        true,
        "PUBLIC_ASSET_RENDER"
      );
    }

    assert.equal(ctx.viewerIsCreator, false);
    assert.deepEqual(ctx.unlockedUrls, new Set(["/locked.webp"]));
  });
});
