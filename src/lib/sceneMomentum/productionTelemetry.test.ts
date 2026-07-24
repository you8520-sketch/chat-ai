import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before, mock } from "node:test";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import type { CanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";
import {
  assertSceneMomentumTelemetryPrivacySafe,
  buildSceneMomentumProductionTelemetry,
  logSceneMomentumProductionTelemetry,
  shouldLogSceneMomentumProductionTelemetry,
} from "@/lib/sceneMomentum/productionTelemetry";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

const THIN_HISTORY = [
  { role: "user" as const, content: "오늘 약초밭에 꽃 좀 피었어?" },
  { role: "assistant" as const, content: "...피었어. 신경 쓸 거 없어." },
  { role: "user" as const, content: "물 마셔." },
  { role: "assistant" as const, content: "마셨어. 별거 아니야." },
];

const MANY_SHORT_HISTORY = (() => {
  const h: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < 10; i++) {
    h.push({ role: "user", content: "무엇을 할까 " + (i + 1) });
    h.push({ role: "assistant", content: "이렇게 하자 " + (i + 1) });
  }
  return h;
})();

const chunk: CharacterChunk = {
  id: "c1",
  characterId: "1",
  content: "[이름]\n이준서\n[세계관]\n현대 서울. 자취방.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 20,
  keywords: ["이준서"],
};

const D2_CANARY_ON_POLICY: CanonInjectionPolicy = {
  modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  injectionEnabled: true,
  shadowOnly: false,
  canonMode: "LAYERED",
  archiveMode: "SELECTIVE",
  rolloutStage: "D2",
  forceFullLegacy: false,
  canaryActualInjection: true,
  actualCanonMode: "LAYERED",
  actualArchiveMode: "SELECTIVE",
  masterCanaryEnabled: true,
  canaryPercent: 0,
  cohortEligible: true,
  cohortBucket: 0,
  cohortEligibilityReason: "ALLOWLIST",
};

const CONTROL_POLICY: CanonInjectionPolicy = {
  ...D2_CANARY_ON_POLICY,
  canaryActualInjection: false,
  actualCanonMode: "FULL_LEGACY",
  actualArchiveMode: "FULL_ALWAYS",
  shadowOnly: true,
  cohortEligible: false,
  cohortEligibilityReason: "N/A",
};

function momentumInput(history = THIN_HISTORY) {
  return {
    recentHistory: history.slice(-4),
    currentUserMessage: "오늘 하루 좀 수고했어. 이제 쉬자.",
    currentLocation: "준서의 자취방",
    promises: [] as string[],
    openingGreeting: null as string | null,
  };
}

function buildAndTelemetry(
  policy: CanonInjectionPolicy,
  modelId: string,
  history = THIN_HISTORY
) {
  const plan = buildCanonPlanForSave({
    creatorRawDescription: "[이름]\n이준서\n[세계관]\n현대 서울.",
  }).plan!;
  const built = buildContext({
    charName: "이준서",
    chunks: [chunk],
    userNickname: "user",
    shortTermHistory: history,
    currentUserMessage: "오늘 하루 좀 수고했어. 이제 쉬자.",
    nsfw: false,
    modelId,
    provider: "openrouter",
    canonInjectionPolicy: policy,
    canonPlan: plan,
    sceneMomentumInput: momentumInput(history),
  });
  assert.ok(built.meta.momentumActivation);
  const payload = buildSceneMomentumProductionTelemetry({
    requestId: "req-test-1",
    chatId: 42,
    modelId,
    canonInjectionPolicy: policy,
    momentumActivation: built.meta.momentumActivation,
  });
  return { built, payload };
}

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

describe("Scene Momentum production telemetry — payload semantics (A, B, G)", () => {
  it("A. DeepSeek D2 canary + thin → momentumActive=true, fieldsPresent non-empty, blockChars>0", () => {
    const { payload } = buildAndTelemetry(D2_CANARY_ON_POLICY, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(payload.momentumActive, true);
    assert.equal(payload.activationReason, "THIN_LENGTH_AND_LOW_EXCHANGES");
    assert.equal(payload.structuralMature, false);
    assert.ok(payload.fieldsPresent.length > 0);
    assert.ok(payload.blockChars > 0);
    assertSceneMomentumTelemetryPrivacySafe(payload);
  });

  it("B. DeepSeek D2 canary + mature → momentumActive=false, MATURE_EXCHANGE_GUARD, empty fields", () => {
    const { payload } = buildAndTelemetry(
      D2_CANARY_ON_POLICY,
      OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      MANY_SHORT_HISTORY
    );
    assert.equal(payload.momentumActive, false);
    assert.equal(payload.activationReason, "MATURE_EXCHANGE_GUARD");
    assert.equal(payload.structuralMature, true);
    assert.deepEqual(payload.fieldsPresent, []);
    assert.equal(payload.blockChars, 0);
    assertSceneMomentumTelemetryPrivacySafe(payload);
  });

  it("G. telemetry object contains no raw user/history/prompt/memory/canon text", () => {
    const { payload } = buildAndTelemetry(D2_CANARY_ON_POLICY, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    const serialized = JSON.stringify(payload);
    assert.doesNotMatch(serialized, /오늘 하루|약초밭|CURRENT SCENE CONTINUITY|systemPrompt|memoryMeta/);
    assert.ok(!("userMessage" in payload));
    assert.ok(!("history" in payload));
    assert.ok(!("prompt" in payload));
    assertSceneMomentumTelemetryPrivacySafe(payload);
  });
});

describe("Scene Momentum production telemetry — logging gate (C–F)", () => {
  it("C. DeepSeek non-canary/control → no production log", () => {
    assert.equal(
      shouldLogSceneMomentumProductionTelemetry({
        modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
        canaryActualInjection: CONTROL_POLICY.canaryActualInjection,
      }),
      false
    );
    const info = mock.fn();
    const original = console.info;
    console.info = info as typeof console.info;
    try {
      if (
        shouldLogSceneMomentumProductionTelemetry({
          modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
          canaryActualInjection: false,
        })
      ) {
        logSceneMomentumProductionTelemetry(
          buildSceneMomentumProductionTelemetry({
            requestId: "x",
            chatId: 1,
            modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
            canonInjectionPolicy: CONTROL_POLICY,
            momentumActivation: {
              momentumActive: false,
              activationReason: "MODEL_POLICY_OFF",
              existingThinHistory: true,
              alternatingExchanges: 2,
              structuralMature: false,
              fieldsPresent: [],
              blockChars: 0,
            },
          })
        );
      }
      assert.equal(info.mock.calls.length, 0);
    } finally {
      console.info = original;
    }
  });

  for (const [label, modelId] of [
    ["D. Muse", OPENROUTER_MUSE_SPARK_11_MODEL],
    ["E. Gemini", OPENROUTER_GEMINI_25_PRO_MODEL],
    ["F. HY3", OPENROUTER_TENCENT_HY3_MODEL],
  ] as const) {
    it(`${label} → no production [scene-momentum] log`, () => {
      assert.equal(
        shouldLogSceneMomentumProductionTelemetry({
          modelId,
          canaryActualInjection: true,
        }),
        false
      );
    });
  }

  it("eligible DeepSeek D2 canary emits exactly one structured log line", () => {
    const { payload } = buildAndTelemetry(D2_CANARY_ON_POLICY, OPENROUTER_DEEPSEEK_V4_PRO_MODEL);
    const info = mock.fn();
    const original = console.info;
    console.info = info as typeof console.info;
    try {
      if (
        shouldLogSceneMomentumProductionTelemetry({
          modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
          canaryActualInjection: true,
        })
      ) {
        logSceneMomentumProductionTelemetry(payload);
      }
      assert.equal(info.mock.calls.length, 1);
      assert.equal(info.mock.calls[0]?.arguments[0], "[scene-momentum]");
      assert.deepEqual(info.mock.calls[0]?.arguments[1], payload);
    } finally {
      console.info = original;
    }
  });
});
