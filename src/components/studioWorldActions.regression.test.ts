import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("studio world card actions", () => {
  it("owned worlds keep edit and share; borrowed worlds expose borrow actions", () => {
    const studio = fs.readFileSync("src/components/StudioClient.tsx", "utf8");
    assert.match(studio, /수정하기/);
    assert.match(studio, /공유하기/);
    assert.match(studio, /캐릭터 제작에 사용/);
    assert.match(studio, /시뮬레이션 제작에 사용/);
    assert.match(studio, /라이브러리에서 제거/);
    assert.match(studio, /읽기 전용/);
    assert.doesNotMatch(studio, /캐릭터에 사용/);
  });

  it("U1 unavailable borrowed worlds hide new-use CTAs and show ended-share badge", () => {
    const studio = fs.readFileSync("src/components/StudioClient.tsx", "utf8");
    assert.match(studio, /borrowUnavailable/);
    assert.match(studio, /공유 종료 · 신규 제작 불가/);
    assert.match(studio, /shareAvailable === false/);
  });
});
