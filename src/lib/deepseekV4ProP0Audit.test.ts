import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assemblePrimaryRpRequest, convertToOpenRouterFormat } from "@/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { estimateTokens } from "@/lib/tokenEstimate";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import { buildContext } from "@/services/contextBuilder";
import type { ContextBuildInput } from "@/types";

const FIXTURE: ContextBuildInput = {
  charName: "Fixture Character",
  contentKind: "character",
  chunks: [
    {
      id: "fixture-character",
      characterId: "p0",
      content: "[Identity]\nFixture Character is observant and restrained.",
      category: "identity",
      importance: "CRITICAL",
      tokenCount: 12,
      keywords: ["fixture"],
    },
    {
      id: "fixture-world",
      characterId: "p0",
      content: "[World]\nThe fixture scene takes place in a quiet observatory.",
      category: "world",
      importance: "CONTEXTUAL",
      tokenCount: 12,
      keywords: ["observatory"],
    },
  ],
  userNickname: "Fixture User",
  personaDisplayName: "Fixture User",
  userPersona: "PERSONA_FIXTURE_CONTENT\nThe user is a careful observer.",
  userNote: "[USER_NOTE_FIXTURE]\nPreserve the established relationship.",
  longTermMemory: "LTM_FIXTURE_CONTENT\nThey promised to return to the observatory.",
  memoryMeta: "MEMORY_META_FIXTURE_CONTENT\nRelationship: trusted companions.",
  episodicMemoryBlock: "EPISODIC_FIXTURE_CONTENT\n- The last visit ended at dawn.",
  shortTermHistory: [
    { role: "user", content: "RAW_USER_FIXTURE_CONTENT\nThe stairs were quiet." },
    {
      role: "assistant",
      content: "RAW_ASSISTANT_FIXTURE_CONTENT\nThe character listened at the door.",
    },
  ],
  currentUserMessage: "[CURRENT_USER_FIXTURE]\nDid you hear that?",
  nsfw: false,
  gender: "other",
  userPersonaGender: "other",
  modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  provider: "openrouter",
  userId: 1,
  chatId: 39,
  targetResponseChars: 3200,
  completedTurns: 2,
};

type WireMessage = {
  role: string;
  content: string | Array<{ text: string }>;
};

function flatten(content: WireMessage["content"]): string {
  return Array.isArray(content) ? content.map((block) => block.text).join("\n\n") : content;
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function buildFixturePayload() {
  const built = buildContext(FIXTURE);
  const requestHistory = convertToOpenRouterFormat(built.history);
  const assembled = assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: requestHistory,
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    targetResponseChars: 3200,
    stream: true,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: FIXTURE.charName,
      sceneServerControls: {
        contentKind: "character",
        party: false,
        primaryCharacterName: FIXTURE.charName,
        currentUserMessage: FIXTURE.currentUserMessage,
        recentMessages: FIXTURE.shortTermHistory,
        adultModeEnabled: false,
        chatId: FIXTURE.chatId,
        currentTurn: 3,
      },
    },
  });

  return { built, assembled };
}

describe("DeepSeek V4 Pro P0 deterministic primary payload audit", () => {
  it("keeps one terminal length owner at the absolute current-user tail", () => {
    const { built, assembled } = buildFixturePayload();
    const messages = assembled.requestBody.messages as WireMessage[];
    const finalUser = messages.at(-1);
    assert.equal(finalUser?.role, "user");
    assert.equal(typeof finalUser?.content, "string");

    const finalUserText = String(finalUser?.content);
    const prompt = messages.map((message) => flatten(message.content)).join("\n");
    assert.equal(countOccurrences(prompt, USER_TAIL_LENGTH_OWNER_SENTENCE), 1);
    assert.ok(finalUserText.endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));

    const dialogueBudgetIndex = finalUserText.indexOf("[이번 응답 대화]");
    const lengthOwnerIndex = finalUserText.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
    assert.ok(dialogueBudgetIndex >= 0);
    assert.ok(dialogueBudgetIndex < lengthOwnerIndex);
    assert.doesNotMatch(prompt, /\[DEEPSEEK LENGTH ADAPTER/);
    assert.doesNotMatch(prompt, /TARGET_LENGTH|MINIMUM_FLOOR|미달 조기 종료/);
    assert.equal(
      built.meta.trackedSections?.some((section) => section.id === "rule-length-control"),
      false
    );
  });

  it("reconstructs the CheaperInference DeepSeek wire body without a provider call", () => {
    const { assembled } = buildFixturePayload();
    const body = assembled.requestBody;

    assert.equal(body.model, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(assembled.transport.provider, "cheaperinference");
    assert.equal(assembled.transport.endpoint, "https://api.cheaperinference.com/v1/chat/completions");
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.temperature, 0.92);
    assert.equal(body.top_p, 0.92);
    assert.equal(body.frequency_penalty, undefined);
    assert.equal(body.presence_penalty, undefined);
    assert.equal(body.reasoning, undefined);
    assert.equal(body.reasoning_effort, undefined);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.provider, undefined);
  });

  it("preserves memory/history inputs and has zero prompt-token delta from reordering", () => {
    const { built, assembled } = buildFixturePayload();
    const messages = assembled.requestBody.messages as WireMessage[];
    const finalUser = String(messages.at(-1)?.content);
    const dialogueBudgetIndex = finalUser.indexOf("[이번 응답 대화]");
    const lengthOwnerIndex = finalUser.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE);
    const dialogueBudget = finalUser
      .slice(dialogueBudgetIndex, lengthOwnerIndex)
      .trim();
    const baselineFinalUser = [
      finalUser.slice(0, dialogueBudgetIndex).trimEnd(),
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      dialogueBudget,
    ].join("\n\n");
    const fixedPrompt = messages.map((message) => flatten(message.content)).join("\n");
    const baselinePrompt = messages
      .map((message, index) =>
        index === messages.length - 1 ? baselineFinalUser : flatten(message.content)
      )
      .join("\n");

    assert.equal(estimateTokens(fixedPrompt), estimateTokens(baselinePrompt));
    assert.ok(fixedPrompt.includes("LTM_FIXTURE_CONTENT"));
    assert.equal(fixedPrompt.includes("MEMORY_META_FIXTURE_CONTENT"), true);
    assert.equal(fixedPrompt.includes("EPISODIC_FIXTURE_CONTENT"), true);
    assert.equal(fixedPrompt.includes("RAW_USER_FIXTURE_CONTENT"), true);
    assert.equal(fixedPrompt.includes("RAW_ASSISTANT_FIXTURE_CONTENT"), true);
    assert.equal(fixedPrompt.includes("PERSONA_FIXTURE_CONTENT"), true);
    assert.equal(
      JSON.stringify(FIXTURE.shortTermHistory),
      JSON.stringify([
        { role: "user", content: "RAW_USER_FIXTURE_CONTENT\nThe stairs were quiet." },
        {
          role: "assistant",
          content: "RAW_ASSISTANT_FIXTURE_CONTENT\nThe character listened at the door.",
        },
      ])
    );
    assert.ok((built.meta.promptAudit?.totalAssembledTokens ?? 0) > 0);
  });
});
