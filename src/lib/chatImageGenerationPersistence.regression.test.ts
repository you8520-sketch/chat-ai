import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("chat image generation durable success regression", () => {
  it("comic route uses atomic settlement without silent success branches", () => {
    const route = read("src/app/api/chat/comic-generation/route.ts");
    assert.match(route, /settleChatImageGenerationResult\(/);
    assert.match(route, /abortGeneratedImageAfterSettlementFailure\(/);
    assert.doesNotMatch(route, /savedToCharacterAlbum = false/);
    assert.doesNotMatch(
      route,
      /catch\s*\([^)]*\)\s*\{[^}]*finishChatImageGenerationJob\(\{[^}]*status:\s*"completed"/s
    );
  });

  it("settlement failure preserves provider attempt evidence", () => {
    const route = read("src/app/api/chat/comic-generation/route.ts");
    assert.match(route, /providerAttemptsJson:\s*attemptsJson/);
    assert.match(route, /providerAttemptsJson\?: string \| null/);
  });

  it("client treats album persistence as part of comic/illustration success", () => {
    const panel = read("src/components/ChatImageGeneratorPanel.tsx");
    assert.match(panel, /isDurableAlbumGenerationSuccess/);
    assert.match(panel, /savedToCharacterAlbum === true/);
  });
});
