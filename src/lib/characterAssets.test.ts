import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignRepresentativeRanks,
  GALLERY_STRIP_LANDSCAPE_IMG_CLASS,
  GALLERY_STRIP_PORTRAIT_IMG_CLASS,
  galleryStripImgClassName,
  getCharacterRepresentativeImageUrl,
  getCharacterRepresentativePublicUrls,
  getDefaultChatAsset,
  isPortraitDisplayAsset,
  isPrivateMediaUrl,
  isWideInlineAsset,
  listingImageUrls,
  parseAssets,
  reorderCharacterAssets,
  toggleCharacterAssetViewerBlur,
  toggleRepresentativeAsset,
  updateCharacterAssetTag,
  withAssetSize,
} from "@/lib/characterAssets";

describe("asset orientation", () => {
  it("treats width > height as landscape inline", () => {
    assert.equal(isWideInlineAsset({ width: 1600, height: 900 }), true);
    assert.equal(isPortraitDisplayAsset({ width: 1600, height: 900 }), false);
  });

  it("treats tall and square as portrait display", () => {
    assert.equal(isWideInlineAsset({ width: 800, height: 1200 }), false);
    assert.equal(isWideInlineAsset({ width: 800, height: 800 }), false);
    assert.equal(isPortraitDisplayAsset({ orientation: "portrait" }), true);
  });

  it("treats unknown size as portrait so existing assets keep the left rail", () => {
    assert.equal(isWideInlineAsset({}), false);
    assert.equal(isPortraitDisplayAsset({}), true);
  });

  it("persists measured size through parseAssets", () => {
    const assets = parseAssets(
      JSON.stringify([{ url: "/uploads/wide.webp", tag: "거리", width: 1920, height: 1080 }])
    );
    assert.equal(assets[0]?.orientation, "landscape");
    assert.equal(isWideInlineAsset(assets[0]!), true);
  });

  it("gallery strip contains 3:2 RP and keeps 2:3 representative/portrait cover", () => {
    const lucianRep = { url: "/uploads/official-rep.webp", tag: "녹금빛 거상", width: 1024, height: 1536, orientation: "portrait" as const };
    const lucianRp = { url: "/uploads/official-sig1.webp", tag: "계산하는 시선", width: 1536, height: 1024, orientation: "landscape" as const };
    const rankedLandscapeRep = {
      url: "/uploads/wide-card.webp",
      tag: "대표",
      width: 1536,
      height: 1024,
      orientation: "landscape" as const,
      representativeRank: 1,
    };
    const lockedLandscape = {
      url: "/uploads/hidden-rp.webp",
      tag: "잠금",
      width: 1536,
      height: 1024,
      orientation: "landscape" as const,
      viewerBlur: true,
    };
    assert.equal(galleryStripImgClassName(lucianRep), GALLERY_STRIP_PORTRAIT_IMG_CLASS);
    assert.equal(galleryStripImgClassName(lucianRp), GALLERY_STRIP_LANDSCAPE_IMG_CLASS);
    assert.match(galleryStripImgClassName(lucianRp), /object-contain/);
    assert.doesNotMatch(galleryStripImgClassName(lucianRp), /object-cover/);
    assert.equal(galleryStripImgClassName({ url: "/uploads/unknown.webp", tag: "없음" }), GALLERY_STRIP_PORTRAIT_IMG_CLASS);
    assert.equal(galleryStripImgClassName(rankedLandscapeRep), GALLERY_STRIP_PORTRAIT_IMG_CLASS);
    assert.equal(galleryStripImgClassName(lockedLandscape), GALLERY_STRIP_LANDSCAPE_IMG_CLASS);
  });

  it("picks a portrait default and skips landscape covers", () => {
    const assets = [
      withAssetSize({ url: "/wide.webp", tag: "거리" }, 1600, 900),
      withAssetSize({ url: "/tall.webp", tag: "미소" }, 800, 1200),
    ];
    const def = getDefaultChatAsset(assets);
    assert.equal(def?.url, "/tall.webp");
  });
});

describe("asset management metadata preservation", () => {
  it("preserves visualSubjectKey through tag, reorder, blur, and JSON roundtrip", () => {
    const subjectKey = "simvis_123e4567-e89b-42d3-a456-426614174000";
    let assets = [
      { url: "/a.webp", tag: "기본", visualSubjectKey: subjectKey, viewerBlur: false },
      { url: "/b.webp", tag: "미소", visualSubjectKey: subjectKey, viewerBlur: true },
    ];
    assets = updateCharacterAssetTag(assets, 1, "전투");
    assets = toggleCharacterAssetViewerBlur(assets, 1);
    assets = reorderCharacterAssets(assets, 1, 0);
    assert.equal(assets[0]?.visualSubjectKey, subjectKey);
    assert.equal(assets[0]?.tag, "전투");
    assert.equal(assets[0]?.viewerBlur, false);

    const reloaded = parseAssets(JSON.stringify(assets));
    assert.equal(reloaded.every((asset) => asset.visualSubjectKey === subjectKey), true);
  });
});

describe("representative ranks", () => {
  it("legacy lists without ranks expose only the first image", () => {
    const assets = parseAssets(
      JSON.stringify([
        { url: "/uploads/a.webp", tag: "기본" },
        { url: "/uploads/b.webp", tag: "숨김", viewerBlur: true },
      ])
    );
    assert.deepEqual(listingImageUrls(assets), ["/uploads/a.webp"]);
    assert.equal(getCharacterRepresentativeImageUrl(JSON.stringify(assets)), "/uploads/a.webp");
  });

  it("keeps 1 and 5 ranked public renditions and drops a 6th", () => {
    const ranked = assignRepresentativeRanks(
      [
        { url: "/uploads/1.webp", tag: "a", publicRenditionUrl: "/media/public/1-public.webp" },
        { url: "/uploads/2.webp", tag: "b", publicRenditionUrl: "/media/public/2-public.webp" },
        { url: "/uploads/3.webp", tag: "c", publicRenditionUrl: "/media/public/3-public.webp" },
        { url: "/uploads/4.webp", tag: "d", publicRenditionUrl: "/media/public/4-public.webp" },
        { url: "/uploads/5.webp", tag: "e", publicRenditionUrl: "/media/public/5-public.webp" },
        { url: "/uploads/6.webp", tag: "f", publicRenditionUrl: "/media/public/6-public.webp" },
      ],
      [0, 1, 2, 3, 4, 5]
    );
    assert.deepEqual(listingImageUrls(ranked), [
      "/media/public/1-public.webp",
      "/media/public/2-public.webp",
      "/media/public/3-public.webp",
      "/media/public/4-public.webp",
      "/media/public/5-public.webp",
    ]);
    assert.equal(ranked[5]?.representativeRank, undefined);
  });

  it("never returns private originals as card URLs", () => {
    const assets = parseAssets(
      JSON.stringify([
        {
          url: "/media/private/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.webp",
          tag: "기본",
          representativeRank: 1,
          publicRenditionUrl: "/media/public/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa-public.webp",
        },
        {
          url: "/media/private/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.webp",
          tag: "숨김",
          viewerBlur: true,
        },
      ])
    );
    const urls = getCharacterRepresentativePublicUrls(JSON.stringify(assets), "[]");
    assert.deepEqual(urls, ["/media/public/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa-public.webp"]);
    assert.equal(urls.some(isPrivateMediaUrl), false);
  });

  it("toggle representative adds then removes ranks", () => {
    let assets = [
      { url: "/uploads/a.webp", tag: "기본", viewerBlur: false },
      { url: "/uploads/b.webp", tag: "미소", viewerBlur: true },
    ];
    assets = toggleRepresentativeAsset(assets, 1);
    assert.equal(assets[1]?.representativeRank, 1);
    assets = toggleRepresentativeAsset(assets, 1);
    assert.equal(assets[1]?.representativeRank, undefined);
  });

  it("zero representatives fall back to legacy images[0] only", () => {
    assert.deepEqual(
      getCharacterRepresentativePublicUrls("[]", JSON.stringify(["/uploads/only.webp", "/uploads/hidden.webp"])),
      ["/uploads/only.webp"]
    );
  });
});
