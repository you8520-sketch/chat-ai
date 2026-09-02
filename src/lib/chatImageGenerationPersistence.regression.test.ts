import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("chat image generation durable success regression", () => {
  it("comic route does not silently swallow history/album persistence failures", () => {
    const route = read("src/app/api/chat/comic-generation/route.ts");
    assert.match(route, /persistChatImageGenerationResult\(/);
    assert.match(route, /abortGeneratedImageAfterPersistenceFailure\(/);
    assert.doesNotMatch(route, /history\/album insert failed/);
    assert.doesNotMatch(route, /savedToCharacterAlbum = false/);
  });

  it("client treats album persistence as part of comic/illustration success", () => {
    const panel = read("src/components/ChatImageGeneratorPanel.tsx");
    assert.match(panel, /isDurableAlbumGenerationSuccess/);
    assert.match(panel, /savedToCharacterAlbum === true/);
  });
});
