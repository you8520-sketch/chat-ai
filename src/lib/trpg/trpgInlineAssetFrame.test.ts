import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { galleryStripImgClassName, isWideInlineAsset, withAssetSize, type CharacterAsset } from "@/lib/characterAssets";
import { CHAT_INLINE_ASSET_FIGURE_CLASS, CHAT_INLINE_ASSET_IMG_CLASS } from "@/lib/chatDisplayPrefs";
import { splitProseForInlineAssets } from "@/lib/inlineTaggedAssets";
import { enforceGmSceneAssetMarkers } from "./gmSceneAssets";
import { splitTrpgGmProseForAssets } from "./trpgTaggedProse";
import {
  TRPG_INLINE_IMG_CLASS,
  TRPG_INLINE_LANDSCAPE_FIGURE_CLASS,
  TRPG_INLINE_PORTRAIT_FIGURE_CLASS,
  TRPG_INLINE_PORTRAIT_HEIGHT_CAP,
  TRPG_INLINE_SQUARE_FIGURE_CLASS,
  TRPG_INLINE_SQUARE_HEIGHT_CAP,
  trpgInlineAssetFrame,
  trpgInlineRenderedBox,
} from "./trpgInlineAssetFrame";

const wide = withAssetSize({ url: "/hall.webp", tag: "대합실", chat: true }, 1600, 900);
const portrait = withAssetSize({ url: "/cover.webp", tag: "표지", chat: true }, 800, 1200);
const square = withAssetSize({ url: "/square.webp", tag: "광장", chat: true }, 1000, 1000);
const tall = withAssetSize({ url: "/poster.webp", tag: "포스터", chat: true }, 900, 1600);
const extreme = withAssetSize({ url: "/strip.webp", tag: "좁은길", chat: true }, 300, 2400);
const unknown: CharacterAsset = { url: "/mystery.webp", tag: "미상", chat: true };

function scenarioParts(text: string, assets: CharacterAsset[], extra?: { streaming?: boolean }) {
  return splitTrpgGmProseForAssets(text, {
    scenarioAssets: assets,
    campaignId: 9,
    roundNumber: 4,
    streaming: extra?.streaming,
  });
}

function urls(text: string, assets: CharacterAsset[]) {
  return scenarioParts(text, assets)
    .filter((part) => part.kind === "scenario")
    .map((part) => (part.kind === "scenario" ? part.asset.url : ""));
}

describe("TRPG inline asset frame", () => {
  it("keeps one size policy and does not restyle global chat frames", () => {
    assert.match(TRPG_INLINE_PORTRAIT_FIGURE_CLASS, /200px/);
    assert.match(TRPG_INLINE_PORTRAIT_FIGURE_CLASS, /240px/);
    assert.match(TRPG_INLINE_PORTRAIT_FIGURE_CLASS, /30svh/);
    assert.match(TRPG_INLINE_SQUARE_FIGURE_CLASS, /220px/);
    assert.match(TRPG_INLINE_SQUARE_FIGURE_CLASS, /280px/);
    assert.match(TRPG_INLINE_SQUARE_FIGURE_CLASS, /32svh/);
    assert.match(TRPG_INLINE_LANDSCAPE_FIGURE_CLASS, /w-full/);
    assert.match(TRPG_INLINE_IMG_CLASS, /object-contain/);
    assert.doesNotMatch(TRPG_INLINE_IMG_CLASS, /object-cover/);
    assert.equal(CHAT_INLINE_ASSET_FIGURE_CLASS, "my-3 mx-auto w-full max-w-[20rem] min-[576px]:max-w-full");
    assert.match(CHAT_INLINE_ASSET_IMG_CLASS, /object-contain/);
    assert.doesNotMatch(readFileSync("src/lib/inlineTaggedAssets.ts", "utf8"), /trpgInlineAssetFrame/);
    assert.doesNotMatch(readFileSync("src/lib/trpg/trpgTaggedProse.ts", "utf8"), /isWideInlineAsset/);
    assert.match(
      readFileSync("src/app/trpg/inline-asset-frame-lab/page.tsx", "utf8"),
      /isScrollFollowLabHarnessEnabled/
    );
    for (const file of [
      "src/components/ChatAssetAlbumModal.tsx",
      "src/components/CharacterAssetGalleryLightbox.tsx",
      "src/components/CharacterPublicPagePreview.tsx",
      "src/components/AssetManagerGrid.tsx",
    ]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /trpgInlineAssetFrame/);
    }
  });

  it("A-E. reserves landscape, square, portrait, and a safe unknown frame", () => {
    assert.equal(trpgInlineAssetFrame(wide).kind, "landscape");
    assert.equal(trpgInlineAssetFrame(square).kind, "square");
    assert.equal(trpgInlineAssetFrame(portrait).kind, "portrait");
    assert.equal(trpgInlineAssetFrame(tall).kind, "portrait");
    assert.equal(trpgInlineAssetFrame(unknown).kind, "unknown");
    assert.equal(trpgInlineAssetFrame(wide).style?.aspectRatio, "1600 / 900");
    assert.equal(trpgInlineAssetFrame(unknown).style, undefined);
    assert.equal(trpgInlineAssetFrame({ ...wide, orientation: "portrait" }).kind, "landscape");
  });

  it("caps portrait height on a 360×740 phone and a 1440×900 desktop", () => {
    const phone = { viewportWidth: 360, viewportHeight: 740, columnWidth: 360 };
    const desktop = { viewportWidth: 1440, viewportHeight: 900, columnWidth: 768 };
    const phoneTall = trpgInlineRenderedBox({ asset: tall, ...phone });
    const desktopTall = trpgInlineRenderedBox({ asset: tall, ...desktop });
    assert.ok(phoneTall.height <= TRPG_INLINE_PORTRAIT_HEIGHT_CAP.mobilePx + 0.01);
    assert.ok(phoneTall.height <= phone.viewportHeight * 0.32);
    assert.ok(Math.abs(phoneTall.height - 200) < 0.01);
    assert.ok(Math.abs(phoneTall.width - 112.5) < 0.01);
    assert.ok(desktopTall.height <= TRPG_INLINE_PORTRAIT_HEIGHT_CAP.desktopPx + 0.01);
    assert.ok(Math.abs(desktopTall.height - 240) < 0.01);
    assert.ok(Math.abs(desktopTall.width - 135) < 0.01);
    const shortDesktop = trpgInlineRenderedBox({
      asset: tall,
      viewportWidth: 1440,
      viewportHeight: 600,
      columnWidth: 768,
    });
    assert.ok(Math.abs(shortDesktop.height - 180) < 0.01);
    const squarePhone = trpgInlineRenderedBox({ asset: square, ...phone });
    const squareDesktop = trpgInlineRenderedBox({ asset: square, ...desktop });
    assert.ok(Math.abs(squarePhone.height - TRPG_INLINE_SQUARE_HEIGHT_CAP.mobilePx) < 0.01);
    assert.ok(Math.abs(squareDesktop.height - TRPG_INLINE_SQUARE_HEIGHT_CAP.desktopPx) < 0.01);
    const landscape = trpgInlineRenderedBox({ asset: wide, ...desktop });
    assert.equal(landscape.width, 768);
    assert.ok(Math.abs(landscape.height - 432) < 0.01);
  });

  it("P. keeps an extreme vertical image inside the portrait height cap", () => {
    const box = trpgInlineRenderedBox({
      asset: extreme,
      viewportWidth: 360,
      viewportHeight: 740,
      columnWidth: 360,
    });
    assert.ok(Math.abs(box.height - 200) < 0.01);
    assert.ok(box.width < 40);
  });

  it("E. caps an unsized image from its intrinsic pixels and reserves nothing before load", () => {
    const before = trpgInlineRenderedBox({
      asset: unknown,
      viewportWidth: 360,
      viewportHeight: 740,
      columnWidth: 360,
    });
    assert.deepEqual(before, { kind: "unknown", width: 0, height: 0 });
    const after = trpgInlineRenderedBox({
      asset: unknown,
      viewportWidth: 360,
      viewportHeight: 740,
      columnWidth: 360,
      intrinsicWidth: 900,
      intrinsicHeight: 1600,
    });
    assert.ok(Math.abs(after.height - 200) < 0.01);
    assert.ok(after.width < 130);
  });

  it("F-G. mixes portrait and landscape under one tag and stays stable for one seed", () => {
    const mixed = [
      withAssetSize({ url: "/mix-portrait.webp", tag: "현장", chat: true }, 800, 1200),
      withAssetSize({ url: "/mix-wide.webp", tag: "현장", chat: true }, 1600, 900),
    ];
    const first = urls("[태그: 현장]", mixed);
    const second = urls("[태그: 현장]", mixed);
    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.ok(first[0] === "/mix-portrait.webp" || first[0] === "/mix-wide.webp");
  });

  it("H. drops moderationReject and keeps a playable sibling", () => {
    const rejected = withAssetSize(
      { url: "/reject.webp", tag: "표지", chat: true, moderationReject: true },
      800,
      1200
    );
    const picked = urls("[태그: 표지]", [rejected, portrait]);
    assert.deepEqual(picked, ["/cover.webp"]);
    assert.deepEqual(urls("[태그: 표지]", [rejected]), []);
  });

  it("I. still blurs scenario images in the part list and hides locked character images", () => {
    const lockedScenario = withAssetSize(
      { url: "/locked-scene.webp", tag: "표지", chat: true, viewerBlur: true },
      800,
      1200
    );
    const scene = scenarioParts("[태그: 표지]", [lockedScenario]);
    assert.equal(scene.some((part) => part.kind === "scenario" && part.asset.viewerBlur === true), true);
    const lockedCharacter = withAssetSize(
      { url: "/locked-face.webp", tag: "분노", chat: true, viewerBlur: true },
      800,
      1200
    );
    const hidden = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: [{ participantId: 12, characterId: 15, viewerIsCreator: false, name: "권태현", assets: [lockedCharacter] }],
      campaignId: 9,
      roundNumber: 4,
      unlockedUrlsByCharacterId: new Map([[15, new Set<string>()]]),
    });
    assert.equal(hidden.some((part) => part.kind === "character"), false);
    const creator = splitTrpgGmProseForAssets("[캐릭터에셋: 12|분노]", {
      scenarioAssets: [],
      characterCatalog: [{ participantId: 12, characterId: 15, viewerIsCreator: true, name: "권태현", assets: [lockedCharacter] }],
      campaignId: 9,
      roundNumber: 4,
    });
    assert.equal(creator.some((part) => part.kind === "character"), true);
  });

  it("J. keeps the GM image quota for portrait scenario tags", () => {
    const assets = [portrait, tall, square];
    const enforced = enforceGmSceneAssetMarkers("[태그: 표지]\n[태그: 포스터]\n[태그: 광장]", {
      aiParticipantIds: new Set(),
      characterTagsByParticipant: new Map(),
      scenarioTags: new Set(["표지", "포스터", "광장"]),
    });
    assert.equal(enforced.kept.length, 2);
    const rendered = urls(enforced.text, assets);
    assert.equal(rendered.length, 2);
    assert.deepEqual(rendered, ["/cover.webp", "/poster.webp"]);
  });

  it("K-L. strips malformed and unknown markers without deleting the prose", () => {
    const parts = scenarioParts("앞 서술.\n[태그: broken\n[태그: 없는곳]\n오영감: \"뒤 대사.\"", [portrait, wide]);
    const text = parts.map((part) => (part.kind === "text" ? part.text : "")).join("");
    assert.equal(parts.some((part) => part.kind === "scenario"), false);
    assert.match(text, /앞 서술/);
    assert.match(text, /뒤 대사/);
    assert.doesNotMatch(text, /\[태그:/);
  });

  it("M. hides a partial scenario marker while streaming and shows the final portrait", () => {
    const partial = scenarioParts("승강장.\n[태그: 표", [portrait], { streaming: true });
    assert.equal(partial.some((part) => part.kind === "scenario"), false);
    assert.match(partial.map((part) => (part.kind === "text" ? part.text : "")).join(""), /승강장/);
    const finalParts = scenarioParts("승강장.\n[태그: 표지]", [portrait], { streaming: false });
    assert.deepEqual(urls("승강장.\n[태그: 표지]", [portrait]), ["/cover.webp"]);
    assert.equal(finalParts.some((part) => part.kind === "scenario"), true);
  });

  it("S-T. leaves chat inline splitting, gallery crop, and album owners alone", () => {
    const chatPortrait = withAssetSize({ url: "/chat-tall.webp", tag: "분노", chat: true }, 800, 1200);
    const chatWide = withAssetSize({ url: "/chat-wide.webp", tag: "전투", chat: true }, 1600, 900);
    const parts = splitProseForInlineAssets("본문\n[태그: 분노]\n[태그: 전투]", [chatPortrait, chatWide]);
    assert.equal(parts.some((part) => part.kind === "image" && part.asset.url === "/chat-tall.webp"), false);
    assert.equal(parts.some((part) => part.kind === "image" && part.asset.url === "/chat-wide.webp"), true);
    assert.equal(isWideInlineAsset(chatPortrait), false);
    assert.equal(isWideInlineAsset(chatWide), true);
    assert.equal(isWideInlineAsset({}), false);
    assert.match(galleryStripImgClassName(chatPortrait), /object-cover/);
    assert.match(galleryStripImgClassName(chatWide), /object-contain/);
  });

  it("drops a non-chat portrait even when it is the only match", () => {
    const hidden = withAssetSize({ url: "/no-chat.webp", tag: "표지", chat: false }, 800, 1200);
    assert.deepEqual(urls("[태그: 표지]", [hidden, portrait]), ["/cover.webp"]);
  });
});
