/**
 * PC-01..12 — CI Main RP gateway prompt-cache query policy (offline only).
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assemblePrimaryRpRequest,
  resolveMainRpProviderFetchUrl,
} from "@/lib/openRouterAdult";
import {
  CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL,
  CHEAPER_INFERENCE_PROMPT_CACHE_QUERY_PARAM,
  assertCheaperInferenceEndpoint,
  buildCheaperInferenceHeaders,
  cheaperInferenceChatCompletionsBaseUrl,
  resolveCheaperInferenceMainRpOpusFetchUrl,
} from "@/lib/cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "@/lib/chatModels";
import { rawRecentTurnsToHistory } from "@/lib/hybridMemory";
import { buildLikeScaleSnapshot } from "@/lib/opusGeminiSameSnapshotDiagnostic";
import {
  flattenOpenRouterMessageContent,
  type OpenRouterChatMessage,
  type OpenRouterContentBlock,
} from "@/lib/openRouterClient";
import { OPENROUTER_CHAT_COMPLETIONS_URL } from "@/lib/openRouterConfig";
import { buildContext } from "@/services/contextBuilder";
import { DEFAULT_TARGET_RESPONSE_CHARS } from "@/lib/responseLengthConstants";

const OPUS = CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL;

function promptCacheQueryCount(url: string): number {
  const parsed = new URL(url);
  return parsed.searchParams.getAll(CHEAPER_INFERENCE_PROMPT_CACHE_QUERY_PARAM).length;
}

function countCacheBlocks(messages: OpenRouterChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    n += (m.content as OpenRouterContentBlock[]).filter(
      (b) => b.cache_control?.type === "ephemeral"
    ).length;
  }
  return n;
}

function contentHash(messages: OpenRouterChatMessage[]): string {
  const payload = messages.map((m) => ({
    role: m.role,
    text: flattenOpenRouterMessageContent(m.content),
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function assembleCiWire(modelId: string, history = rawRecentTurnsToHistory([])) {
  const snapshot = buildLikeScaleSnapshot();
  const built = buildContext({
    ...snapshot,
    shortTermHistory: history,
    modelId,
    provider: "cheaperinference",
  });
  return assemblePrimaryRpRequest({
    system: built.systemPrompt,
    history: built.history ?? history,
    modelId,
    targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
    stream: false,
    messageOpts: {
      transportProvider: "cheaperinference",
      systemSplit: built.openRouterSystemSplit,
      charName: snapshot.charName,
    },
  });
}

describe("CI Main RP prompt-cache query policy (PC-01..12)", () => {
  it("PC-01: CI Opus Main RP final URL has exactly one x-ci-prompt-cache=passthrough", () => {
    const wire = assembleCiWire(OPUS);
    const url = wire.transport.endpoint;
    assert.equal(promptCacheQueryCount(url), 1);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get(CHEAPER_INFERENCE_PROMPT_CACHE_QUERY_PARAM), "passthrough");
    assert.equal(
      cheaperInferenceChatCompletionsBaseUrl(url),
      CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL
    );
  });

  it("PC-02: CI Opus request headers do NOT contain x-ci-prompt-cache*", () => {
    const headers = buildCheaperInferenceHeaders("ci_live_test_key");
    assert.equal(headers["x-ci-prompt-cache"], undefined);
    assert.equal(headers["x-ci-prompt-cache-scope"], undefined);
    assert.equal(headers["x-ci-prompt-cache-session"], undefined);
  });

  it("PC-03: CI Opus request body still has exactly 2 cache_control blocks", () => {
    const wire = assembleCiWire(OPUS);
    assert.equal(countCacheBlocks(wire.messages as OpenRouterChatMessage[]), 2);
  });

  it("PC-04: no history cache_control on CI Opus Main RP", () => {
    const wire = assembleCiWire(OPUS);
    const messages = wire.messages as OpenRouterChatMessage[];
    const historyCached = messages.some(
      (m, i) =>
        i > 0 &&
        m.role !== "system" &&
        Array.isArray(m.content) &&
        (m.content as OpenRouterContentBlock[]).some((b) => b.cache_control?.type === "ephemeral")
    );
    assert.equal(historyCached, false);
  });

  it("PC-05: prompt semantic text/order parity unchanged by passthrough URL policy", () => {
    const history = rawRecentTurnsToHistory(
      Array.from({ length: 6 }, (_, i) => ({
        user: `USER-${i + 1}`,
        assistant: `ASST-${i + 1}`,
      }))
    );
    const wire = assembleCiWire(OPUS, history);
    const messages = wire.messages as OpenRouterChatMessage[];
    const hashBefore = contentHash(messages);
    const fetchUrl = resolveMainRpProviderFetchUrl(wire.transport, OPUS);
    assert.ok(fetchUrl.includes("x-ci-prompt-cache=passthrough"));
    assert.equal(contentHash(messages), hashBefore);
  });

  it("PC-06: CI DeepSeek final URL has no prompt-cache query", () => {
    const url = resolveCheaperInferenceMainRpOpusFetchUrl(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(url, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
    const wire = assembleCiWire(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(wire.transport.endpoint, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
  });

  it("PC-07: CI Gemini final URL has no prompt-cache query", () => {
    const url = resolveCheaperInferenceMainRpOpusFetchUrl(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
    );
    assert.equal(url, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
    const wire = assembleCiWire(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.equal(wire.transport.endpoint, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
  });

  it("PC-08: CI Qwen final URL has no prompt-cache query", () => {
    const url = resolveCheaperInferenceMainRpOpusFetchUrl(CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    assert.equal(url, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
    const wire = assembleCiWire(CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    assert.equal(wire.transport.endpoint, CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL);
  });

  it("PC-09: OpenRouter URL unchanged", () => {
    const snapshot = buildLikeScaleSnapshot();
    const built = buildContext({
      ...snapshot,
      modelId: OPUS,
      provider: "openrouter",
    });
    const wire = assemblePrimaryRpRequest({
      system: built.systemPrompt,
      history: built.history ?? [],
      modelId: OPUS,
      targetResponseChars: DEFAULT_TARGET_RESPONSE_CHARS,
      stream: false,
      messageOpts: {
        transportProvider: "openrouter",
        systemSplit: built.openRouterSystemSplit,
        charName: snapshot.charName,
      },
    });
    assert.equal(wire.transport.endpoint, OPENROUTER_CHAT_COMPLETIONS_URL);
    assert.equal(
      resolveMainRpProviderFetchUrl(wire.transport, OPUS),
      OPENROUTER_CHAT_COMPLETIONS_URL
    );
  });

  it("PC-10: canonical CI base endpoint validation remains active", () => {
    assert.doesNotThrow(() => assertCheaperInferenceEndpoint(CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL));
    const opusUrl = resolveCheaperInferenceMainRpOpusFetchUrl(OPUS);
    assert.doesNotThrow(() => assertCheaperInferenceEndpoint(opusUrl));
    assert.throws(() =>
      assertCheaperInferenceEndpoint("https://example.com/v1/chat/completions")
    );
  });

  it("PC-11: query is not duplicated through assemblePrimaryRpRequest parity harness", () => {
    const wire = assembleCiWire(OPUS);
    assert.equal(promptCacheQueryCount(wire.transport.endpoint), 1);
    const resolved = resolveMainRpProviderFetchUrl(wire.transport, OPUS);
    assert.equal(resolved, wire.transport.endpoint);
    assert.equal(promptCacheQueryCount(resolved), 1);
  });

  it("PC-12: stream/non-stream shared resolver cannot diverge on CI Opus fetch URL", () => {
    const wire = assembleCiWire(OPUS);
    const streamUrl = resolveMainRpProviderFetchUrl(
      { ...wire.transport, endpoint: CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL },
      OPUS
    );
    const nonStreamUrl = resolveMainRpProviderFetchUrl(wire.transport, OPUS);
    assert.equal(streamUrl, nonStreamUrl);
    assert.equal(promptCacheQueryCount(streamUrl), 1);
  });
});
