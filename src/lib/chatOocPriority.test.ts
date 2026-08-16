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

  it("does not treat the OOC marker itself as a hard stop", () => {
    assert.equal(
      classifyChatOocIntent("OOC: 지금 대사를 조금 더 장난스럽게 해."),
      "rp_continuing"
    );
    assert.equal(
      classifyChatOocIntent("OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마."),
      "rp_hard_stop"
    );
  });

  it("prefers scene reset over hard stop when a new episode starts", () => {
    assert.equal(
      classifyChatOocIntent(
        "OOC: 기존RP종료 새로운 에피소드시작\nNPC의 코트에 손을 넣었다가 실수로 성기를 소세지로 착각하였을때\nNPC의 반응을 출력"
      ),
      "rp_scene_reset"
    );
    assert.equal(
      classifyChatOocIntent(
        "OOC: 기존 RP 종료. 새로운 에피소드 시작.\n둘이 카페에서 우연히 다시 만나는 장면을 출력."
      ),
      "rp_scene_reset"
    );
  });
});
