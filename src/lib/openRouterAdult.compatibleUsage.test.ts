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
  streamOpenRouterAdult,
  callOpenRouterAdult,
} from "./openRouterAdult";
import { SCENE_FLOW_BLOCK } from "./generationProcessBeatFlow";
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

  const cachedHistoryMessages = wireMessages
    .slice(1)
    .filter(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((block) => block.cache_control?.type === "ephemeral")
    );
  assert.equal(cachedHistoryMessages.length, 1);
});
