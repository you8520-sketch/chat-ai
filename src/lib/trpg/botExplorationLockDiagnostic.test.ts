import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explorationRejectCode } from "./botExplorationLockDiagnostic";

describe("botExplorationLockDiagnostic", () => {
  it("classifies rejection messages without echoing user text", () => {
    assert.equal(explorationRejectCode(new Error("연결되지 않은 방입니다.")), "disconnected");
    assert.equal(explorationRejectCode(new Error("행동력이 부족합니다.")), "ap_insufficient");
    assert.equal(explorationRejectCode(new Error("행동이 너무 깁니다.")), "body_too_long");
    assert.equal(explorationRejectCode(new Error("unexpected")), "other");
  });
});
