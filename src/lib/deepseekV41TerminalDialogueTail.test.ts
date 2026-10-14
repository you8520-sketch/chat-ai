/**
 * DeepSeek V4.1 Flash terminal dialogue wording — API=0 regression.
 * The model-specific variant must replace the existing second line of the
 * single `[이번 응답 대화]` owner, never add a second owner, never touch the
 * numeric ceiling / classifier, and never change any other model's wire.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemblePrimaryRpRequest } from "@/lib/openRouterAdult";
import {
  applyProductionServerControlsToMessages,
  renderTerminalDialogueBudgetOwner,
  TERMINAL_DIALOGUE_BUDGET_MARKER,
} from "@/lib/scenePacingController";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "@/lib/chatModels";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { DIALOGUE_NARRATION_STRUCTURE_RULE } from "@/lib/webnovelOutputFormat";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { CURRENT_USER_INPUT_HEADER } from "@/lib/currentUserInputLabel";
import type { ChatMsg } from "@/lib/ai";

const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL;
const BASE_AXIS_LINE =
  "유저가 반응할 질문·제안·요구는 하나의 중심축으로 모으고, [B]의 새 직접 발화·중대한 선택은 유저에게 남긴다.";
const B_OWNERSHIP = "[B]의 새 직접 발화·중대한 선택은 유저에게 남긴다";

function wire(userText: string) {
  return [
    {
      role: "system",
      content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n`,
    },
    {
      role: "user",
      content: `${CURRENT_USER_INPUT_HEADER}\n\n${userText}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`,
    },
  ];
}

type Scene = {
  name: string;
  userText: string;
  recent: ChatMsg[];
  party?: boolean;
  mode?: "interactive" | "auto_progression";
  expectBudget: boolean;
};

const QUIET_GREETING: ChatMsg[] = [
  { role: "assistant", content: "밤의 숙소는 조용했다. 태형은 창가의 렌을 바라보았다." },
];

const SCENES: Scene[] = [
  {
    name: "quiet 1:1",
    userText: '렌은 창틀에서 한 걸음 떨어져 불빛만 본다. "오늘은 그냥 이렇게 있자."',
    recent: QUIET_GREETING,
    expectBudget: true,
  },
  {
    name: "user explicitly wants conversation",
    userText: "렌이 몸을 돌린다. \"오늘 있었던 일, 하나씩 다 얘기해줘. 궁금한 거 있으면 얼마든지 물어봐.\"",
    recent: QUIET_GREETING,
    expectBudget: true,
  },
  {
    name: "ongoing radio / negotiation",
    userText: '렌이 무전기를 든다. "본부, 응답해. 지금 협상 상황을 보고해."',
    recent: [{ role: "assistant", content: "무전기에서 잡음 섞인 호출이 이어졌다. 응답하라는 목소리." }],
    expectBudget: true,
  },
  {
    name: "ended radio",
    userText: "어제 무전기가 고장났어. 오늘은 좀 조용하네.",
    recent: [{ role: "assistant", content: "문은 잠겼다. 소파에 앉아 숨을 고른다." }],
    expectBudget: true,
  },
  {
    name: "multi-character party",
    userText: '렌이 고개를 든다. "다들 들어와."',
    recent: QUIET_GREETING,
    party: true,
    expectBudget: false,
  },
  {
    name: "auto progression",
    userText: "(자동 진행) 장면을 이어간다.",
    recent: QUIET_GREETING,
    mode: "auto_progression",
    expectBudget: true,
  },
];

function apply(scene: Scene, modelId: string | undefined) {
  return applyProductionServerControlsToMessages({
    messages: wire(scene.userText),
    mode: scene.mode ?? "interactive",
    contentKind: "character",
    party: scene.party ?? false,
    primaryCharacterName: "라이크",
    currentUserMessage: scene.userText,
    recentMessages: scene.recent,
    adultModeEnabled: true,
    chatId: "t",
    currentTurn: 3,
    skipMotionCue: scene.mode === "auto_progression",
    modelId,
  });
}

function lastUser(applied: ReturnType<typeof apply>): string {
  return [...applied.messages].reverse().find((m) => m.role === "user")!.content;
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("DeepSeek V4.1 Flash terminal dialogue wording", () => {
  it("renders the base line byte-identically unless the model is DeepSeek V4.1 Flash", () => {
    const base = renderTerminalDialogueBudgetOwner(6);
    assert.ok(base.endsWith(BASE_AXIS_LINE));
    const others = [
      undefined,
      null,
      "",
      "google/gemini-3.8-flash",
      "gemini-3.8-flash",
      "gpt-6.1-sol",
      "claude-opus-5.5",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek/deepseek-v4-pro-0813",
      ...MAIN_RP_USER_SELECTABLE_OPTIONS.map((o) => o.id).filter((id) => id !== DEEPSEEK),
    ];
    for (const id of others) {
      assert.equal(renderTerminalDialogueBudgetOwner(6, id), base, String(id));
    }
  });

  it("replaces only the second line, keeps the ceiling line and [B] ownership", () => {
    for (const max of [4, 5, 6] as const) {
      const base = renderTerminalDialogueBudgetOwner(max);
      const ds = renderTerminalDialogueBudgetOwner(max, DEEPSEEK);
      const [baseMarker, baseCeiling] = base.split("\n");
      const dsLines = ds.split("\n");
      assert.equal(dsLines[0], baseMarker);
      assert.equal(dsLines[1], baseCeiling);
      assert.equal(dsLines.length, 3);
      assert.notEqual(dsLines[2], BASE_AXIS_LINE);
      assert.ok(dsLines[2]!.includes(B_OWNERSHIP));
      assert.ok(dsLines[2]!.includes("하나의 중심축"));
      assert.ok(dsLines[2]!.includes("되풀이하지 않고"));
      assert.ok(dsLines[2]!.includes("같은 화자의 이어지는 말은 한 블록으로 묶고"));
      assert.ok(dsLines[2]!.includes("행동·내면·감각·관계 변화"));
      assert.ok(dsLines[1]!.includes(`최대 ${max}개 블록`));
      assert.doesNotMatch(ds, /1~3|%|퍼센트|최대 [123]개/);
      assert.equal(count(ds, TERMINAL_DIALOGUE_BUDGET_MARKER), 1);
    }
  });

  for (const scene of SCENES) {
    it(`${scene.name}: DeepSeek differs from base only in the axis line; ceiling/classifier unchanged`, () => {
      const base = apply(scene, "google/gemini-3.8-flash");
      const ds = apply(scene, DEEPSEEK);
      assert.equal(
        JSON.stringify(ds.dialogueBudget),
        JSON.stringify(base.dialogueBudget),
        "numeric ceiling / classifier must not depend on model"
      );
      assert.equal(ds.terminalDialogueBudgetAppended, scene.expectBudget);
      const sysBase = base.messages.find((m) => m.role === "system")!.content;
      const sysDs = ds.messages.find((m) => m.role === "system")!.content;
      assert.equal(sysDs, sysBase, "system prompt must not change");

      const userBase = lastUser(base);
      const userDs = lastUser(ds);
      assert.equal(count(userDs, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
      assert.ok(userDs.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));

      if (!scene.expectBudget) {
        assert.equal(userDs, userBase);
        assert.equal(count(userDs, TERMINAL_DIALOGUE_BUDGET_MARKER), 0);
        assert.doesNotMatch(userDs, /되풀이하지 않고/);
        return;
      }
      assert.equal(count(userDs, TERMINAL_DIALOGUE_BUDGET_MARKER), 1);
      assert.equal(count(userDs, B_OWNERSHIP), 1);
      assert.equal(count(userDs, "하나의 중심축"), 1);
      assert.equal(userDs.replace(renderTerminalDialogueBudgetOwner(base.dialogueBudget!.maxBlocks!, DEEPSEEK), "X"),
        userBase.replace(renderTerminalDialogueBudgetOwner(base.dialogueBudget!.maxBlocks!), "X"));
      assert.ok(
        userDs.indexOf(TERMINAL_DIALOGUE_BUDGET_MARKER) <
          userDs.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
      );
    });
  }

  it("keeps legitimately needed dialogue: ceiling still 'as needed', radio keeps 6, no new numeric cap", () => {
    const radio = apply(SCENES[2]!, DEEPSEEK);
    assert.equal(radio.dialogueBudget?.maxBlocks, 6);
    assert.equal(radio.dialogueBudget?.communicationDemand, "HIGH");
    assert.match(lastUser(radio), /필요한 만큼 사용하되 최대 6개 블록/);
    const ended = apply(SCENES[3]!, DEEPSEEK);
    assert.equal(ended.dialogueBudget?.maxBlocks, 4);
    const conversation = apply(SCENES[1]!, DEEPSEEK);
    assert.match(lastUser(conversation), /필요한 만큼 사용하되 최대 \d개 블록/);
  });

  it("applying controls twice does not duplicate the owner (regen/continuation re-entry)", () => {
    const scene = SCENES[0]!;
    const first = apply(scene, DEEPSEEK);
    const second = applyProductionServerControlsToMessages({
      messages: first.messages,
      mode: "interactive",
      contentKind: "character",
      party: false,
      primaryCharacterName: "라이크",
      currentUserMessage: scene.userText,
      recentMessages: scene.recent,
      adultModeEnabled: true,
      chatId: "t",
      currentTurn: 3,
      modelId: DEEPSEEK,
    });
    assert.equal(lastUser(second), lastUser(first));
    assert.equal(count(lastUser(second), TERMINAL_DIALOGUE_BUDGET_MARKER), 1);
  });

  it("assemblePrimaryRpRequest: only DeepSeek V4.1 Flash final input changes, including regen overrides", () => {
    const scene = SCENES[0]!;
    const history = [
      { role: "assistant" as const, content: "밤의 숙소는 조용했다." },
      { role: "user" as const, content: wire(scene.userText)[1]!.content },
    ];
    const build = (modelId: string, regen: boolean) =>
      assemblePrimaryRpRequest({
        system: "[CORE RP]\nok\n" + SCENE_FLOW_BLOCK + "\n" + DIALOGUE_NARRATION_STRUCTURE_RULE + "\n",
        history,
        modelId,
        targetResponseChars: 3200,
        stream: true,
        messageOpts: {
          charName: "라이크",
          personaName: "렌",
          sessionId: "chat-1",
          transportProvider: modelId === DEEPSEEK ? "cheaperinference" : undefined,
          generationOverrides: regen ? { seed: 7 } : undefined,
          sceneServerControls: {
            mode: "interactive",
            contentKind: "character",
            party: false,
            primaryCharacterName: "라이크",
            currentUserMessage: scene.userText,
            recentMessages: scene.recent,
            adultModeEnabled: true,
            chatId: "chat-1",
            currentTurn: 3,
          },
        },
      });
    const flat = (r: ReturnType<typeof build>) => JSON.stringify(r.messages);
    for (const regen of [false, true]) {
      const ds = build(DEEPSEEK, regen);
      const dsFlat = flat(ds);
      assert.equal(count(dsFlat, TERMINAL_DIALOGUE_BUDGET_MARKER), 1);
      assert.match(dsFlat, /되풀이하지 않고/);
      for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
        if (option.id === DEEPSEEK) continue;
        const other = build(option.id, regen);
        const otherFlat = flat(other);
        assert.equal(count(otherFlat, TERMINAL_DIALOGUE_BUDGET_MARKER), 1, option.id);
        assert.doesNotMatch(otherFlat, /되풀이하지 않고/, option.id);
        assert.ok(otherFlat.includes(BASE_AXIS_LINE), option.id);
      }
    }
  });
});
