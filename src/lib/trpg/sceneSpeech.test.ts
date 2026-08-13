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

  it("treats a known name paragraph as a speaker cue, not narration", () => {
    const beats = parseTrpgSceneSpeech(
      `강이현\n\n"약국은 지금 함정이야."\n\n그는 석궁을 접었다.`,
      ["강이현"]
    );
    assert.equal(beats[0]?.speaker, "강이현");
    assert.match(beats[0]?.text ?? "", /함정이야/);
    assert.equal(beats[1]?.speaker, null);
    assert.match(beats[1]?.text ?? "", /석궁/);
  });

  it("labels a standalone quote after a speech verb, not a name that was only mentioned", () => {
    const beats = parseTrpgSceneSpeech(
      `태현이 낮게 말했다.\n\n"야, 렌. 잠깐..."\n\n이현의 목소리가 들렸다.\n\n"저 안에서 딱딱거리던 게 멈췄어."`,
      ["권태현", "렌", "강이현"]
    );
    assert.equal(beats[0]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /낮게 말했다/);
    assert.equal(beats[1]?.speaker, "권태현");
    assert.match(beats[1]?.text ?? "", /야, 렌/);
    assert.equal(beats[2]?.speaker, null);
    assert.equal(beats[3]?.speaker, "강이현");
  });

  it("does not give the next quote to a name only mentioned in narration", () => {
    const beats = parseTrpgSceneSpeech(
      `렌: "어디로 갈까?"\n\n태현이 렌을 향해 고개를 까딱였다.\n\n"네가 찾은 지도, 잘 챙겨."\n\n태현이 낮게 말했다.\n\n"안전 가옥 먼저."`,
      ["권태현", "렌", "강이현"]
    );
    assert.equal(beats.find((b) => b.text.includes("어디로"))?.speaker, "렌");
    assert.equal(beats.find((b) => b.text.includes("지도"))?.speaker, null);
    assert.equal(beats.find((b) => b.text.includes("안전 가옥"))?.speaker, "권태현");
  });

  it("keeps a multi-paragraph GM aside as one italic table-talk beat", () => {
    const beats = parseTrpgSceneSpeech(
      `렌: "가자."\n\n문이 열린다.\n\nGM: "자, 이제 상황이 정리됐다.\n\n약국은 함정이야.\n\n안전 가옥으로 가자."`,
      ["렌"]
    );
    assert.equal(beats.find((b) => b.text.includes("가자") && b.speaker === "렌")?.speaker, "렌");
    const gm = beats.filter((b) => b.speaker === "GM");
    assert.equal(gm.length, 1);
    assert.match(gm[0]?.text ?? "", /정리됐다/);
    assert.match(gm[0]?.text ?? "", /안전 가옥/);
    assert.doesNotMatch(gm[0]?.text ?? "", /^"/);
    assert.equal(beats.filter((b) => /함정이야/.test(b.text)).length, 1);
  });

  it("does not label a handwritten note as the previous speaker", () => {
    const note =
      "엄마가 깨어나지 않아요. 아빠는 문 밖에서 계속 내 이름을 불러요. 하지만 그건 아빠 목소리가 아니에요.";
    const afterSpeech = parseTrpgSceneSpeech(
      `렌: "지도 줘."\n\n종이를 펼치자, 손으로 그린 지도가 나타났다. 지도 아래쪽에는 떨리는 손글씨로 한 줄이 더 적혀 있었다.\n\n"${note}"\n\n렌은 고개를 갸웃거리며 종이를 뒤집어 보았다.`,
      ["렌", "권태현", "강이현"]
    );
    const quoted = afterSpeech.find((b) => b.text.includes("엄마가 깨어나지"));
    assert.ok(quoted);
    assert.equal(quoted?.speaker, null);
    assert.equal(afterSpeech.find((b) => b.text.includes("지도 줘"))?.speaker, "렌");

    const prefixed = parseTrpgSceneSpeech(
      `종이를 펼치자 떨리는 손글씨로 한 줄이 더 적혀 있었다.\n렌: "${note}"\n렌은 고개를 갸웃거렸다.`,
      ["렌"]
    );
    const asNote = prefixed.find((b) => b.text.includes("엄마가 깨어나지"));
    assert.ok(asNote);
    assert.equal(asNote?.speaker, null);
  });
});
