import assert from "node:assert/strict";

import { describe, it } from "node:test";

import {
  buildTurnHandoffAndPacingBlock,
  LONGFORM_RP_SCENE_CONTRACT,
  SCENE_CONTINUATION_PRIORITY_BLOCK,
  SCENE_CONTINUATION_PRIORITY_BLOCK_CORE,
} from "@/lib/turnHandoffAndPacing";

describe("buildTurnHandoffAndPacingBlock", () => {
  it("returns empty after Step 7 shell removal", () => {
    assert.equal(buildTurnHandoffAndPacingBlock(), "");
  });

  it("SCENE CONTINUATION keeps core pacing without experiment-1 longform contract", () => {
    assert.ok(SCENE_CONTINUATION_PRIORITY_BLOCK.startsWith(SCENE_CONTINUATION_PRIORITY_BLOCK_CORE));
    assert.match(
      SCENE_CONTINUATION_PRIORITY_BLOCK,
      /MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지/
    );
    assert.doesNotMatch(SCENE_CONTINUATION_PRIORITY_BLOCK, /한국어 장편 소설형 RP로/);
    assert.doesNotMatch(SCENE_CONTINUATION_PRIORITY_BLOCK, /Expand through progression/);
    // Deprecated export must not be re-injected into the production block.
    assert.ok(!SCENE_CONTINUATION_PRIORITY_BLOCK.includes(LONGFORM_RP_SCENE_CONTRACT));
  });
});
