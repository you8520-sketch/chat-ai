import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasExplicitSpeakerAttributionBeforeQuote,
  isEligibleSpeechDialogue,
  isQuotedTermOrLabelNotSpeech,
} from "./chatImageSceneBrief";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
  extractDeterministicEvents,
  validateScenePlan,
} from "./chatImageScenePlan";
import { compileComicTextOverlaySvg } from "./chatComicTextOverlay";

describe("dialogue classification matrix Q1-Q7", () => {
  it("Q1: quoted term in narration is not speech", () => {
    const message = '라이크는 "살상 무기"라 불리는 검을 뽑았다.';
    const start = message.indexOf('"살상 무기"');
    const end = start + '"살상 무기"'.length;
    assert.equal(
      isQuotedTermOrLabelNotSpeech({ messageText: message, quoteStart: start, quoteEnd: end }),
      true
    );
    assert.equal(isEligibleSpeechDialogue("살상 무기", { messageText: message, quoteStart: start, quoteEnd: end }), false);
  });

  it("Q2: attributed quoted speech remains speech", () => {
    const q2 = '라이크: "살상 무기."';
    const q2Start = q2.indexOf('"살상 무기."');
    assert.equal(hasExplicitSpeakerAttributionBeforeQuote(q2, q2Start), true);
    assert.equal(isEligibleSpeechDialogue("살상 무기.", { messageText: q2, quoteStart: q2Start, quoteEnd: q2Start + 9 }), true);
  });

  it("Q3: standalone quoted imperative remains speech", () => {
    assert.equal(isEligibleSpeechDialogue("임무 완료."), true);
  });

  it("Q4: standalone quoted short speech remains speech", () => {
    assert.equal(isEligibleSpeechDialogue("작전 종료."), true);
    assert.equal(isEligibleSpeechDialogue("경고."), true);
  });

  it("Q5: sign label quote is not speech", () => {
    const message = '"접근 금지"라고 적힌 표지판';
    const start = message.indexOf('"접근 금지"');
    const end = start + '"접근 금지"'.length;
    assert.equal(
      isQuotedTermOrLabelNotSpeech({ messageText: message, quoteStart: start, quoteEnd: end }),
      true
    );
    assert.equal(isEligibleSpeechDialogue("접근 금지", { messageText: message, quoteStart: start, quoteEnd: end }), false);
  });

  it("Q6: unquoted noun fragment after action is not speech", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "*검을 든다* 살상 무기" },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    assert.equal(plan.panels.flatMap((panel) => panel.dialogue).some((line) => line.text === "살상 무기"), false);
  });

  it("Q7: user_edit noun phrase bypasses automatic speech filter", () => {
    const messages = buildSceneSourceMessages([{ id: 1, role: "assistant", content: '"안녕."' }]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const edited = {
      ...plan,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [{ speaker: "character" as const, text: "살상 무기", provenance: "user_edit" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(edited, messages, { allowUserEdits: true });
    assert.equal(validated.ok, true);
    if (validated.ok) {
      assert.equal(validated.plan.panels[0]!.dialogue[0]?.text, "살상 무기");
      const svg = compileComicTextOverlaySvg({
        width: 1008,
        height: 1408,
        panelCount: 2,
        plan: validated.plan,
      });
      assert.ok(svg.includes("살상 무기"));
    }
  });
});

describe("echo provenance matrix E1-E4", () => {
  it("E1 RECAP: assistant reaction to prior user quote drops duplicate recap", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"내가 좋아?"' },
      {
        id: 2,
        role: "assistant",
        content: '"내가 좋아?" 렌의 말에 라이크는 픽 웃었다.\n"그걸 말이라고 물어?"',
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const texts = plan.panels.flatMap((panel) => panel.dialogue.map((line) => line.text));
    assert.equal(texts.filter((text) => text === "내가 좋아?").length, 1);
    assert.ok(texts.includes("그걸 말이라고 물어?"));
  });

  it("E2 GENUINE POSTPOSED REPETITION: same-text genuine events survive", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"가지 마."' },
      {
        id: 2,
        role: "assistant",
        content: '"가지 마." 라이크가 낮게 되풀이했다.\n"이번엔 내가 할 말이야."',
      },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const lines = plan.panels.flatMap((panel) => panel.dialogue);
    const goAway = lines.filter((line) => line.text === "가지 마.");
    assert.equal(goAway.length, 2);
    assert.ok(goAway.some((line) => line.speaker === "persona"));
    assert.ok(goAway.some((line) => line.speaker === "character"));
    assert.ok(lines.some((line) => line.text === "이번엔 내가 할 말이야."));
  });

  it("E3 ORDINARY POSTPOSED SPEECH: 왜? remains character speech", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "assistant", content: '"왜?" 라이크가 물었다.' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2, {
      personaName: "렌",
      characterName: "라이크",
    });
    const line = plan.panels.flatMap((panel) => panel.dialogue).find((row) => row.text === "왜?");
    assert.ok(line);
    assert.equal(line?.speaker, "character");
  });

  it("E4 DUPLICATE SOURCE EVENT: first wins exactly once", () => {
    const messages = buildSceneSourceMessages([
      { id: 1, role: "user", content: '"안녕."' },
      { id: 2, role: "assistant", content: '"그래."' },
    ]);
    const plan = buildDeterministicScenePlan(messages, 2);
    const line = plan.panels[0]!.dialogue[0]!;
    const forged = {
      sceneBackground: plan.sceneBackground,
      heroEventIds: plan.heroEventIds,
      heroScene: plan.heroScene,
      recommendedPanelCount: 2,
      panels: plan.panels.map((panel, index) =>
        index === 0
          ? {
              ...panel,
              dialogue: [line, { ...line, provenance: "source" as const }],
            }
          : panel
      ),
    };
    const validated = validateScenePlan(forged, messages);
    assert.equal(validated.ok, true);
    if (validated.ok) {
      const sourceId = line.sourceEventId!;
      assert.equal(
        validated.plan.panels[0]!.dialogue.filter((row) => row.sourceEventId === sourceId).length,
        1
      );
    }
    const events = extractDeterministicEvents(messages);
    assert.equal(events.filter((event) => event.kind === "assistant_echo").length, 0);
  });
});
