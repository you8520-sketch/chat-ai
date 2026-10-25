import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trimTrailingVisibleSelfCritique } from "@/lib/narrativeRules";
import { visibleAssistantDisplayCharCount } from "@/lib/chatDisplayLength";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("trimTrailingVisibleSelfCritique", () => {
  for (const ending of [
    "징집 공고에는 draft라는 단어가 적혀 있었다. 그는 서류를 접고 경비실로 돌아갔다.",
    "The clerk filed the draft before closing the office.",
    '그가 물었다. "Is this the final draft?" 직원은 아직 초안이라고 대답했다.',
    "그는 DRAFT 표지를 넘겼다. Draft라는 글자 아래에 새로운 명령이 기다리고 있었다.",
  ]) {
    for (const body of ["문이 열렸다.", "창문에 빗물이 흘렀다. ".repeat(350)]) {
      it(`preserves ordinary draft prose (${body.length} chars, ${ending.slice(0, 20)})`, () => {
        const prose = `${body}\n\n${ending}`;
        const r = trimTrailingVisibleSelfCritique(prose);
        assert.equal(r.status, "CLEAN");
        assert.equal(r.text, prose);
      });
    }
  }

  it("still trims an English draft self-review with explicit output-planning signals", () => {
    const body = "그는 창가에 기대어 조용히 숨을 골랐다. ".repeat(220).trimEnd();
    const prose = `${body}\n\nDraft review. Need output only. Ensure 3200-4200 Korean chars. Let's output the final response.`;
    const r = trimTrailingVisibleSelfCritique(prose);
    assert.equal(r.status, "TRIMMED");
    assert.equal(r.text, body);
  });

  it("trims C5 trailing English self-critique suffix only", () => {
    const cache = JSON.parse(
      readFileSync(resolve(process.cwd(), "data/luna-user-tail-length-c5-cache.json"), "utf8")
    ) as { prose: string };
    const r = trimTrailingVisibleSelfCritique(cache.prose);
    assert.equal(r.status, "TRIMMED");
    assert.equal(visibleAssistantDisplayCharCount(cache.prose), 4235);
    assert.equal(visibleAssistantDisplayCharCount(r.text), 3772);
    assert.match(r.text, /그는 웃으며 입을 다물었다\.\s*$/);
    assert.doesNotMatch(r.text, /Need output only/i);
    assert.doesNotMatch(r.text, /diesmal/i);
    assert.doesNotMatch(r.text, /Let's output/i);
  });

  it("keeps normal English dialogue and proper nouns", () => {
    const prose = [
      "태형은 단검을 집어 들었다. 검신에 「Lightning Edge」라는 각인이 빛났다.",
      "",
      '"Code name is Raven. Follow me."',
      "",
      "렌은 고개를 끄덕였다. 태형은 복도 끝으로 걸음을 옮겼다.",
    ].join("\n");
    // Pad to >=2700 visible for threshold safety when testing CLEAN path with short text —
    // short CLEAN texts should still pass without trim.
    const r = trimTrailingVisibleSelfCritique(prose);
    assert.equal(r.status, "CLEAN");
    assert.equal(r.text, prose);
    assert.match(r.text, /Lightning Edge/);
    assert.match(r.text, /Code name is Raven/);
  });

  it("marks interleaved meta as UNSAFE_TO_TRIM without mutating", () => {
    const body = "가".repeat(2800) + "다.\n\n";
    const interleaved =
      body +
      "Need output only. 그런데 태형은 다시 포크를 들었다. 식당의 소음이 이어졌다. Ensure 3200-4200 Korean chars.";
    const r = trimTrailingVisibleSelfCritique(interleaved);
    assert.equal(r.status, "UNSAFE_TO_TRIM");
    assert.equal(r.text, interleaved);
  });

  it("does not treat in-quote meta-looking words as trim anchors", () => {
    const prose =
      "가".repeat(2800) +
      '다.\n\n태형이 말했다.\n\n"Must not forget the password."\n\n그는 문을 닫았다.';
    const r = trimTrailingVisibleSelfCritique(prose);
    assert.equal(r.status, "CLEAN");
    assert.match(r.text, /Must not forget the password/);
  });
});
