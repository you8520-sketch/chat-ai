import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("login return gates", () => {
  test("protected pages send users to login with a same-origin redirect target", () => {
    assert.match(readPage("src/app/chats/page.tsx"), /redirect\("\/login\?redirect=\/chats"\)/);
    assert.match(readPage("src/app/points/page.tsx"), /redirect\("\/login\?redirect=\/points"\)/);
    assert.match(readPage("src/app/settings/page.tsx"), /redirect\("\/login\?redirect=\/settings"\)/);
  });
});
