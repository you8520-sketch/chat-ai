/**
 * Communication-demand evidence: a single comm keyword in history must not
 * corroborate itself. API=0 — deterministic heuristics only.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMsg } from "@/lib/ai";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { buildSceneDirective } from "@/lib/sceneDirective";
import {
  resolveCommunicationDemand,
  resolveScenePacingDecision,
  resolveTerminalDialogueBudget,
} from "@/lib/scenePacingController";

const PRIMARY = "라이크";

function budgetFor(input: {
  currentUserMessage: string;
  recentMessages: ChatMsg[];
  knownSupportingCastNames?: string[];
  currentTurn?: number;
}) {
  const directive = buildSceneDirective({
    mode: "interactive",
    contentKind: "character",
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    primaryCharacterName: PRIMARY,
    knownSupportingCastNames: input.knownSupportingCastNames,
    currentTurn: input.currentTurn ?? 1,
    progressionHistory: [],
  });
  const decision = resolveScenePacingDecision({
    contentKind: "character",
    recentMessages: input.recentMessages,
    currentUserMessage: input.currentUserMessage,
    primaryCharacterName: PRIMARY,
    knownSupportingCastNames: input.knownSupportingCastNames,
    currentTurn: input.currentTurn ?? 1,
    progressionHistory: [],
    canonicalSceneDirective: directive,
  });
  const demand = resolveCommunicationDemand({
    currentUserMessage: input.currentUserMessage,
    recentMessages: input.recentMessages,
    decision,
    knownSupportingCastNames: input.knownSupportingCastNames,
  });
  const budget = resolveTerminalDialogueBudget({
    decision,
    communicationDemand: demand,
  });
  return { decision, demand, budget };
}

describe("communication demand — keyword is not its own corroboration", () => {
  it("creator greeting with only a radio sound stays quiet_dyad (4)", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "…그냥 좀 쉬고 싶어. 잠깐만 이대로 있자.",
      recentMessages: [
        { role: "user", content: OPENING_TURN_USER },
        {
          role: "assistant",
          content:
            '창밖에서 낡은 무전기 소리가 지직거렸다. 라이크가 고개를 들었다.\n\n"왔어? 앉아."',
        },
      ],
    });
    assert.notEqual(demand, "HIGH");
    assert.equal(budget.maxBlocks, 4);
    assert.equal(budget.reason, "quiet_dyad");
  });

  it("broken radio mentioned in an earlier turn with no live comm stays 4", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "오늘은 아무 일도 없었으면 좋겠다.",
      currentTurn: 4,
      recentMessages: [
        { role: "user", content: "무전기 고장났네." },
        {
          role: "assistant",
          content: "고장 난 무전기는 선반 위에 놓여 있다. 라이크가 한숨을 쉬었다.",
        },
      ],
    });
    assert.notEqual(demand, "HIGH");
    assert.equal(budget.maxBlocks, 4);
  });

  it("radio only as a background prop stays 4", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "차 한 잔 더 줄래?",
      currentTurn: 3,
      recentMessages: [
        { role: "user", content: "여기 편하네." },
        {
          role: "assistant",
          content: "책상 모서리에 낡은 무전기가 놓여 있다. 전원은 꺼져 있다.",
        },
      ],
    });
    assert.notEqual(demand, "HIGH");
    assert.equal(budget.maxBlocks, 4);
  });

  it("user asking to rest quietly stays 4 even with a past radio line", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "오늘은 조용히 쉬자. 아무 연락도 오지 않았으면 좋겠어.",
      currentTurn: 5,
      recentMessages: [
        { role: "user", content: "아까 무전 소리 들었어?" },
        {
          role: "assistant",
          content: "무전기는 한참 전에 꺼졌다. 이제 방 안은 조용하다.",
        },
      ],
    });
    assert.notEqual(demand, "HIGH");
    assert.equal(budget.maxBlocks, 4);
  });
});

describe("communication demand — real communication keeps 6", () => {
  it("live exchange with a grounded remote speaker is HIGH", () => {
    const recentMessages: ChatMsg[] = [
      {
        role: "assistant",
        content:
          '무전기에서 카인의 보고가 올라왔다.\n\n"라이크, 수신되나. 남측 농도 급변."',
      },
    ];
    const { demand, budget } = budgetFor({
      currentUserMessage: "카인한테 뭐라고 답할까?",
      currentTurn: 5,
      recentMessages,
      knownSupportingCastNames: ["카인"],
    });
    assert.equal(demand, "HIGH");
    assert.equal(budget.maxBlocks, 6);
    assert.equal(budget.reason, "communication_heavy");
  });

  it("user demanding a radio reply is HIGH", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "무전으로 응답해. 들리나?",
      currentTurn: 4,
      recentMessages: [
        { role: "assistant", content: "무전기가 지직거린다. 누군가 부르고 있다." },
      ],
    });
    assert.equal(demand, "HIGH");
    assert.equal(budget.maxBlocks, 6);
  });

  it("negotiation demanded by the user is HIGH", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "저쪽과 협상해야 해. 내가 먼저 말할까?",
      currentTurn: 4,
      recentMessages: [
        { role: "assistant", content: "상대 대표가 테이블 맞은편에 앉아 있다." },
      ],
    });
    assert.equal(demand, "HIGH");
    assert.equal(budget.maxBlocks, 6);
  });

  it("an ongoing exchange the user directed last turn stays HIGH", () => {
    const { demand, budget } = budgetFor({
      currentUserMessage: "…계속 들어봐.",
      currentTurn: 6,
      recentMessages: [
        { role: "user", content: "무전으로 응답해. 들리나?" },
        {
          role: "assistant",
          content: '무전기 너머에서 잡음 섞인 목소리가 이어졌다. "…남쪽이다."',
        },
      ],
    });
    assert.equal(demand, "HIGH");
    assert.equal(budget.maxBlocks, 6);
  });

  it("operation-scoped report keeps the 6 budget", () => {
    const { budget } = budgetFor({
      currentUserMessage: "습격이다! 엄호해! 본부에 보고해!",
      currentTurn: 8,
      recentMessages: [
        {
          role: "assistant",
          content: "경보가 울렸다. 라이크는 전투 태세로 몸을 낮췄다.",
        },
      ],
    });
    assert.equal(budget.maxBlocks, 6);
  });
});
