import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  GALLERY_STRIP_LANDSCAPE_IMG_CLASS,
  galleryStripImgClassName,
  safeLockedPreviewUrl,
  shouldBlurAssetForViewer,
  type CharacterAsset,
} from "@/lib/characterAssets";

const PREVIEW = readFileSync(new URL("../../src/components/CharacterPublicPagePreview.tsx", import.meta.url), "utf8");
const ASSET_IMAGE = readFileSync(new URL("../../src/components/CharacterAssetImage.tsx", import.meta.url), "utf8");
const LIGHTBOX = readFileSync(new URL("../../src/components/CharacterAssetGalleryLightbox.tsx", import.meta.url), "utf8");
const MEDIA_ACCESS = readFileSync(new URL("../../src/lib/mediaAccess.ts", import.meta.url), "utf8");

describe("gallery strip crop owner (#1376)", () => {
  it("reproduces the 3:2-in-2:3 crop and requires contain only on the strip", () => {
    assert.match(
      ASSET_IMAGE,
      /imgClassName = "block aspect-\[3\/4\] w-full object-cover object-top"/
    );
    assert.match(PREVIEW, /galleryStripImgClassName/);
    assert.match(PREVIEW, /imgClassName=\{imgClassName\}/);
    assert.match(PREVIEW, /CHARACTER_THUMB_ASPECT/);
    assert.match(PREVIEW, /w-\[4\.75rem\]/);
    assert.match(PREVIEW, /sm:w-\[5\.25rem\]/);
    assert.doesNotMatch(PREVIEW, /<CharacterAssetImage src=\{previewSrc\} alt=\{alt\} \/>/);
    assert.doesNotMatch(PREVIEW, /<CharacterAssetImage src=\{asset\.url\} alt=\{alt\} \/>/);
    assert.match(LIGHTBOX, /object-contain/);
  });

  it("keeps lock/blur routing on the strip and does not change media projection", () => {
    assert.match(PREVIEW, /shouldBlurAssetForViewer/);
    assert.match(PREVIEW, /safeLockedPreviewUrl/);
    assert.match(MEDIA_ACCESS, /export function projectAssetsForViewer/);
    assert.match(MEDIA_ACCESS, /blurPreviewUrl/);
    const locked: CharacterAsset = {
      url: "/uploads/hidden-rp.webp",
      tag: "잠금",
      width: 1536,
      height: 1024,
      orientation: "landscape",
      viewerBlur: true,
      blurPreviewUrl: "/media/public/hidden-rp-blur.webp",
    };
    assert.equal(shouldBlurAssetForViewer(locked, false, new Set()), true);
    assert.equal(shouldBlurAssetForViewer(locked, true, new Set()), false);
    assert.equal(shouldBlurAssetForViewer(locked, false, new Set([locked.url])), false);
    assert.equal(safeLockedPreviewUrl(locked), "/media/public/hidden-rp-blur.webp");
    assert.equal(galleryStripImgClassName(locked), GALLERY_STRIP_LANDSCAPE_IMG_CLASS);
  });
});
