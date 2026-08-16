import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import {
  D4A_POSITIVE_FORWARD_LENGTH_OWNER,
  D4A_PRODUCTION_LENGTH_OWNER,
  applyD4ALengthOwnerArmToMessages,
  countNewNegativeDirectives,
  d4aPromptBudgetReport,
} from "@/lib/geminiPositiveForwardOwnerD4";

const GEMINI = "google/gemini-3.1-pro-preview";

describe("Phase D4-A positive forward length owner (experiment)", () => {
  it("arm A leaves production owner intact", () => {
    const messages = [
      { role: "user", content: `hello\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}` },
    ];
    const out = applyD4ALengthOwnerArmToMessages({
      messages,
      modelId: GEMINI,
      arm: "A",
    });
    assert.equal(out.replaced, false);
    assert.equal(out.messages[0]!.content, messages[0]!.content);
  });

  it("arm B replaces only the user-tail length owner on Gemini 3.1 Pro", () => {
    const messages = [
      { role: "system", content: "sys" },
      { role: "user", content: `input\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}` },
    ];
    const out = applyD4ALengthOwnerArmToMessages({
      messages,
      modelId: GEMINI,
      arm: "B",
    });
    assert.equal(out.replaced, true);
    assert.ok(out.messages[1]!.content.includes(D4A_POSITIVE_FORWARD_LENGTH_OWNER));
    assert.ok(!out.messages[1]!.content.includes(D4A_PRODUCTION_LENGTH_OWNER));
    assert.equal(out.messages[0]!.content, "sys");
  });

  it("arm B does not replace on non-Gemini models", () => {
    const messages = [
      { role: "user", content: `x\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}` },
    ];
    const out = applyD4ALengthOwnerArmToMessages({
      messages,
      modelId: "deepseek/deepseek-chat",
      arm: "B",
    });
    assert.equal(out.replaced, false);
  });

  it("candidate introduces zero new negative directives and zero new sections", () => {
    const budget = d4aPromptBudgetReport();
    assert.equal(budget.candidate_new_negative_count, 0);
    assert.equal(budget.new_section_count, 0);
    assert.equal(countNewNegativeDirectives(D4A_POSITIVE_FORWARD_LENGTH_OWNER), 0);
    // Production baseline still contains the legacy "말고" phrase — candidate removes it.
    assert.ok(countNewNegativeDirectives(D4A_PRODUCTION_LENGTH_OWNER) >= 1);
  });

  it("candidate matches Phase D4 brief exact wording", () => {
    assert.equal(
      D4A_POSITIVE_FORWARD_LENGTH_OWNER,
      "이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 완성한다. 직전 장면과 현재 입력에서 이미 성립한 상황의 바로 다음 변화에서 시작해, 캐릭터의 새 판단·행동이 상대와 환경의 새 반응·결과를 만들고 그 결과가 다시 다음 변화를 낳도록 충분히 전개한다."
    );
  });
});
