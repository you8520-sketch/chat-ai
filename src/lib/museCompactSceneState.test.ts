import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateTokens } from "@/lib/tokenEstimate";
import {
  MUSE_COMPACT_SCENE_STATE_BLOCK,
  MUSE_COMPACT_SCENE_STATE_SECTION_ID,
} from "@/lib/museCompactSceneState";

const PRESERVED_MARKERS = [
  "2층 휴게 라운지",
  "자동 차 추출기",
  "서강우",
  "플러드",
  "렌",
  "차 취향",
  "과일 향",
];

const FORBIDDEN_ADDED = [
  "카나리",
  "DeepSeek",
  "Gemini",
  "M1",
  "TARGET_LENGTH",
  "dialogue",
  "paragraph",
];

describe("museCompactSceneState — admin benchmark fixture contract", () => {
  it("section id is stable", () => {
    assert.equal(MUSE_COMPACT_SCENE_STATE_SECTION_ID, "rule-muse-compact-scene-state");
  });

  it("starts with CURRENT SCENE STATE header", () => {
    assert.ok(MUSE_COMPACT_SCENE_STATE_BLOCK.startsWith("[CURRENT SCENE STATE]"));
  });

  it("char/token budgets within canary targets", () => {
    const chars = MUSE_COMPACT_SCENE_STATE_BLOCK.length;
    const tokens = estimateTokens(MUSE_COMPACT_SCENE_STATE_BLOCK);
    assert.ok(chars >= 350 && chars <= 900, `chars ${chars}`);
    assert.ok(tokens >= 250 && tokens <= 800, `tokens ${tokens}`);
  });

  it("contains only source-grounded benchmark facts", () => {
    for (const m of PRESERVED_MARKERS) {
      assert.ok(
        MUSE_COMPACT_SCENE_STATE_BLOCK.includes(m),
        `missing preserved marker: ${m}`
      );
    }
  });

  it("no dialogue quotation marks / spoken lines", () => {
    assert.equal((MUSE_COMPACT_SCENE_STATE_BLOCK.match(/[“”「」『』]/g) ?? []).length, 0);
    assert.equal((MUSE_COMPACT_SCENE_STATE_BLOCK.match(/"[^"]{8,}"/g) ?? []).length, 0);
  });

  it("no ADDED facts / model-style wording", () => {
    for (const bad of FORBIDDEN_ADDED) {
      assert.ok(
        !MUSE_COMPACT_SCENE_STATE_BLOCK.includes(bad),
        `forbidden content: ${bad}`
      );
    }
  });

  it("declares internal context (not character dialogue)", () => {
    assert.ok(MUSE_COMPACT_SCENE_STATE_BLOCK.includes("내부 장면 컨텍스트"));
  });
});
