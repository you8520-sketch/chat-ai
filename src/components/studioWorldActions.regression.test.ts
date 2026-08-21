import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("studio world card actions", () => {
  it("keeps edit and share actions without the character-use action", () => {
    const studio = fs.readFileSync("src/components/StudioClient.tsx", "utf8");
    assert.match(studio, /수정하기/);
    assert.match(studio, /공유하기/);
    assert.doesNotMatch(studio, /캐릭터에 사용/);
  });
});
