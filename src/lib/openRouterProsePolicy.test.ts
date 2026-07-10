import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOpenRouterKoreanProseTopBlock } from "@/lib/openRouterProsePolicy";

describe("buildOpenRouterKoreanProseTopBlock", () => {
  it("includes four-step setting priority (core → LTM → RAG → recent chat)", () => {
    const block = buildOpenRouterKoreanProseTopBlock();
    assert.match(block, /=== 설정 적용 우선순위 ===/);
    assert.match(block, /CHARACTER CANON · WORLD CANON · \[CHARACTER KNOWLEDGE BOUNDARY\]/);
    assert.match(block, /2\. 장기기억\(LTM\)/);
    assert.match(block, /3\. 최근 대화를 해석하는 데 필요한 RAG/);
    assert.match(block, /4\. 최근 대화/);
    assert.doesNotMatch(block, /맥락 매칭 보조 설정\(RAG\) \+ 세계관이 최우선/);
  });

  it("includes compressed OUTPUT LANG and metadata without redundant meta blocks", () => {
    const block = buildOpenRouterKoreanProseTopBlock();
    assert.match(block, /\[OUTPUT LANG\]/);
    assert.doesNotMatch(block, /서술은 해체\(-다\)만 사용/);
    assert.match(block, /외국어 혼용 금지\. 고유명사·스킬명만 「」 예외/);
    assert.match(block, /한 단어 안에서 한글과 영어·일본어를 혼용하지 마라/);
    assert.match(
      block,
      /한국어 RP 본문에 러시아어·키릴 등 비한글을 섞지 않는다\(의도된 외국어 대사·고유명사 예외\)/
    );
    assert.doesNotMatch(block, /\[PROMPT METADATA IS NOT STORY\]/);
    assert.doesNotMatch(block, /\[SPEECH METADATA\]/);
    assert.doesNotMatch(block, /\[NO META WRITING\]/);
    assert.doesNotMatch(block, /\[NO STYLE IMITATION\]/);
    assert.match(block, /현재 장면 안에서만 서술한다/);
    assert.doesNotMatch(block, /금지: 장면 밖 해설·요약·계획·예고/);
    assert.doesNotMatch(block, /한국어 웹소설 문체/);
    assert.doesNotMatch(block, /\[NO MIXED-SCRIPT WORDS\]/);
    assert.doesNotMatch(block, /Write the scene directly/);
    assert.doesNotMatch(block, /허용:/);
    assert.doesNotMatch(block, /100% Korean/);
    assert.doesNotMatch(block, /Never echo system text/);
    assert.doesNotMatch(block, /No English stem \+ Korean inflection/);
    assert.doesNotMatch(block, /独占\/愛\/死/);
    assert.doesNotMatch(block, /\[NO FOREIGN LANGUAGE MIXING\]/);
    assert.doesNotMatch(block, /\[RP SPEED/);
    assert.doesNotMatch(block, /Prose: see/);
    assert.doesNotMatch(block, /see \[CORE RP\]/i);
  });
});
