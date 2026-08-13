import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trpgReadyLabel } from "./readyLabel";

describe("trpgReadyLabel", () => {
  it("covers every ready state", () => {
    assert.equal(trpgReadyLabel("writing"), "작성 중");
    assert.equal(trpgReadyLabel("submitted"), "제출");
    assert.equal(trpgReadyLabel("bot_pending"), "봇 대기");
    assert.equal(trpgReadyLabel("host_fill"), "방장 입력");
    assert.equal(trpgReadyLabel("incapacitated"), "행동 불가");
    assert.equal(trpgReadyLabel("spectating"), "관전");
    assert.equal(trpgReadyLabel("disconnected"), "연결 끊김");
  });
});
