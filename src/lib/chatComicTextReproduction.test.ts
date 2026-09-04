import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  isEligibleSpeechDialogue,
} from "@/lib/chatImageScenePlan";

describe("Comic text pipeline reproduction tests (R1-R4)", () => {
  it("R1: same line duplicated to two different speakers in one panel is prevented", () => {
    // User says "내가 좋아?", Assistant quotes user: "내가 좋아?" ...
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"내가 좋아?"' },
      {
        id: 2,
        role: "assistant",
        content: '"내가 좋아?" 렌의 말에 라이크는 픽 웃으며 다가왔다. "그걸 말이라고 물어?"',
      },
    ]);

    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });

    // In panel 1, assistant must not receive the user's echoed quote as character speech
    const characterEcho = plan.panels
      .flatMap((p) => p.dialogue)
      .find((d) => d.speaker === "character" && d.text.includes("내가 좋아?"));
    assert.equal(characterEcho, undefined, "Assistant echo must not be assigned to character");
  });

  it("R2: non-dialogue fragment like '살상 무기' is not classified as speech", () => {
    assert.equal(isEligibleSpeechDialogue("살상 무기"), false, "bare noun phrase without speech cues");
    assert.equal(isEligibleSpeechDialogue("임무 완료."), true, "'임무 완료.' is speech");
    assert.equal(isEligibleSpeechDialogue("작전 종료."), true, "'작전 종료.' is speech");
    assert.equal(isEligibleSpeechDialogue("내가 좋아?"), true, "'내가 좋아?' is speech");
    assert.equal(isEligibleSpeechDialogue("덤벼라."), true, "'덤벼라.' is speech");

    // In messages:
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: "*검을 겨눈다* 살상 무기" },
      {
        id: 2,
        role: "assistant",
        content: '라이크는 "살상 무기"라 불리는 검을 뽑았다. "덤벼라."',
      },
    ]);

    const events = extractDeterministicEvents(messages);
    const dialogueEvents = events.filter((e) => e.kind === "dialogue");
    const dialogueTexts = dialogueEvents.map((e) => e.text);

    assert.ok(
      !dialogueTexts.includes("살상 무기"),
      `'살상 무기' must not be in dialogue events, got: ${JSON.stringify(dialogueTexts)}`
    );

    const plan = buildDeterministicScenePlan(messages, 2);
    const allDialogues = plan.panels.flatMap((p) => p.dialogue).map((d) => d.text);
    assert.ok(
      !allDialogues.includes("살상 무기"),
      `'살상 무기' must not be in panel dialogues, got: ${JSON.stringify(allDialogues)}`
    );
  });

  it("R3: genuine postposed repetition keeps both speakers; recap drops duplicate", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"내가 좋아?"' },
      {
        id: 2,
        role: "assistant",
        content: [
          '"내가 좋아?" 라이크는 잠시 멈칫했다.',
          '"좋아해, 렌. 아주 많이."',
          '"그러니까 어디 가지 마."',
        ].join("\n"),
      },
    ]);

    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });

    const dialogues = plan.panels.flatMap((p) => p.dialogue);
    const userLikes = dialogues.filter((d) => d.text === "내가 좋아?");
    assert.equal(userLikes.length, 2, "Genuine postposed repetition keeps persona + character lines");
    assert.ok(userLikes.some((line) => line.speaker === "persona"));
    assert.ok(userLikes.some((line) => line.speaker === "character"));

    const aiResponses = dialogues.filter((d) => d.speaker === "character");
    assert.ok(aiResponses.length >= 2, "Character keeps repetition plus follow-up responses");
  });

  it("R4: named speakers (렌 / 라이크 / other) preserve distinct mapping", () => {
    const messages = buildSceneSourceMessages([
      {
        id: 1,
        role: "assistant",
        content: [
          '렌: "누구냐."',
          '라이크: "나다, 렌."',
          '경비병: "둘 다 멈춰라!"',
        ].join("\n"),
      },
    ]);

    const plan = buildDeterministicScenePlan(messages, 3, {
      personaName: "렌",
      characterName: "라이크",
      knownSpeakerNames: ["경비병"],
    });

    const dialogues = plan.panels.flatMap((p) => p.dialogue);
    const ren = dialogues.find((d) => d.text.includes("누구냐"));
    assert.ok(ren);
    assert.equal(ren.speaker, "persona");
    assert.equal(ren.speakerName, "렌");

    const like = dialogues.find((d) => d.text.includes("나다, 렌"));
    assert.ok(like);
    assert.equal(like.speaker, "character");
    assert.equal(like.speakerName, "라이크");

    const guard = dialogues.find((d) => d.text.includes("멈춰라"));
    assert.ok(guard);
    assert.equal(guard.speaker, "other");
    assert.equal(guard.speakerName, "경비병");
  });

  it("ECHO-2: genuine same-text repetition from different speakers survives", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"가지 마."' },
      {
        id: 2,
        role: "assistant",
        content: '"가지 마."\n"이번엔 내가 할 말이야."',
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const goAway = plan.panels.flatMap((p) => p.dialogue).filter((d) => d.text.includes("가지 마."));
    assert.equal(goAway.length, 2, "Both persona and character may say the same line genuinely");
    assert.ok(goAway.some((d) => d.speaker === "persona"));
    assert.ok(goAway.some((d) => d.speaker === "character"));
    const sourceIds = new Set(goAway.map((d) => d.sourceEventId).filter(Boolean));
    assert.equal(sourceIds.size, 2, "Distinct sourceEventIds for genuine repetition");
  });
});
