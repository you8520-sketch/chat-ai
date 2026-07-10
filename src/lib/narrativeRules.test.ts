import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  streamDeltaAfterRpMetaStrip,
  stripInternalTagLeakage,
  stripModelXmlLeakage,
  stripSceneAnalysisLeakage,
} from "@/lib/narrativeRules";

describe("stripModelXmlLeakage", () => {
  it("removes empty LONG_TERM_MEMORY tags", () => {
    const input = '본문\n\n<LONG_TERM_MEMORY> </LONG_TERM_MEMORY>\n\n끝';
    assert.equal(stripModelXmlLeakage(input), "본문\n\n끝");
  });

  it("removes incomplete trailing XML tag", () => {
    const input = "본문입니다.<LONG_TERM_MEMORY> 비밀";
    assert.equal(stripModelXmlLeakage(input), "본문입니다.");
  });

  it("preserves normal RP text", () => {
    const input = '그는 말했다. "안녕."';
    assert.equal(stripModelXmlLeakage(input), input);
  });
});

describe("streamDeltaAfterRpMetaStrip", () => {
  it("does not replace when meta prefix is stripped but prose was already streamed", () => {
    const story = "그는 천천히 고개를 들었다. 창밖으로 빗줄기가 떨어지고 있었다.";
    const lastSent = `역할 몸입 중, 성인 콘텐츠 허용.\n\n${story}`;
    const accumulated = `역할 몸입 중, 성인 콘텐츠 허용.\n\n${story} 새 문장이 이어졌다.`;
    const r = streamDeltaAfterRpMetaStrip(accumulated, lastSent);
    assert.equal(r.replace, null);
    assert.ok(r.delta.includes("새 문장"));
  });

  it("replaceInstant when collapsed suffix matches but prefix diverged", () => {
    const lastSent = "AAAAAAAABBBBBBBBCC";
    const accumulated = "AAAAAAAAXBBBBBBBBCCNEW";
    const r = streamDeltaAfterRpMetaStrip(accumulated, lastSent);
    assert.equal(r.replace, accumulated);
    assert.equal(r.replaceInstant, true);
    assert.equal(r.delta, "");
  });

  it("holds last sent when collapsed extends but raw map retention fails", () => {
    const lastSent = ("word  ").repeat(35);
    const accumulated = ("word ").repeat(35) + " additional prose tail.";
    const r = streamDeltaAfterRpMetaStrip(accumulated, lastSent);
    assert.equal(r.replace, null);
    assert.equal(r.clean, lastSent);
    assert.equal(r.delta, "");
  });

  it("appends delta when collapsed clean extends last sent", () => {
    const lastSent = "첫 문장. 둘째 문장.";
    const accumulated = "첫 문장. 둘째 문장. 셋째 문장.";
    const r = streamDeltaAfterRpMetaStrip(accumulated, lastSent);
    assert.equal(r.replace, null);
    assert.equal(r.delta, " 셋째 문장.");
  });
});

describe("stripInternalTagLeakage", () => {
  it("also strips speech profile brackets", () => {
    const input = "[SPEECH PROFILE test]\n본문";
    assert.equal(stripInternalTagLeakage(input), "본문");
  });
});

describe("stripSceneAnalysisLeakage", () => {
  it("removes model scene-planning leakage inside dialogue", () => {
    const leak =
      '"캐릭터가 렌을 완전히 벽에 고정시키며 더 깊은 신체 접촉을 요구하고 있다. 유저의 심장 박동이 빨라졌고 완전히 백하율의 리드에 휩쓸리고 있다는 점을 생리적 단서로 포착했으며, 대사는 없지만 상황은 완전히 백하율이 지배하고 있다. 직전의 본문과 흐름을 유지하며 자연스럽게 이어가야 한다."';
    const input = `백하율이 속삭였다.\n\n${leak}`;
    const out = stripSceneAnalysisLeakage(input);
    assert.doesNotMatch(out, /생리적 단서/);
    assert.doesNotMatch(out, /직전의 본문/);
    assert.match(out, /백하율이 속삭였다/);
  });
});
