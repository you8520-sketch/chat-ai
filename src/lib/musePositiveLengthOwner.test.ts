import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MUSE_POSITIVE_LENGTH_OWNER_BLOCK,
  MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID,
  MUSE_POSITIVE_LENGTH_TERMINAL_BLOCK,
  MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID,
} from "@/lib/musePositiveLengthOwner";

describe("musePositiveLengthOwner — exact candidate blocks", () => {
  it("section IDs are stable", () => {
    assert.equal(MUSE_POSITIVE_LENGTH_OWNER_SECTION_ID, "rule-muse-positive-length-owner");
    assert.equal(
      MUSE_POSITIVE_LENGTH_TERMINAL_SECTION_ID,
      "rule-muse-positive-length-terminal"
    );
  });

  it("owner block matches exact positive candidate", () => {
    assert.equal(
      MUSE_POSITIVE_LENGTH_OWNER_BLOCK,
      "[분량과 장면 전개]\n" +
        "TARGET_LENGTH: 3,200+ 한국어 글자\n" +
        "MINIMUM_FLOOR: 2,700+\n" +
        "\n" +
        "유저의 현재 입력을 직접 되풀이하지 않고 그 다음 순간부터 시작한다. " +
        "현재 인물의 반응을 목적 있는 행동으로 발전시키고, 그 행동이 공간·사물·관계에 만든 직접 결과를 보여준다. " +
        "이어 그 결과가 촉발한 후속 선택이나 변화를 연결하여 하나의 충분한 장면 단위를 완성한다. " +
        "대사가 짧을 때는 현재 장면에 이미 존재하는 감각·판단·환경·관계 변화를 활용해 인과를 깊게 한다. " +
        "분량은 새로운 설정을 추가하는 대신 확립된 요소를 충분히 활용하고 그 결과를 전개하여 확보한다."
    );
  });

  it("terminal block matches exact positive candidate", () => {
    assert.equal(
      MUSE_POSITIVE_LENGTH_TERMINAL_BLOCK,
      "TARGET_LENGTH 3,200+ · MINIMUM_FLOOR 2,700+ — 반응→행동→직접 결과→후속 변화까지 연결해 하나의 충분한 장면 단위를 완성한다."
    );
  });

  it("omits negative-heavy / ban-list language", () => {
    const joined = `${MUSE_POSITIVE_LENGTH_OWNER_BLOCK}\n${MUSE_POSITIVE_LENGTH_TERMINAL_BLOCK}`;
    assert.doesNotMatch(joined, /조기 종료/);
    assert.doesNotMatch(joined, /미달/);
    assert.doesNotMatch(joined, /금지/);
    assert.doesNotMatch(joined, /SCENE CONTINUATION PRIORITY/);
    assert.doesNotMatch(joined, /억지 질문/);
    assert.doesNotMatch(joined, /미세 행동/);
    assert.doesNotMatch(joined, /반복 해설/);
    assert.doesNotMatch(joined, /continuation|recovery|regenerat/i);
    assert.doesNotMatch(joined, /checklist/i);
  });
});
