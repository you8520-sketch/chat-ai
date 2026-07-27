import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveSelectableCharacterImages,
  selectCharacterImageUrl,
} from "./chatCharacterImageSelection";

const assets = [
  { url: "/default.webp", tag: "대화", chat: true, viewerBlur: false },
  { url: "/happy.webp", tag: "기쁨", chat: true, viewerBlur: true },
  { url: "/battle.webp", tag: "전투", chat: true, viewerBlur: true },
];

describe("chatCharacterImageSelection", () => {
  it("offers only public and message-unlocked images to a viewer", () => {
    const images = resolveSelectableCharacterImages({
      assets,
      representativeUrl: "/default.webp",
      isCharacterCreator: false,
      assistantMessages: ["본문\n[태그: 기쁨]"],
    });
    assert.deepEqual(
      images.map((image) => image.url),
      ["/default.webp", "/happy.webp"]
    );
  });

  it("offers every chat image to the character creator", () => {
    const images = resolveSelectableCharacterImages({
      assets,
      representativeUrl: "/default.webp",
      isCharacterCreator: true,
      assistantMessages: [],
    });
    assert.deepEqual(
      images.map((image) => image.url),
      ["/default.webp", "/happy.webp", "/battle.webp"]
    );
  });

  it("rejects a requested image outside the selectable set", () => {
    const images = [{ url: "/default.webp", tag: "대화" }];
    assert.equal(selectCharacterImageUrl(images, "/hidden.webp"), null);
    assert.equal(selectCharacterImageUrl(images, "/default.webp"), "/default.webp");
    assert.equal(selectCharacterImageUrl(images, undefined), "/default.webp");
  });
});
