import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isHtmlDisplayOnlyTurn,
  isHtmlFlashOnlyTurn,
  isOocCreativeHtmlTurn,
  chatInputSuppressesStatusWidget,
} from "@/lib/htmlDisplayOnlyTurn";

const ANON_INBOX_OOC = `*[OOC: 잠시 롤플레잉 중단. PC와 NPC의 관계를 반영하여 트위터 네임드 계정의 익명 메시지함을 구현한다. 실제 익명 메시지 사이트를 참고한 디자인을 HTML(코드블럭 사용 금지, 글자는 어두운 색)로 꾸며서 서술한다. 질문과 답변을 각각 5개 이상 코믹하고 상세하게 서술한다.]*`;

describe("isHtmlDisplayOnlyTurn", () => {
  it("detects display-input-only HTML with RP stop", () => {
    assert.equal(
      isHtmlDisplayOnlyTurn("OOC: RP 중지. HTML로 내가 입력한 내용만 띄워줘"),
      true
    );
    assert.equal(
      isHtmlDisplayOnlyTurn("(OOC) HTML을 사용해서 보낸 내용만 표기해"),
      true
    );
  });

  it("requires HTML output intent", () => {
    assert.equal(isHtmlDisplayOnlyTurn("입력한 내용만 보여줘"), false);
    assert.equal(isHtmlDisplayOnlyTurn("계속 RP 이어써"), false);
  });

  it("detects flash-only wording", () => {
    assert.equal(isHtmlDisplayOnlyTurn("HTML로 카톡 UI 띄워. 플래시만 일해"), true);
  });
});

describe("isOocCreativeHtmlTurn", () => {
  it("detects OOC RP pause + custom HTML (anonymous inbox)", () => {
    assert.equal(isOocCreativeHtmlTurn(ANON_INBOX_OOC), true);
    assert.equal(isHtmlFlashOnlyTurn(ANON_INBOX_OOC), true);
    assert.equal(isHtmlDisplayOnlyTurn(ANON_INBOX_OOC), false);
  });

  it("detects 롤플레잉 중단 without literal rp 중지", () => {
    assert.equal(
      isOocCreativeHtmlTurn("OOC: 롤플레잉 중단. HTML로 UI 출력"),
      true
    );
  });

  it("detects 대화 잠시 중지 + inline HTML", () => {
    const msg =
      "OOC: 지금의 대화 잠시 중지. 인라인 HTML을 활용하여 가독성 좋게 작성하고, 코드블럭으로 감싸서 출력한다.";
    assert.equal(isOocCreativeHtmlTurn(msg), true);
    assert.equal(chatInputSuppressesStatusWidget(msg), true);
  });

  it("detects 추구미 bracket-category OOC as creative HTML turn", () => {
    const msg =
      "OOC: 지금의 대화 잠시 중지. NPC 추구미. 항목은[외형 · 키워드 · 모에화 · 기타 상징 · 대외적 이미지] HTML로 출력";
    assert.equal(isOocCreativeHtmlTurn(msg), true);
    assert.equal(isHtmlFlashOnlyTurn(msg), true);
  });
});

describe("chatInputSuppressesStatusWidget", () => {
  it("suppresses widget for OOC HTML without full flash-only RP stop wording", () => {
    const msg = "OOC: HTML로 추구미 카드 출력해줘";
    assert.equal(chatInputSuppressesStatusWidget(msg), true);
  });

  it("does not suppress for normal RP", () => {
    assert.equal(chatInputSuppressesStatusWidget("계속 이어서 RP"), false);
  });
});
