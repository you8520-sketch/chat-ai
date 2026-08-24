import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectModelRefusal } from "./adultSceneRouting";

/** Frozen Phase-1 B2 Gemini provider refusal (작성할 수 없). */
export const FROZEN_B2_GEMINI_REFUSAL =
  "요청하신 명시적인 성적 묘사(삽입, 성교 등 노골적인 성인 콘텐츠)는 안전 가이드라인에 위배되어 작성할 수 없습니다. 캐릭터 간의 다른 상호작용이나 다른 방향의 이야기 전개로 수정해 주시면 계속해서 롤플레이를 진행해 드리겠습니다.";

/** Frozen Phase-1 B3 Gemini provider refusal (생성할 수 없). */
export const FROZEN_B3_GEMINI_REFUSAL =
  "죄송합니다만, 요청하신 노골적인 성적 행위 묘사(삽입, 구체적인 성행위, 사정 등)를 포함한 장면은 안전 가이드라인에 위배되므로 생성할 수 없습니다. 다른 방향의 이야기 전개나 설정에 대해서는 기꺼이 도움을 드릴 수 있으니, 원하시는 다른 상황이 있다면 말씀해 주시기 바랍니다.";

describe("frozen Gemini refusal detector coverage", () => {
  it("B2 frozen refusal → refused=true", () => {
    const r = detectModelRefusal({
      text: FROZEN_B2_GEMINI_REFUSAL,
      finishReason: "stop",
    });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "provider_refusal");
  });

  it("B3 frozen refusal → refused=true", () => {
    const r = detectModelRefusal({
      text: FROZEN_B3_GEMINI_REFUSAL,
      finishReason: "stop",
    });
    assert.equal(r.refused, true);
    assert.equal(r.reason, "provider_refusal");
  });

  it("안전 가이드라인 alone is not a provider refusal", () => {
    assert.equal(
      detectModelRefusal({
        text: "이 장면은 안전 가이드라인을 참고해 진행하겠습니다.",
        finishReason: "stop",
      }).refused,
      false
    );
  });

  it("standalone 생성할 수 없 in ordinary IC prose is not a provider refusal", () => {
    for (const text of [
      "그는 마법으로 그런 존재를 생성할 수 없었다.",
      "「이 장면은 더 이상 생성할 수 없어.」 그가 속삭였다.",
      "렌은 숨을 고른 채, 상상도 못 할 속도로 몸을 움직였다.",
    ]) {
      assert.equal(
        detectModelRefusal({ text, finishReason: "stop" }).refused,
        false,
        text
      );
    }
  });
});
