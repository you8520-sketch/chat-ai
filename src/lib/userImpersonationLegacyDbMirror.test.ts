import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const RUNTIME_MIRROR_FILES = [
  "src/lib/chatSessionCreate.ts",
  "src/lib/chatForkCreate.ts",
  "src/app/api/chat/fork/route.ts",
  "src/app/chat/[id]/page.tsx",
  "src/app/api/chat/route.ts",
] as const;

describe("legacy user_impersonation DB mirror retirement", () => {
  it("has no production runtime reader/writer while retaining the physical rollback column", () => {
    for (const path of RUNTIME_MIRROR_FILES) {
      const src = readFileSync(path, "utf8");
      assert.doesNotMatch(
        src,
        /\buser_impersonation\b/,
        `${path} must not revive the retired legacy DB mirror`
      );
    }

    const dbSource = readFileSync("src/lib/db.ts", "utf8");
    assert.match(
      dbSource,
      /addColumn\("chats", "user_impersonation", "INTEGER NOT NULL DEFAULT 0"\)/,
      "physical legacy column stays for rollback/data audit until Phase 2B"
    );
  });
});
