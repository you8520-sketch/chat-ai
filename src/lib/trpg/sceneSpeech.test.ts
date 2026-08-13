import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isTrpgSpeakerPrefix, parseTrpgSceneSpeech } from "./sceneSpeech";

describe("parseTrpgSceneSpeech", () => {
  it("labels quoted lines that start with a name colon", () => {
    const beats = parseTrpgSceneSpeech(
      `빗줄기가 창을 두드린다.\n\n렌: "문을 열어."\n\n여관주인: 「지금은 안 됩니다.」`,
      ["렌"]
    );
    assert.equal(beats[0]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /빗줄기/);
    assert.equal(beats[1]?.speaker, "렌");
    assert.match(beats[1]?.text ?? "", /문을 열어/);
    assert.equal(beats[2]?.speaker, "여관주인");
  });

  it("splits a name-prefixed line out of a mixed paragraph", () => {
    const beats = parseTrpgSceneSpeech(`낡은 등불이 흔들린다.\n렌: "누구냐."`);
    assert.equal(beats.length, 2);
    assert.equal(beats[0]?.speaker, null);
    assert.equal(beats[1]?.speaker, "렌");
  });

  it("does not treat times or notes as speakers", () => {
    assert.equal(isTrpgSpeakerPrefix("12", "30에 만난다.", []), false);
    assert.equal(isTrpgSpeakerPrefix("주의", "함정을 밟지 마라.", []), false);
    const beats = parseTrpgSceneSpeech(`시간: 밤\n주의: 함정`);
    assert.ok(beats.every((b) => b.speaker == null));
  });

  it("labels a standalone quote from the previous narration, not 장면", () => {
    const beats = parseTrpgSceneSpeech(
      `태현의 손이 렌의 어깨를 스쳤다.\n\n"야, 렌. 잠깐..."\n\n이현의 목소리가 들렸다.\n\n"저 안에서 딱딱거리던 게 멈췄어."`,
      ["권태현", "렌", "강이현"]
    );
    assert.equal(beats[0]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /어깨/);
    assert.equal(beats[1]?.speaker, "권태현");
    assert.match(beats[1]?.text ?? "", /야, 렌/);
    assert.equal(beats[2]?.speaker, null);
    assert.equal(beats[3]?.speaker, "강이현");
  });
});
