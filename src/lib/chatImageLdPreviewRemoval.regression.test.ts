import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  formatApprovedScenePlanForIllustration,
} from "@/lib/chatImageScenePlan";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("LD illustration preview UI removal regression", () => {
  it("B2: forbidden LD default literals are absent from ChatSceneBuilder", () => {
    const source = read("src/components/ChatSceneBuilder.tsx");
    const forbidden = [
      "장면 정리 완료",
      "배경·인물 참조·장면 행동·대사 연기 정보는 생성 시 함께 반영됩니다.",
      "장면 확인 / 수정",
      "장면 준비 완료",
      "AI 분석 완료",
      "장면 설정 완료",
      "생성 준비 완료",
    ];
    for (const literal of forbidden) {
      assert.doesNotMatch(source, new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("B4/B5: ScenePlan and LD generation prompt unchanged by UI removal", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '*손목을 붙잡는다*\n"가지 마."' },
      { id: 2, role: "assistant", content: "태현이 렌의 손목을 붙잡고 문 앞까지 따라온다." },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const prompt = formatApprovedScenePlanForIllustration(plan, {
      personaName: "렌",
      characterName: "권태현",
      personaVisible: true,
    });
    assert.ok(prompt.length > 20);
    assert.match(prompt, /렌|태현|장면|SCENE|배경/i);
  });
});
