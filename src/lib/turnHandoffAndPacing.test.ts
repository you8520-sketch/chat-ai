import assert from "node:assert/strict";

import { describe, it } from "node:test";

import { buildTurnHandoffAndPacingBlock, SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";



describe("buildTurnHandoffAndPacingBlock", () => {

  it("returns empty after Step 7 shell removal", () => {

    assert.equal(buildTurnHandoffAndPacingBlock(), "");

  });



  it("SCENE CONTINUATION owns the longform length+completion contract once", () => {
    assert.match(
      SCENE_CONTINUATION_PRIORITY_BLOCK,
      /한국어 장편 소설형 RP로, 한 턴을 보통 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다/
    );
    assert.match(
      SCENE_CONTINUATION_PRIORITY_BLOCK,
      /요약하거나 다음 전개를 예고하며 끝내지 말고, 이번 턴에 시작된 주요 행동은 필요한 단계와 최초로 확인 가능한 결과까지 완성한다/
    );
    assert.doesNotMatch(
      SCENE_CONTINUATION_PRIORITY_BLOCK,
      /MINIMUM_FLOOR 미달 전 조기 종료·관찰자 붕괴 결말 금지/
    );
    assert.doesNotMatch(SCENE_CONTINUATION_PRIORITY_BLOCK, /Expand through progression/);
  });

});

