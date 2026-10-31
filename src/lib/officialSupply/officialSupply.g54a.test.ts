import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluateOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import { isTagGrounded } from "@/lib/officialSupply/marketFit";

/** The verbatim creator comment from the G5-3Z run 1 rejection (evidence #48). */
const RUN1_COMMENT =
  "<p><b>지금 상황</b><br>안내홀에는 서로 다른 날짜의 공지와 분류 대기 목록이 놓여 있습니다. 민서는 오늘 정할 선택지를 적고, 확인할 조건을 살피는 중입니다.</p><p><b>추천 플레이 방향</b><br>공지의 날짜를 함께 대조하거나, 운영 변경에서 빠진 생활 정보를 질문하거나, 민서가 적은 선택지의 기준을 물어보세요. 답을 대신 정하기보다 확인과 기록을 함께하는 대화가 어울립니다.</p>";

const hasSelectable = (comment: string): boolean =>
  evaluateOfficialCreatorComment(comment, "").errors.some(
    (issue) => issue.code === "creator_comment_selectable_start"
  );

describe("G5-4A A — in-scene choices are not alternate starts", () => {
  it("passes the verbatim G5-3Z run 1 comment", () => {
    assert.equal(hasSelectable(RUN1_COMMENT), false);
  });

  it("passes ordinary scene-level guidance", () => {
    for (const comment of [
      "민서가 적은 선택지를 함께 확인해 보세요.",
      "공지의 날짜를 질문하거나 함께 확인해 보세요.",
      "오늘 정할 선택지를 적어 두었습니다.",
    ]) {
      assert.equal(hasSelectable(comment), false, comment);
    }
  });

  it("still rejects an offer of alternate starts or episodes", () => {
    for (const comment of [
      "다른 시작 장면을 고르세요.",
      "원하는 에피소드를 선택하세요.",
      "시작 지점을 골라 주세요.",
      "새로운 도입을 고를 수 있습니다.",
      "에피소드를 선택해 시작하세요.",
    ]) {
      assert.equal(hasSelectable(comment), true, comment);
    }
  });
});

describe("G5-4A B — the selected genre's own name is grounded", () => {
  it("accepts the live run 2 tag for the selected genre", () => {
    assert.equal(isTagGrounded("현대 일상", new Set(), "", "현대/일상"), true);
    assert.equal(isTagGrounded("현대/일상", new Set(), "", "현대/일상"), true);
    assert.equal(isTagGrounded("현대 일상극", new Set(), "", "현대/일상"), true);
  });

  it("does not extend the allowance to another genre or to an ungrounded tag", () => {
    assert.equal(isTagGrounded("현대 일상", new Set(), "", "로맨스"), false);
    assert.equal(isTagGrounded("현대 일상", new Set(), "", undefined), false);
    assert.equal(isTagGrounded("느린 친밀감", new Set(), "", "현대/일상"), false);
    assert.equal(isTagGrounded("느린 친밀감", new Set(), "공사 일정과 안내문"), false);
  });
});
