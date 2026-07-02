import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { buildTurnHandoffAndPacingBlock, SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";



describe("buildTurnHandoffAndPacingBlock", () => {

  it("returns empty after Step 7 shell removal", () => {

    assert.equal(buildTurnHandoffAndPacingBlock(), "");

  });



  it("SCENE CONTINUATION includes early-exit floor guard", () => {

    assert.match(SCENE_CONTINUATION_PRIORITY_BLOCK, /MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지/);

    assert.doesNotMatch(SCENE_CONTINUATION_PRIORITY_BLOCK, /Expand through progression/);

  });

});

