import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateTokens } from "@/lib/tokenEstimate";
import {
  MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK,
  MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID,
} from "@/lib/museStructuralLengthAnchor";

const FORBIDDEN = [
  "플러드",
  "서강우",
  "렌",
  "라운지",
  "에이지스",
  "chat-103",
  "TARGET_LENGTH",
  "MINIMUM_FLOOR",
  "dialogue",
  "paragraph",
  "문단",
  "첫 자연스러운 착지",
  "첫 착지",
  "조기 종료",
  "금지",
  "2500",
  "2900",
  "3200",
];

describe("museStructuralLengthAnchor — second-order scene-depth contract", () => {
  it("section id is stable", () => {
    assert.equal(
      MUSE_STRUCTURAL_LENGTH_ANCHOR_SECTION_ID,
      "rule-muse-structural-length-anchor"
    );
  });

  it("starts with 장면 깊이 header", () => {
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.startsWith("[장면 깊이]"));
  });

  it("char budget 140–320; no length numbers", () => {
    const chars = MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.length;
    assert.ok(chars >= 140 && chars <= 320, `chars ${chars}`);
    assert.ok(estimateTokens(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK) >= 100);
  });

  it("contains purposeful action, direct consequence, follow-on change", () => {
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("목적 있는 행동"));
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("공간·사물·관계"));
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("직접 결과"));
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("후속 선택"));
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("충분한 장면 단위"));
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("대사가 짧아도"));
    assert.ok(MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes("판단과 환경 변화"));
  });

  it("excludes soft-landing / continuation-priority duplication and world/fixture terms", () => {
    for (const bad of FORBIDDEN) {
      assert.ok(
        !MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.includes(bad),
        `forbidden: ${bad}`
      );
    }
    assert.equal((MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.match(/\d{3,}/g) ?? []).length, 0);
  });

  it("minimizes 하지 않는다 chains", () => {
    assert.equal(
      (MUSE_STRUCTURAL_LENGTH_ANCHOR_BLOCK.match(/하지 않는다/g) ?? []).length,
      0
    );
  });
});
