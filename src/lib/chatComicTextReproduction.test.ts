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

    // In panel 1, we must NOT have two speakers saying "내가 좋아?"
    for (const panel of plan.panels) {
      const textsInPanel = panel.dialogue.map((d) => d.text.trim());
      const uniqueTexts = new Set(textsInPanel);
      assert.equal(
        textsInPanel.length,
        uniqueTexts.size,
        `Duplicate dialogue detected in panel ${panel.index}: ${JSON.stringify(textsInPanel)}`
      );
    }

    // Persona line "내가 좋아?" must belong to persona
    const personaLine = plan.panels
      .flatMap((p) => p.dialogue)
      .find((d) => d.text.includes("내가 좋아?"));
    assert.ok(personaLine, "Persona line should exist");
    assert.equal(personaLine?.speaker, "persona");

    // The echoed line must not be duplicated to character
    const characterEcho = plan.panels
      .flatMap((p) => p.dialogue)
      .find((d) => d.speaker === "character" && d.text.includes("내가 좋아?"));
    assert.equal(characterEcho, undefined, "Assistant echo must not be assigned to character");
  });

  it("R2: non-dialogue fragment like '살상 무기' is not classified as speech", () => {
    // Check helper
    assert.equal(isEligibleSpeechDialogue("살상 무기"), false, "'살상 무기' should not be speech");
    assert.equal(isEligibleSpeechDialogue("무기"), false, "'무기' should not be speech");
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

  it("R3: single user line + multiple AI lines has no blind echo duplication and correct ownership", () => {
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
    const userLikes = dialogues.filter((d) => d.text.includes("내가 좋아?"));
    assert.equal(userLikes.length, 1, "Only one '내가 좋아?' dialogue line across all panels");
    assert.equal(userLikes[0]?.speaker, "persona", "Spoken by persona");

    const aiResponses = dialogues.filter((d) => d.speaker === "character");
    assert.ok(aiResponses.length >= 1, "Character has genuine responses");
    assert.ok(
      aiResponses.every((d) => !d.text.includes("내가 좋아?")),
      "Character responses do not duplicate user line"
    );
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
});
