import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGeneralProviderContext,
  createInitialStreamBuffer,
  detectModelRefusal,
  selectAdultHandoffRawHistory,
  type CanonicalRouteHistoryMessage,
} from "./adultSceneRouting";

type MockProviderResult = {
  text: string;
  finishReason?: string;
  costUsd: number;
  emits?: string[];
};

async function runMockProviderFallback(input: {
  primary: MockProviderResult;
  fallback: MockProviderResult;
  bufferChars: number;
  eligible?: boolean;
}) {
  const sent: object[] = [];
  const gate = createInitialStreamBuffer((event) => sent.push(event), input.bufferChars);
  let fallbackAttempts = 0;
  let fallbackSucceeded = false;
  let userChargeCount = 0;
  let hiddenFallbackOverheadCostUsd = 0;
  let final = input.primary;

  for (const text of input.primary.emits ?? [input.primary.text]) {
    gate.send({ type: "delta", text });
  }
  const refusal = detectModelRefusal({
    text: input.primary.text,
    finishReason: input.primary.finishReason,
  });
  const canFallback =
    input.eligible !== false &&
    refusal.refused &&
    !gate.hasVisibleTokens() &&
    fallbackAttempts === 0;
  if (canFallback) {
    fallbackAttempts += 1;
    hiddenFallbackOverheadCostUsd = input.primary.costUsd;
    gate.discard();
    final = input.fallback;
    fallbackSucceeded = true;
  } else {
    gate.flush();
  }
  if (final.text.trim()) userChargeCount += 1;
  return {
    sent,
    final,
    fallbackAttempts,
    fallbackSucceeded,
    userChargeCount,
    hiddenFallbackOverheadCostUsd,
    totalUpstreamCostUsd:
      final.costUsd + hiddenFallbackOverheadCostUsd,
  };
}

describe("adult handoff provider-mock integration", () => {
  it("detects a provider refusal and silently falls back before visible text", async () => {
    const result = await runMockProviderFallback({
      primary: {
        text: "요청에 응할 수 없습니다.",
        finishReason: "stop",
        costUsd: 0.003,
      },
      fallback: { text: "장면의 다음 순간이 이어졌다.", costUsd: 0.005 },
      bufferChars: 400,
    });
    assert.equal(result.fallbackAttempts, 1);
    assert.equal(result.fallbackSucceeded, true);
    assert.equal(result.sent.length, 0);
    assert.equal(result.final.text, "장면의 다음 순간이 이어졌다.");
  });

  it("never silently replaces output after the buffer became visible", async () => {
    const result = await runMockProviderFallback({
      primary: {
        text: "요청에 응할 수 없습니다.",
        costUsd: 0.003,
        emits: ["이미 사용자에게 전달된 400자 이상의 문단.".repeat(30)],
      },
      fallback: { text: "대체 출력", costUsd: 0.005 },
      bufferChars: 400,
    });
    assert.equal(result.fallbackAttempts, 0);
    assert.equal(result.fallbackSucceeded, false);
    assert.ok(result.sent.length > 0);
  });

  it("limits DeepSeek fallback to one attempt", async () => {
    const result = await runMockProviderFallback({
      primary: { text: "작성할 수 없습니다.", costUsd: 0.002 },
      fallback: { text: "최종 오류가 아닌 단일 결과", costUsd: 0.004 },
      bufferChars: 400,
    });
    assert.equal(result.fallbackAttempts, 1);
  });

  it("charges the user-facing result once and records hidden upstream overhead", async () => {
    const result = await runMockProviderFallback({
      primary: { text: "도와드릴 수 없습니다.", costUsd: 0.0025 },
      fallback: { text: "최종 전달 응답", costUsd: 0.006 },
      bufferChars: 400,
    });
    assert.equal(result.userChargeCount, 1);
    assert.equal(result.hiddenFallbackOverheadCostUsd, 0.0025);
    assert.equal(result.totalUpstreamCostUsd, 0.0085);
  });

  it("does not adult-fallback when policy eligibility fails", async () => {
    const result = await runMockProviderFallback({
      primary: { text: "요청에 응할 수 없습니다.", costUsd: 0.002 },
      fallback: { text: "사용되면 안 됨", costUsd: 0.004 },
      bufferChars: 400,
      eligible: false,
    });
    assert.equal(result.fallbackAttempts, 0);
  });

  it("A selects four complete exchanges (eight messages)", () => {
    const history = Array.from({ length: 6 }, (_, index) => [
      { role: "user" as const, content: `user-${index}` },
      { role: "assistant" as const, content: `assistant-${index}` },
    ]).flat();
    const selected = selectAdultHandoffRawHistory(history, {
      targetTurns: 4,
      minimumTurns: 4,
      maxTokens: 10_000,
    });
    assert.equal(selected.rawTurnsIncluded, 4);
    assert.equal(selected.history.length, 8);
  });

  it("B selects six complete exchanges (twelve messages) when the budget permits", () => {
    const history = Array.from({ length: 6 }, (_, index) => [
      { role: "user" as const, content: `user-${index}` },
      { role: "assistant" as const, content: `assistant-${index}` },
    ]).flat();
    const selected = selectAdultHandoffRawHistory(history, {
      targetTurns: 6,
      minimumTurns: 2,
      maxTokens: 10_000,
    });
    assert.equal(selected.rawTurnsIncluded, 6);
    assert.equal(selected.history.length, 12);
  });

  it("exposes the production-length RAW budget inversion instead of hiding it", () => {
    const long = "현실적인 장문 응답이다. ".repeat(220);
    assert.ok(long.length >= 2_000);
    const history = Array.from({ length: 6 }, (_, index) => [
      { role: "user" as const, content: `user-${index}` },
      { role: "assistant" as const, content: long },
    ]).flat();
    const a = selectAdultHandoffRawHistory(history, {
      targetTurns: 4,
      minimumTurns: 4,
      maxTokens: 10_000,
    });
    const b = selectAdultHandoffRawHistory(history, {
      targetTurns: 6,
      minimumTurns: 2,
      maxTokens: 10_000,
    });
    assert.equal(a.rawTurnsIncluded, 4);
    assert.ok(b.rawTurnsIncluded <= a.rawTurnsIncluded);
  });

  it("filters adult RAW and inserts GeneralRouteBridge for safe return", () => {
    const history: CanonicalRouteHistoryMessage[] = [
      { role: "user", content: "안전한 이전 입력", sceneMode: "romantic" },
      { role: "assistant", content: "안전한 이전 출력", sceneMode: "romantic" },
      { role: "user", content: "성인 장면 입력", sceneMode: "explicit" },
      {
        role: "assistant",
        content: "성인 장면 상세",
        sceneMode: "explicit",
        activeRoute: "adult",
      },
      { role: "user", content: "다음 날 입력", sceneMode: "normal" },
      { role: "assistant", content: "다음 날 출력", sceneMode: "normal" },
    ];
    const safe = buildGeneralProviderContext(history, {
      relationshipChange: "서로의 신뢰가 깊어졌다.",
      currentLocation: "본부 회의실",
    });
    const joined = safe.map((message) => message.content).join("\n");
    assert.doesNotMatch(joined, /성인 장면 상세|성인 장면 입력/);
    assert.match(joined, /서로의 신뢰가 깊어졌다/);
    assert.match(joined, /다음 날 출력/);
  });
});
