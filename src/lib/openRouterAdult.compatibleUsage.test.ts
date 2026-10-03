/**
 * SYNTHETIC COMPATIBILITY — CheaperInference billing envelope parsing.
 * Production Main RP may omit billing fields on the final stream event;
 * these fixtures protect Luna/non-stream and documented-envelope paths.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCacheAndPrefillForTransport,
  assemblePrimaryRpRequest,
  buildOpenRouterMessages,
  reprojectControlledTextOntoStructuredContent,
  streamOpenRouterAdult,
  callOpenRouterAdult,
} from "./openRouterAdult";
import { SCENE_FLOW_BLOCK } from "./generationProcessBeatFlow";
import { applyProductionServerControlsToMessages } from "./scenePacingController";
import { parseCompatibleUsage } from "./openRouterUsage";
import { tokenUsageFromOpenRouterBreakdown } from "./openRouterUsage";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("[SYNTHETIC] streamOpenRouterAdult captures CI billing envelope when provider sends it", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";

  globalThis.fetch = (async () =>
    sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello world." } }] })}\n\n`,
      `data: ${JSON.stringify({
        usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.01 },
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [],
        cheaper_inference: { billing: { billed_cost_usd: "0.008000" } },
      })}\n\n`,
      "data: [DONE]\n\n",
    ])) as typeof fetch;

  try {
    const gen = streamOpenRouterAdult(
      "system prompt",
      [{ role: "user", content: "hello" }],
      "gemini-3.7-flash",
      800,
      {
        allowOpenRouterUnderLengthRecovery: false,
        skipAssistantPrefill: true,
        transportProvider: "cheaperinference",
      }
    );

    let deltaCount = 0;
    while (true) {
      const { value, done } = await gen.next();
      if (done) {
        assert.equal(value.cheaperInferenceBilledCostUsd, 0.008);
        assert.equal(value.inputTokens, 1000);
        assert.equal(value.outputTokens, 200);
        break;
      }
      if (value) deltaCount += 1;
    }
    assert.ok(deltaCount >= 1);

    const breakdown = parseCompatibleUsage({
      usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.01 },
      cheaperInference: { billing: { billed_cost_usd: "0.008000" } },
    });
    assert.equal(breakdown.cheaperInferenceBilledCostUsd, 0.008);
    assert.equal(breakdown.upstreamCostUsd, 0.01);

    const tokenUsage = tokenUsageFromOpenRouterBreakdown(breakdown);
    assert.equal(tokenUsage.cheaperInferenceBilledCostUsd, 0.008);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

test("[SYNTHETIC] callOpenRouterAdult non-stream uses parseCompatibleUsage envelope precedence", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 200, cost: 0.01 },
        cheaper_inference: { billing: { billed_cost_usd: "0.008000" } },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  try {
    const result = await callOpenRouterAdult(
      "system prompt",
      [{ role: "user", content: "hello" }],
      "gemini-3.7-flash",
      800,
      {
        allowOpenRouterUnderLengthRecovery: false,
        skipAssistantPrefill: true,
        transportProvider: "cheaperinference",
      }
    );
    assert.equal(result.usage.cheaperInferenceBilledCostUsd, 0.008);
    assert.equal(result.text, "OK");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});


test("[SYNTHETIC] CI Anthropic scene controls preserve static/dynamic cache boundaries", () => {
  const systemSplit = {
    systemRulesBlock: `[RULES]\n${SCENE_FLOW_BLOCK}\n[RULES END]`,
    characterSettingsBlock: "[CHARACTER STATIC]\nHero is consistent.",
    dynamicBlock: "[DYNAMIC]\nMemory and current-turn state change here.",
  };
  const system = [
    systemSplit.systemRulesBlock,
    systemSplit.characterSettingsBlock,
    systemSplit.dynamicBlock,
  ].join("\n\n");
  const history = [
    { role: "user" as const, content: "u1" },
    { role: "assistant" as const, content: "a1" },
    { role: "user" as const, content: "u2" },
    { role: "assistant" as const, content: "a2" },
    { role: "user" as const, content: "current user turn" },
  ];

  const messageOpts = {
    transportProvider: "cheaperinference" as const,
    skipAssistantPrefill: true,
    systemSplit,
    sceneServerControls: {
      mode: "interactive" as const,
      contentKind: "character" as const,
      primaryCharacterName: "Hero",
      currentUserMessage: "current user turn",
      recentMessages: history,
      currentTurn: 5,
    },
  };
  const baseMessages = buildOpenRouterMessages(system, history, messageOpts);
  const preCachedMessages = applyCacheAndPrefillForTransport(
    { provider: "cheaperinference" },
    baseMessages,
    "claude-opus-5.5",
    "Hero",
    { skipAssistantPrefill: true }
  ).messages;

  const assembled = assemblePrimaryRpRequest({
    system,
    history,
    modelId: "claude-opus-5.5",
    targetResponseChars: 800,
    messageOpts,
    messagesOverride: preCachedMessages,
  });

  const wireMessages = assembled.requestBody.messages as Array<{
    role: string;
    content:
      | string
      | Array<{
          type: "text";
          text: string;
          cache_control?: { type: "ephemeral" };
        }>;
  }>;
  const systemMessage = wireMessages[0];
  assert.equal(systemMessage?.role, "system");
  assert.ok(Array.isArray(systemMessage?.content));

  const blocks = systemMessage!.content as Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.cache_control?.type, "ephemeral");
  assert.equal(blocks[1]?.cache_control?.type, "ephemeral");
  assert.equal(blocks[2]?.cache_control, undefined);
  assert.match(blocks[0]!.text, /\[SCENE PACING\]/);
  assert.doesNotMatch(blocks[0]!.text, /\[SCENE FLOW\]/);
  assert.equal(
    blocks[2]!.text,
    "[DYNAMIC]\nMemory and current-turn state change here."
  );

  const semanticReference = applyProductionServerControlsToMessages({
    messages: [
      { role: "system", content: system },
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ],
    ...messageOpts.sceneServerControls,
  });
  assert.equal(
    blocks.map((block) => block.text).join("\n\n"),
    semanticReference.messages[0]?.content
  );

  const cachedHistoryMessages = wireMessages
    .slice(1)
    .filter(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.cache_control?.type === "ephemeral")
    );
  assert.equal(
    cachedHistoryMessages.length,
    0,
    "mutable dynamic system tail must not create a write-only history cache prefix"
  );
});


test("[SYNTHETIC] CI Main RP sends stable prompt-cache session affinity as query params", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  let seenSession: string | null = null;
  let seenScope: string | null = null;
  let legacyHeaderSession: string | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seenSession = url.searchParams.get("x-ci-prompt-cache-session");
    seenScope = url.searchParams.get("x-ci-prompt-cache-scope");
    legacyHeaderSession = new Headers(init?.headers).get(
      "x-ci-prompt-cache-session"
    );
    return new Response(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }] })}\n\n`,
        `data: ${JSON.stringify({
          choices: [{ finish_reason: "stop" }],
          usage: { prompt_tokens: 100, completion_tokens: 10 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ]).body,
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "x-ci-request-id": "ci-test-1",
          "x-ci-prompt-cache-affinity": "hit",
        },
      }
    );
  }) as typeof fetch;

  try {
    const gen = streamOpenRouterAdult(
      "system prompt",
      [{ role: "user", content: "hello" }],
      "claude-opus-5.5",
      800,
      {
        allowOpenRouterUnderLengthRecovery: false,
        skipAssistantPrefill: true,
        transportProvider: "cheaperinference",
        sessionId: "chat-707",
      }
    );
    while (true) {
      const { done } = await gen.next();
      if (done) break;
    }
    assert.equal(seenScope, "session");
    assert.equal(seenSession, "chat-707");
    assert.equal(legacyHeaderSession, null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

function assembleSyntheticCacheSplit(input: {
  rules: string;
  character: string;
  dynamic: string;
  user: string;
  triggeredEventText?: string;
}) {
  const systemSplit = {
    systemRulesBlock: input.rules,
    characterSettingsBlock: input.character,
    dynamicBlock: input.dynamic,
  };
  const history = [{ role: "user" as const, content: input.user }];
  const sceneServerControls = {
    mode: "interactive" as const,
    contentKind: "character" as const,
    primaryCharacterName: "Hero",
    currentUserMessage: input.user,
    currentTurn: 4,
    triggeredEventText: input.triggeredEventText,
  };
  const assembled = assemblePrimaryRpRequest({
    system: [input.rules, input.character, input.dynamic].join("\n\n"),
    history,
    modelId: "deepseek-v4.1-flash",
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit,
      sceneServerControls,
    },
  });
  const semantic = applyProductionServerControlsToMessages({
    messages: [
      {
        role: "system",
        content: [input.rules, input.character, input.dynamic].join("\n\n"),
      },
      { role: "user", content: input.user },
    ],
    ...sceneServerControls,
  });
  return { assembled, semantic };
}

test("[SYNTHETIC] newline collapse and scene replace stay inside their own cache blocks", () => {
  const rules = `[RULES]\n\n\n${"안정 규칙".repeat(20)}`;
  const character = `[CHARACTER]\n${SCENE_FLOW_BLOCK}\n[CHARACTER END]`;
  const dynamic = `[DYNAMIC]\n${"메모리".repeat(20)}`;
  const { assembled, semantic } = assembleSyntheticCacheSplit({
    rules,
    character,
    dynamic,
    user: "잠깐 여기 있자",
  });
  const system = assembled.messages[0]?.content;
  assert.ok(Array.isArray(system));
  assert.equal(system.length, 3);
  assert.equal(system[0]?.cache_control?.type, "ephemeral");
  assert.equal(system[1]?.cache_control?.type, "ephemeral");
  assert.equal(system[2]?.cache_control, undefined);
  assert.match(system[0]!.text, /안정 규칙/);
  assert.doesNotMatch(system[0]!.text, /\n{3,}/);
  assert.match(system[1]!.text, /\[SCENE PACING\]/);
  assert.doesNotMatch(system[1]!.text, /\[SCENE FLOW\]/);
  assert.equal(system[2]!.text, dynamic);
  assert.equal(system.map((block) => block.text).join("\n\n"), semantic.messages[0]?.content);
  assert.equal(assembled.messages.at(-1)?.content, semantic.messages.at(-1)?.content);
  assert.equal(assembled.requestBody.model, "deepseek-v4.1-flash");
});

test("[SYNTHETIC] a separator-crossing edit still flattens", () => {
  const original = [
    { type: "text" as const, text: "RULES\n", cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: "\nCHARACTER", cache_control: { type: "ephemeral" as const } },
    { type: "text" as const, text: "DYNAMIC memory" },
  ];
  const before = original.map((block) => block.text).join("\n\n");
  const after = before.replace(/\n{3,}/g, "\n\n");
  assert.notEqual(before, after);
  const projected = reprojectControlledTextOntoStructuredContent(original, before, after);
  assert.equal(projected, after);
});

test("[SYNTHETIC] rules prefix stays put while memory and pacing move", () => {
  const rules = `[RULES]\n\n\n${"안정 규칙".repeat(20)}`;
  const character = `[CHARACTER]\n${SCENE_FLOW_BLOCK}\n[CHARACTER END]`;
  const quiet = assembleSyntheticCacheSplit({
    rules,
    character,
    dynamic: "[DYNAMIC]\nmemory-quiet",
    user: "잠깐 여기 있자",
  });
  const advanced = assembleSyntheticCacheSplit({
    rules,
    character,
    dynamic: "[DYNAMIC]\nmemory-advanced",
    user: "다음 장소로 이동하자",
    triggeredEventText: "문이 열리고 알려진 인물이 들어온다",
  });
  const quietSystem = quiet.assembled.messages[0]?.content;
  const advancedSystem = advanced.assembled.messages[0]?.content;
  assert.ok(Array.isArray(quietSystem));
  assert.ok(Array.isArray(advancedSystem));
  assert.equal(quietSystem[0]!.text, advancedSystem[0]!.text);
  assert.notEqual(quietSystem[1]!.text, advancedSystem[1]!.text);
  assert.notEqual(quietSystem[2]!.text, advancedSystem[2]!.text);
  assert.equal(quietSystem[2]?.cache_control, undefined);
  assert.equal(advancedSystem[2]?.cache_control, undefined);
  assert.match(quietSystem[1]!.text, /\[SCENE PACING\]/);
  assert.match(advancedSystem[1]!.text, /\[SCENE PACING\]/);
  assert.equal(quiet.assembled.requestBody.model, advanced.assembled.requestBody.model);
  assert.equal(
    quiet.assembled.requestBody.reasoning_effort,
    advanced.assembled.requestBody.reasoning_effort
  );
});
