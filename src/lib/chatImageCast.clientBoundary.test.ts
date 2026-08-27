import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const CLIENT_CAST_FILES = [
  "src/lib/chatImageCast.ts",
  "src/components/ChatImageCastPicker.tsx",
  "src/components/ChatSceneBuilder.tsx",
];

const FORBIDDEN_IMPORT = [
  /from "@\/lib\/chatImageCastManifest"/,
  /from "@\/lib\/chatImageScenePlanner"/,
  /from "server-only"/,
  /openRouterCompletion/,
  /getDb\(/,
  /adminFinance/,
];

function importSection(source: string): string {
  return source
    .split(/^export /m)[0]!
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("chatImageCast client bundle boundary", () => {
  for (const file of CLIENT_CAST_FILES) {
    it(`${file} avoids server-only cast imports`, () => {
      const text = readFileSync(file, "utf8");
      const imports = importSection(text);
      for (const pattern of FORBIDDEN_IMPORT) {
        assert.doesNotMatch(imports, pattern);
      }
    });
  }
});
