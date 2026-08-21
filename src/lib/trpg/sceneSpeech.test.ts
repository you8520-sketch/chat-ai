import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { isTrpgSpeakerPrefix, parseTrpgSceneSpeech } from "./sceneSpeech";

describe("parseTrpgSceneSpeech", () => {
  it("labels only explicit name-colon quoted speech", () => {
    const beats = parseTrpgSceneSpeech(
      `빗줄기가 창을 두드린다.\n\n렌: "안전가옥으로 가자."\n\n강이현: "저쪽부터 볼까?"`,
      ["렌", "강이현"]
    );
    assert.equal(beats[0]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /빗줄기/);
    assert.equal(beats[1]?.speaker, "렌");
    assert.match(beats[1]?.text ?? "", /안전가옥으로 가자/);
    assert.equal(beats[2]?.speaker, "강이현");
    assert.match(beats[2]?.text ?? "", /저쪽부터 볼까/);
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

  it("keeps a simile quote as unlabeled narration", () => {
    const beats = parseTrpgSceneSpeech(
      `그는 마치 동네 산책길에서 "저기 공원으로 갈까?" 하고 묻는 듯한 톤을 유지했다.`,
      ["렌", "강이현"]
    );
    assert.equal(beats.length, 1);
    assert.equal(beats[0]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /저기 공원으로 갈까/);
    assert.ok(beats.every((b) => b.speaker !== "강이현" && b.speaker !== "렌"));
  });

  it("keeps written and remembered quotes as narration", () => {
    const written = parseTrpgSceneSpeech(`벽에는 "접근 금지"라고 쓰여 있었다.`, ["렌"]);
    assert.equal(written.length, 1);
    assert.equal(written[0]?.speaker, null);
    const remembered = parseTrpgSceneSpeech(`그는 예전의 "다시 오겠다"는 말을 떠올렸다.`, ["렌"]);
    assert.equal(remembered.length, 1);
    assert.equal(remembered[0]?.speaker, null);
  });

  it("labels an explicit unknown NPC speaker", () => {
    const beats = parseTrpgSceneSpeech(`골목이 조용하다.\n경비원: "멈춰."`, ["렌"]);
    assert.equal(beats.find((b) => b.text.includes("골목"))?.speaker, null);
    assert.equal(beats.find((b) => b.text.includes("멈춰"))?.speaker, "경비원");
  });

  it("does not carry a previous speaker onto an unlabeled quote", () => {
    const beats = parseTrpgSceneSpeech(
      `렌: "안전가옥으로 가자."\n\n"정말 그럴까?"\n\n문이 삐걱였다.`,
      ["렌", "강이현"]
    );
    assert.equal(beats.find((b) => b.text.includes("안전가옥"))?.speaker, "렌");
    assert.equal(beats.find((b) => b.text.includes("정말 그럴까"))?.speaker, null);
    assert.equal(beats.find((b) => b.text.includes("삐걱"))?.speaker, null);
  });

  it("does not promote a name-only paragraph or a speech-verb guess", () => {
    const nameOnly = parseTrpgSceneSpeech(
      `강이현\n\n"약국은 지금 함정이야."\n\n그는 석궁을 접었다.`,
      ["강이현"]
    );
    assert.ok(nameOnly.every((b) => b.speaker == null));
    const afterVerb = parseTrpgSceneSpeech(
      `태현이 낮게 말했다.\n\n"야, 렌. 잠깐..."`,
      ["권태현", "렌"]
    );
    assert.ok(afterVerb.every((b) => b.speaker == null));
  });

  it("leaves inline hypothetical quotes inside the narration paragraph", () => {
    const beats = parseTrpgSceneSpeech(
      `권태현은 렌의 말에 입꼬리를 비틀며 마체테를 어깨에서 내렸다. "그래, 약국에 쓸만한 거 있을지도 모르는데." 그는 낮게 웃었다.`,
      ["권태현", "렌"]
    );
    assert.equal(beats.length, 1);
    assert.equal(beats[0]?.speaker, null);
    assert.match(beats[0]?.text ?? "", /약국에/);
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

  it("keeps a handwritten note unlabeled even after a speaker line", () => {
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
  });

  it("keeps the scene accent rail off unlabeled narration", () => {
    const prose = fs.readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    assert.doesNotMatch(prose, /border-zinc-500\/70/);
    assert.match(prose, /showRail/);
    assert.match(prose, /resolveTrpgSpeakerRail/);
    const room = fs.readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /accent=\{Boolean\(beat\.speaker\)/);
    assert.match(room, /accent=\{false\}/);
    assert.match(room, /dialogueAccent=\{false\}/);
    assert.doesNotMatch(room, /isTrpgQuotedSpeech\(beat\.text\)/);
    assert.match(room, /GM 판정용/);
    assert.match(room, /formatTrpgRollCompact/);
    assert.match(room, /showCompactRoll/);
    assert.match(room, /shouldShowActionJudgeBlock/);
    assert.match(room, /showCompactRoll && roll/);
    assert.match(room, /판정 없음 · 대화/);
    assert.match(room, /TrpgRollResultLane/);
    assert.doesNotMatch(room, /<TrpgD20/);
    assert.doesNotMatch(room, /DiceActionBody/);
    assert.match(room, /paragraphMode=\{action\.kind === "ai_character" \? "ai" : "author"\}/);
    assert.match(room, /orphanTrpgRolls/);
    assert.match(room, /mergeTrpgActionRolls/);
    assert.match(room, /gmFailureHint/);
    assert.match(room, /billing_insufficient/);
    assert.match(room, /data-trpg-action-card/);
    const named = fs.readFileSync("src/app/trpg/TrpgNamedProse.tsx", "utf8");
    assert.match(named, /paragraphMode = "author"/);
    assert.match(named, /streaming=\{reveal\}/);
    assert.match(named, /grid-cols-1/);
    assert.match(named, /sm:grid-cols-\[5\.75rem_minmax\(0,1fr\)\]/);
    assert.match(named, /hideMobileLabel/);
    assert.match(named, /showRail \? "pl-3 sm:pl-4" : "sm:pl-4"/);
    const resultLane = fs.readFileSync("src/app/trpg/TrpgRollResultLane.tsx", "utf8");
    assert.match(resultLane, /items-center justify-between/);
    assert.match(resultLane, /compactName[\s\S]*\{d20\}[\s\S]*\{outcome\}/);
    assert.match(room, /hideMobileLabel=\{showResultLane\}/);
    const reveal = fs.readFileSync("src/app/trpg/useRevealedText.ts", "utf8");
    assert.match(reveal, /trpgRevealChunkSize/);
    assert.match(reveal, /prefers-reduced-motion/);
    assert.doesNotMatch(reveal, /n \+ 4/);
  });
});
