import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const CLIENT_COMIC_FILES = [
  "src/components/ChatImageGeneratorPanel.tsx",
  "src/app/trpg/[id]/TrpgRoomClient.tsx",
];

const FORBIDDEN_CLIENT_IMPORT = [
  /from "@\/lib\/chatComicTextOverlay(?:\.server)?"/,
  /from "@\/lib\/chatComicTextOverlay\.server"/,
  /from "sharp"/,
  /from "node:fs"/,
  /from "node:child_process"/,
  /from "node:crypto"/,
  /require\("sharp"\)/,
  /require\("fs"\)/,
  /require\("child_process"\)/,
];

function importSection(source: string): string {
  return source
    .split(/^export /m)[0]!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("chatComicGeneration client bundle boundary", () => {
  it("ChatImageGeneratorPanel imports client-safe comic constants only", () => {
    const text = readFileSync("src/components/ChatImageGeneratorPanel.tsx", "utf8");
    const imports = importSection(text);
    assert.match(imports, /from "@\/lib\/chatComicGenerationConstants"/);
    assert.doesNotMatch(imports, /from "@\/lib\/chatComicGeneration"/);
    for (const pattern of FORBIDDEN_CLIENT_IMPORT) {
      assert.doesNotMatch(imports, pattern);
    }
  });

  for (const file of CLIENT_COMIC_FILES) {
    it(`${file} does not import server-only overlay or Node image deps`, () => {
      const text = readFileSync(file, "utf8");
      const imports = importSection(text);
      for (const pattern of FORBIDDEN_CLIENT_IMPORT) {
        assert.doesNotMatch(imports, pattern);
      }
    });
  }

  it("shared chatComicTextOverlay.ts has no sharp import", () => {
    const text = readFileSync("src/lib/chatComicTextOverlay.ts", "utf8");
    assert.doesNotMatch(text, /from "sharp"/);
    assert.doesNotMatch(text, /require\("sharp"\)/);
  });

  it("chatComicGeneration.ts does not import chatComicTextOverlay", () => {
    const text = readFileSync("src/lib/chatComicGeneration.ts", "utf8");
    assert.doesNotMatch(text, /from "@\/lib\/chatComicTextOverlay"/);
  });
});
