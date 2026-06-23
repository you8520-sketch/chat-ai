import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractOocSnippets } from "@/lib/userImpersonationPolicy";
import {
  userMessageRequestsHtmlVisualCard,
  resolveHtmlVisualCardPolicyFromSources,
} from "@/lib/htmlVisualCardPolicy";
import { isOocCreativeHtmlTurn, isHtmlFlashOnlyTurn } from "@/lib/htmlDisplayOnlyTurn";
import { chatOocSuppressesUserNoteExtras, classifyChatOocIntent } from "@/lib/chatOocPriority";

const ANON_INBOX_OOC = `*[OOC: 잠시 롤플레잉 중단. NPC와 PC의 이야기는 최근 오타쿠들 사이에서 유행 중인 장르(작품)이다. PC와 NPC의 관계, 성격 및 성향, 지금까지의 대화 내용, 서사 등을 반영하여 트위터의 대형 계정(=네임드 계정)의 익명 메시지함에 쌓인 메시지와 답변을 구현한다. 실제 익명 메시지 사이트를 참고한 디자인을 HTML(코드블럭 사용 금지, 글자는 어두운 색으로 지정하여 출력. 모바일 환경을 고려한 반응형 레이아웃. 코드는 개행 없이 한 줄 작성.)로 꾸며서 서술한다. 단순 주접·망상·상담·팬덤 싸움·저격·캐해석·캐해논쟁 등 다양한 글이 있을 수 있으며, 질문과 답변을 각각 5개 이상 코믹하고 상세하게 서술한다.]*`;

describe("extractOocSnippets italic OOC", () => {
  it("extracts *[OOC: …]* markdown italic blocks", () => {
    const snippets = extractOocSnippets(ANON_INBOX_OOC);
    assert.ok(snippets.some((s) => /롤플레잉\s*중단/.test(s)));
    assert.ok(snippets.some((s) => /HTML\s*\(/.test(s)));
  });
});

describe("HTML flash turn trigger for italic OOC", () => {
  it("enables policy and flash-only from *[OOC: …]* message", () => {
    assert.equal(userMessageRequestsHtmlVisualCard(ANON_INBOX_OOC), true);
    const policy = resolveHtmlVisualCardPolicyFromSources({
      userMessage: ANON_INBOX_OOC,
      markdownStatusWindowActive: true,
    });
    assert.equal(policy.enabled, true);
    assert.equal(isOocCreativeHtmlTurn(ANON_INBOX_OOC), true);
    assert.equal(isHtmlFlashOnlyTurn(ANON_INBOX_OOC), true);
    assert.equal(classifyChatOocIntent(ANON_INBOX_OOC), "rp_unrelated");
    assert.equal(chatOocSuppressesUserNoteExtras(ANON_INBOX_OOC), true);
  });
});
