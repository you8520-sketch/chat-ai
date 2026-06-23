import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyChatOocIntent,
  chatOocSuppressesUserNoteExtras,
  isChatOocRpContinuing,
  isChatOocRpUnrelated,
} from "@/lib/chatOocPriority";

const ANON_INBOX_OOC = `*[OOC: 잠시 롤플레잉 중단. HTML(코드블럭)로 익명 메시지함 UI 구현. 질문과 답변 5개 이상.]*`;

describe("chatOocPriority", () => {
  it("classifies alt-world / RP-stop OOC as rp_unrelated", () => {
    assert.equal(classifyChatOocIntent(ANON_INBOX_OOC), "rp_unrelated");
    assert.equal(isChatOocRpUnrelated(ANON_INBOX_OOC), true);
    assert.equal(chatOocSuppressesUserNoteExtras(ANON_INBOX_OOC), true);
  });

  it("classifies display-input-only OOC as rp_unrelated", () => {
    const msg = "OOC: RP 중지. HTML로 내가 입력한 내용만 띄워줘";
    assert.equal(classifyChatOocIntent(msg), "rp_unrelated");
  });

  it("classifies continuing-scene OOC as rp_continuing", () => {
    const msg = "OOC: 현재 장면에서 계속 진행. 호감도 조금 올려줘";
    assert.equal(classifyChatOocIntent(msg), "rp_continuing");
    assert.equal(isChatOocRpContinuing(msg), true);
    assert.equal(chatOocSuppressesUserNoteExtras(msg), false);
  });

  it("returns none for normal RP without OOC", () => {
    assert.equal(classifyChatOocIntent("앞으로 가자"), "none");
  });
});
