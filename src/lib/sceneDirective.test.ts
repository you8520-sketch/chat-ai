import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSceneDirective,
  buildSceneDirectivePromptBlock,
  detectSceneStagnation,
  renderSceneDirectiveForPrompt,
  selectSceneIntensity,
} from "./sceneDirective";
import type { ChatMsg } from "@/lib/ai";

const reassuranceLoop: ChatMsg[] = [
  { role: "assistant", content: "괜찮아. 네가 말하지 않아도 돼." },
  { role: "user", content: "응." },
  { role: "assistant", content: "정말 괜찮아. 미안해." },
  { role: "user", content: "..." },
  { role: "assistant", content: "괜찮으면 그냥 곁에 있을게." },
];

describe("sceneDirective", () => {
  it("interactive mode keeps user intentional action and dialogue off-limits", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "interactive",
      recentMessages: reassuranceLoop,
      currentUserMessage: "응.",
    });

    assert.match(block, /모드: 일반 RP/);
    assert.match(block, /유저의 의도적 행동\/대사\/감정 결론은 쓰지 않는다/);
    assert.doesNotMatch(block, /persona_based_dialogue_allowed/);
  });

  it("auto progression allows persona-based user action while blocking abrupt identity overwrite", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "auto_progression",
      recentMessages: reassuranceLoop,
      currentUserMessage: "계속 진행",
    });

    assert.match(block, /모드: 자동진행/);
    assert.match(block, /유저 페르소나와 최근 말투에 맞는 행동\/대사를 쓸 수 있으나/);
    assert.match(block, /중대 결정은 갑자기 확정하지 않는다/);
  });

  it("auto progression prompt contains No False Shared Memory rule", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "auto_progression",
      recentMessages: reassuranceLoop,
      currentUserMessage: "계속 진행",
    });

    assert.match(block, /\[NO FALSE SHARED MEMORY\]/);
    assert.match(block, /전에 말했잖아/);
    assert.match(block, /불확실하면 질문, 관찰, 추측, 새 발견으로 처리한다/);
  });

  it("scene directive guidance prefers observation or question over fabricated prior dialogue", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "auto_progression",
      recentMessages: [],
      currentUserMessage: "문장을 바라본다.",
    });

    assert.match(block, /저 문장, 달리는 늑대처럼 보여/);
    assert.match(block, /저게 네 가문의 문장이야/);
    assert.match(block, /네가 전에 말했잖아\. 에카르트의 문장은 달리는 늑대라고/);
  });

  it("detects repeated reassurance stagnation", () => {
    assert.equal(detectSceneStagnation(reassuranceLoop), true);
  });

  it("does not mark active progressing scenes as stagnant", () => {
    const active: ChatMsg[] = [
      { role: "assistant", content: "문 너머에서 전화벨이 울리고 지하실의 표시가 바뀌었다." },
      { role: "user", content: "그쪽으로 이동한다." },
      { role: "assistant", content: "복도로 나가자 기록 보관함 앞에 단서가 놓여 있었다." },
      { role: "user", content: "문을 열어." },
    ];

    assert.equal(detectSceneStagnation(active), false);
  });

  it("selects low intensity for rest and romance scenes", () => {
    assert.equal(
      selectSceneIntensity({
        recentMessages: [{ role: "assistant", content: "식사 후 침대 곁에서 조용히 휴식했다." }],
        currentUserMessage: "조금만 쉬자.",
      }),
      0
    );
  });

  it("allows higher intensity for operation scenes", () => {
    const intensity = selectSceneIntensity({
      recentMessages: [{ role: "assistant", content: "작전 회의에서 침투 경로와 구출 요청을 논의했다." }],
      currentUserMessage: "추적을 계속하자.",
    });

    assert.ok(intensity >= 3);
  });

  it("biases toward a breather after recent high-intensity scenes", () => {
    const intensity = selectSceneIntensity({
      recentMessages: [
        { role: "assistant", content: "폭발과 전투 속에 건물이 붕괴했고, 아군이 배신했다." },
        { role: "user", content: "숨을 고른다." },
      ],
      currentUserMessage: "잠깐 멈춰.",
    });

    assert.ok(intensity <= 1);
  });

  it("renders Korean labels without raw enum values", () => {
    const directive = buildSceneDirective({
      mode: "auto_progression",
      recentMessages: reassuranceLoop,
      currentUserMessage: "계속",
    });
    const block = renderSceneDirectiveForPrompt(directive);

    assert.match(block, /전개 방향:/);
    assert.match(block, /권장 강도:/);
    assert.doesNotMatch(block, /auto_progression/);
    assert.doesNotMatch(block, /recentStagnation/);
    assert.doesNotMatch(block, /progressionTypes/);
    assert.doesNotMatch(block, /nextBeatHint/);
  });

  it("does not include hidden D-DAY death consequence in the next beat hint", () => {
    const block = buildSceneDirectivePromptBlock({
      mode: "interactive",
      recentMessages: [
        { role: "assistant", content: "D-DAY가 상태창에 표시되고 있다. 사망 조건은 아직 드러나지 않았다." },
        { role: "user", content: "숫자를 본다." },
      ],
      currentUserMessage: "D-DAY가 뭐야?",
    });

    assert.doesNotMatch(block, /D-DAY가 .*사망/);
    assert.doesNotMatch(block, /죽는 날/);
  });
});
