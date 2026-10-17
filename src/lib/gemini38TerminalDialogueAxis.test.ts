/**
 * Gemini 3.8 terminal dialogue axis — one replacement line inside the existing owner.
 * Provider-free. Other models and omitted model ids keep the shared line.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assemblePrimaryRpRequest, OPENROUTER_ADULT_MODEL } from "@/lib/openRouterAdult";
import { normalizeOpenRouterModelId } from "@/lib/openRouterConfig";
import {
  applyProductionServerControlsToMessages,
  GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE,
  renderTerminalDialogueBudgetOwner,
  TERMINAL_DIALOGUE_AXIS_LINE,
  TERMINAL_DIALOGUE_BUDGET_MARKER,
} from "@/lib/scenePacingController";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
  CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
  GEMINI_38_FLASH_MODEL,
  GEMINI_4_ARGON_MODEL,
  OPENROUTER_GEMINI_38_FLASH_MODEL,
  OPENROUTER_GEMINI_4_ARGON_MODEL,
} from "@/lib/chatModels";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";
import { DIALOGUE_NARRATION_STRUCTURE_RULE } from "@/lib/webnovelOutputFormat";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { CURRENT_USER_INPUT_HEADER } from "@/lib/currentUserInputLabel";

const CEILING = "AI 측 직접 발화는 필요한 만큼 사용하되 최대 4개 블록으로 구성한다.";
const USER_TEXT = '렌은 창틀에서 한 걸음 떨어져 불빛만 본다. "오늘은 그냥 이렇게 있자."';

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function lastUser(messages: Array<{ role: string; content: string }>): string {
  return [...messages].reverse().find((message) => message.role === "user")!.content;
}

function apply(modelId?: string, extra?: { party?: boolean; contentKind?: "character" | "simulation" }) {
  return applyProductionServerControlsToMessages({
    messages: [
      {
        role: "system",
        content: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n`,
      },
      {
        role: "user",
        content: `${CURRENT_USER_INPUT_HEADER}\n\n${USER_TEXT}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`,
      },
    ],
    mode: "interactive",
    contentKind: extra?.contentKind ?? "character",
    party: extra?.party ?? false,
    primaryCharacterName: "라이크",
    currentUserMessage: USER_TEXT,
    recentMessages: [
      { role: "assistant", content: "밤의 숙소는 조용했다. 태형은 창가의 렌을 바라보았다." },
    ],
    adultModeEnabled: false,
    chatId: "t",
    currentTurn: 3,
    modelId,
  });
}

function assemble(modelId?: string, controlsModelId?: string) {
  return assemblePrimaryRpRequest({
    system: `[CORE RP]\nok\n${SCENE_FLOW_BLOCK}\n${DIALOGUE_NARRATION_STRUCTURE_RULE}\n`,
    history: [
      { role: "assistant", content: "밤의 숙소는 조용했다." },
      {
        role: "user",
        content: `${CURRENT_USER_INPUT_HEADER}\n\n${USER_TEXT}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`,
      },
    ],
    ...(modelId ? { modelId } : {}),
    targetResponseChars: 3200,
    stream: true,
    messageOpts: {
      charName: "라이크",
      personaName: "렌",
      sessionId: "chat-1",
      sceneServerControls: {
        mode: "interactive",
        contentKind: "character",
        party: false,
        primaryCharacterName: "라이크",
        currentUserMessage: USER_TEXT,
        recentMessages: [
          { role: "assistant", content: "밤의 숙소는 조용했다." },
        ],
        adultModeEnabled: false,
        chatId: "chat-1",
        currentTurn: 3,
        ...(controlsModelId ? { modelId: controlsModelId } : {}),
      },
    },
  });
}

function flatMessages(result: ReturnType<typeof assemble>): string {
  return JSON.stringify(result.requestBody);
}

function flatMessageList(result: ReturnType<typeof assemble>): string {
  return JSON.stringify((result.requestBody as { messages?: unknown }).messages);
}

describe("Gemini 3.8 terminal dialogue axis", () => {
  it("keeps the shared line when the model is omitted, Sol, Opus, Argon, a retired Gemini id, or an unregistered lookalike", () => {
    const unchanged = [
      undefined,
      "",
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      "openai/gpt-6.1-sol",
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      GEMINI_4_ARGON_MODEL,
      OPENROUTER_GEMINI_4_ARGON_MODEL,
      "gemini-3.1-pro-preview",
      "google/gemini-3.1-pro-preview",
      "gemini-3.7-flash",
      "google/gemini-3.7-flash",
      "x-gemini-3.8-flash",
      "gemini-3.8-flash-extra",
      "google/gemini-3.8-flash-20260902",
      "prefix/google/gemini-3.8-flash",
      "gemini-3.8-flash:batch",
      "not-gemini-3.8-flash",
    ];
    for (const modelId of unchanged) {
      const owner = renderTerminalDialogueBudgetOwner(4, modelId);
      const lines = owner.split("\n");
      assert.equal(lines.length, 3, String(modelId));
      assert.equal(lines[0], TERMINAL_DIALOGUE_BUDGET_MARKER, String(modelId));
      assert.equal(lines[1], CEILING, String(modelId));
      assert.equal(lines[2], TERMINAL_DIALOGUE_AXIS_LINE, String(modelId));
      assert.equal(count(owner, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 0, String(modelId));
    }
  });

  it("replaces only the second line for canonical and wire Gemini 3.8 ids", () => {
    for (const modelId of [
      GEMINI_38_FLASH_MODEL,
      OPENROUTER_GEMINI_38_FLASH_MODEL,
      " Gemini-3.8-Flash ",
      "Google/Gemini-3.8-Flash",
    ]) {
      const owner = renderTerminalDialogueBudgetOwner(6, modelId);
      const lines = owner.split("\n");
      assert.equal(lines.length, 3, modelId);
      assert.equal(lines[0], TERMINAL_DIALOGUE_BUDGET_MARKER, modelId);
      assert.equal(
        lines[1],
        "AI 측 직접 발화는 필요한 만큼 사용하되 최대 6개 블록으로 구성한다.",
        modelId
      );
      assert.equal(lines[2], GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE, modelId);
      assert.equal(count(owner, TERMINAL_DIALOGUE_AXIS_LINE), 0, modelId);
      assert.equal(count(owner, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 1, modelId);
    }
  });

  it("inserts the Gemini line once through production controls and leaves the length owner last", () => {
    const applied = apply(OPENROUTER_GEMINI_38_FLASH_MODEL);
    const user = lastUser(applied.messages);
    assert.equal(count(user, TERMINAL_DIALOGUE_BUDGET_MARKER), 1);
    assert.equal(count(user, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 1);
    assert.equal(count(user, TERMINAL_DIALOGUE_AXIS_LINE), 0);
    assert.equal(count(user, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(user.indexOf(TERMINAL_DIALOGUE_BUDGET_MARKER) < user.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE));
    const again = applyProductionServerControlsToMessages({
      messages: applied.messages,
      mode: "interactive",
      contentKind: "character",
      party: false,
      primaryCharacterName: "라이크",
      currentUserMessage: USER_TEXT,
      recentMessages: [
        { role: "assistant", content: "밤의 숙소는 조용했다. 태형은 창가의 렌을 바라보았다." },
      ],
      adultModeEnabled: false,
      chatId: "t",
      currentTurn: 3,
      modelId: OPENROUTER_GEMINI_38_FLASH_MODEL,
    });
    assert.equal(lastUser(again.messages), user);
  });

  it("does not give the new owner to party or simulation turns", () => {
    for (const extra of [
      { party: true, contentKind: "character" as const },
      { party: false, contentKind: "simulation" as const },
    ]) {
      const user = lastUser(apply(GEMINI_38_FLASH_MODEL, extra).messages);
      assert.equal(count(user, TERMINAL_DIALOGUE_BUDGET_MARKER), 0);
      assert.equal(count(user, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 0);
      assert.equal(count(user, TERMINAL_DIALOGUE_AXIS_LINE), 0);
    }
  });

  it("threads the request model through assemblePrimaryRpRequest and keeps other models on the shared line", () => {
    const sharedIds = [
      undefined,
      CHEAPER_INFERENCE_GPT_61_SOL_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL,
      OPENROUTER_GEMINI_4_ARGON_MODEL,
    ];
    const sharedBodies = sharedIds.map((modelId) => flatMessages(assemble(modelId)));
    for (const body of sharedBodies) {
      assert.equal(count(body, TERMINAL_DIALOGUE_AXIS_LINE), 1);
      assert.equal(count(body, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 0);
      assert.equal(count(body, TERMINAL_DIALOGUE_BUDGET_MARKER), 1);
    }
    const geminiResult = assemble(OPENROUTER_GEMINI_38_FLASH_MODEL);
    const gemini = flatMessages(geminiResult);
    assert.equal(count(gemini, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 1);
    assert.equal(count(gemini, TERMINAL_DIALOGUE_AXIS_LINE), 0);
    assert.match(gemini, /google-ai-studio/);
    assert.match(gemini, /"service_tier":"flex"/);
    const solMessages = flatMessageList(assemble(CHEAPER_INFERENCE_GPT_61_SOL_MODEL));
    assert.equal(
      flatMessageList(geminiResult).split(GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE).join(TERMINAL_DIALOGUE_AXIS_LINE),
      solMessages
    );
    assert.equal(flatMessageList(assemble(CHEAPER_INFERENCE_CLAUDE_OPUS_55_MODEL)), solMessages);
    assert.equal(flatMessageList(assemble(OPENROUTER_GEMINI_4_ARGON_MODEL)), solMessages);
    assert.equal(flatMessageList(assemble(undefined)), solMessages);
    const defaultModel = normalizeOpenRouterModelId(OPENROUTER_ADULT_MODEL);
    const controlsOnly = JSON.parse(flatMessages(assemble(undefined, GEMINI_38_FLASH_MODEL))) as {
      model: string;
    };
    assert.equal(controlsOnly.model, defaultModel);
    const controlsOnlyText = JSON.stringify(controlsOnly);
    if (
      defaultModel.toLowerCase() === GEMINI_38_FLASH_MODEL ||
      defaultModel.toLowerCase() === OPENROUTER_GEMINI_38_FLASH_MODEL
    ) {
      assert.equal(count(controlsOnlyText, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 1);
    } else {
      assert.equal(count(controlsOnlyText, TERMINAL_DIALOGUE_AXIS_LINE), 1);
      assert.equal(count(controlsOnlyText, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 0);
    }
    const requestWins = JSON.parse(
      flatMessages(assemble(CHEAPER_INFERENCE_GPT_61_SOL_MODEL, GEMINI_38_FLASH_MODEL))
    ) as { model: string };
    assert.equal(requestWins.model, CHEAPER_INFERENCE_GPT_61_SOL_MODEL);
    const requestWinsText = JSON.stringify(requestWins);
    assert.equal(count(requestWinsText, TERMINAL_DIALOGUE_AXIS_LINE), 1);
    assert.equal(count(requestWinsText, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 0);
    const explicitGemini = JSON.parse(
      flatMessages(assemble(OPENROUTER_GEMINI_38_FLASH_MODEL, CHEAPER_INFERENCE_GPT_61_SOL_MODEL))
    ) as { model: string };
    assert.equal(explicitGemini.model, OPENROUTER_GEMINI_38_FLASH_MODEL);
    const explicitGeminiText = JSON.stringify(explicitGemini);
    assert.equal(count(explicitGeminiText, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 1);
    assert.equal(count(explicitGeminiText, TERMINAL_DIALOGUE_AXIS_LINE), 0);
    const lookalike = flatMessages(assemble("google/gemini-3.8-flash-extra"));
    assert.equal(count(lookalike, GEMINI_38_TERMINAL_DIALOGUE_AXIS_LINE), 0);
    assert.equal(count(lookalike, TERMINAL_DIALOGUE_AXIS_LINE), 1);
  });
});
