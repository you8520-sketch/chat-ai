import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";

describe("buildOpenRouterKoreanProseTopBlock", () => {
  it("includes user persona in priority 1", () => {
    const block = buildOpenRouterKoreanProseTopBlock();
    assert.match(block, /1순위: AI 캐릭터, 유저 페르소나 및 세계관 — 절대 붕괴 없음 \(유저 설정 오류 금지\)/);
    assert.match(block, /2순위: 장기 기억\(LTM\) 및 과거 요약/);
    assert.match(block, /3순위: 최근 대화 내역/);
    assert.match(
      block,
      /4순위: \[System Reminder\] 위 대화에 반응할 때 캐릭터 설정·과거 기억 최우선 유지\. 자연스럽고 몰입감 있게 서술\./
    );
  });

  it("includes NO FOREIGN LANGUAGE MIXING in OUTPUT LANG for Korean-only", () => {
    const block = buildOpenRouterKoreanProseTopBlock();
    assert.match(block, /\[OUTPUT LANG\]/);
    assert.match(block, /\[NO FOREIGN LANGUAGE MIXING\]/);
    assert.doesNotMatch(block, /\[NO KONGLISH HYBRID\]/);
    assert.doesNotMatch(block, /\[NO HANJA SUBSTITUTION\]/);
    assert.match(block, /영어어간\+한국어어미 굴절/);
    assert.match(block, /独占\/愛\/死/);
    assert.match(block, /Qwen, DeepSeek/);
  });
});
