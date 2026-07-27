import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeCharacterAlbumAssets } from "./characterAssetUnlocks";

describe("character album generated assets", () => {
  it("keeps canonical assets and preserves generated images without duplicates", () => {
    assert.deepEqual(
      mergeCharacterAlbumAssets(
        [
          { url: "/uploads/representative.webp", tag: "대표" },
          { url: "/uploads/expression.webp", tag: "웃음" },
        ],
        [
          { url: "/uploads/ai-comic.webp", tag: "AI 4컷 만화" },
          { url: "/uploads/representative.webp", tag: "중복" },
        ]
      ),
      [
        { url: "/uploads/representative.webp", tag: "대표" },
        { url: "/uploads/expression.webp", tag: "웃음" },
        { url: "/uploads/ai-comic.webp", tag: "AI 4컷 만화" },
      ]
    );
  });

  it("lets a newly generated image lead the stored generated album", () => {
    assert.deepEqual(
      mergeCharacterAlbumAssets(
        [{ url: "/uploads/new.webp", tag: "AI SD 굿즈" }],
        [{ url: "/uploads/old.webp", tag: "AI 2컷 만화" }]
      ),
      [
        { url: "/uploads/new.webp", tag: "AI SD 굿즈" },
        { url: "/uploads/old.webp", tag: "AI 2컷 만화" },
      ]
    );
  });
});
