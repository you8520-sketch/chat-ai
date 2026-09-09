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

  it("admin comic diagnostic UI is removed; only the actual-cost line remains", () => {
    const text = readFileSync("src/components/ChatImageGeneratorPanel.tsx", "utf8");
    assert.doesNotMatch(text, /관리자 진단/);
    assert.doesNotMatch(text, /comicReferenceIsolationMode/);
    assert.doesNotMatch(text, /comicVisualContextIsolationMode/);
    assert.doesNotMatch(text, /comicDiagnosticMode/);
    assert.doesNotMatch(text, /comicSemanticLevel/);
    assert.doesNotMatch(text, /comicTextBoundaryLevel/);
    assert.doesNotMatch(text, /COMIC_TEXT_BOUNDARY_LADDER/);
    assert.doesNotMatch(text, /blank_balloon_hybrid/);
    assert.doesNotMatch(text, /COMIC_BLANK_BALLOON_TEXT_STRATEGIES/);
    assert.doesNotMatch(text, /blankBalloonDetection/);
    assert.doesNotMatch(text, /두 진단 축은 동시에 선택할 수 없습니다/);
    assert.match(text, /관리자 방금 생성 실제 API 원가/);
    assert.match(text, /actualCosts\[activeMode\]/);
  });
});
