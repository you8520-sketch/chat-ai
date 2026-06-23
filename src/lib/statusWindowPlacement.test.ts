import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveStatusWindowPlacementFromSources,
  resolveStatusWindowPlacementInText,
} from "@/lib/statusWindowPlacement";

describe("resolveStatusWindowPlacementInText", () => {
  it("detects bottom from 본문하단", () => {
    assert.equal(
      resolveStatusWindowPlacementInText("다음 상태창을 본문하단에 출력"),
      "bottom"
    );
  });

  it("detects top from 본문상단", () => {
    assert.equal(
      resolveStatusWindowPlacementInText("다음 상태창을 본문상단에 출력"),
      "top"
    );
  });

  it("uses later hint when both appear", () => {
    assert.equal(
      resolveStatusWindowPlacementInText("본문 상단에 … 본문 하단에 최종"),
      "bottom"
    );
  });
});

describe("resolveStatusWindowPlacementFromSources", () => {
  it("userMessage overrides note", () => {
    assert.equal(
      resolveStatusWindowPlacementFromSources(
        {
          userMessage: "HTML로 본문 상단에 출력",
          userNote: "다음 상태창을 본문하단에 출력",
        },
        "bottom"
      ),
      "top"
    );
  });

  it("character setting applies when note has no hint", () => {
    assert.equal(
      resolveStatusWindowPlacementFromSources(
        {
          userNote: "상태창 출력",
          characterSetting: "ooc: 상태창을 HTML로 본문 상단에 표기",
        },
        "bottom"
      ),
      "top"
    );
  });

  it("defaults when no hint", () => {
    assert.equal(
      resolveStatusWindowPlacementFromSources({ userNote: "상태창 출력" }, "bottom"),
      "bottom"
    );
  });
});
