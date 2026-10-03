import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectUnlockedAssetUrlsFromMessages } from "@/lib/characterAssetUnlock";
import type { CharacterAsset } from "@/lib/characterAssets";

const assets: CharacterAsset[] = [
  { url: "/media/private/open.webp", tag: "미소", chat: true, viewerBlur: false },
  { url: "/media/private/hidden.webp", tag: "분노", chat: true, viewerBlur: true },
];

describe("characterAssetUnlock", () => {
  it("unlocks only from completed assistant finals with a matching tag", () => {
    const unlocked = collectUnlockedAssetUrlsFromMessages(
      [
        { role: "user", content: "[태그: 분노] 열어줘", generationStatus: "completed" },
        { role: "assistant", content: "아직 생성 중 [태그: 분노]", generationStatus: "generating" },
        { role: "assistant", content: "화가 난다 [태그: 분노]", generationStatus: "completed" },
      ],
      assets,
      false
    );
    assert.deepEqual(unlocked, ["/media/private/hidden.webp"]);
  });

  it("ignores user spoof, empty, and other-chat-unrelated missing tags", () => {
    const unlocked = collectUnlockedAssetUrlsFromMessages(
      [
        { role: "user", content: "[태그: 분노]", generationStatus: "completed" },
        { role: "assistant", content: "평범한 대답", generationStatus: "completed" },
        { role: "assistant", content: "", generationStatus: "completed" },
      ],
      assets,
      false
    );
    assert.deepEqual(unlocked, []);
  });

  it("does not treat creator preview as an unlock ledger", () => {
    const unlocked = collectUnlockedAssetUrlsFromMessages(
      [{ role: "assistant", content: "[태그: 분노]", generationStatus: "completed" }],
      assets,
      true
    );
    assert.deepEqual(unlocked, []);
  });
});
