import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { buildRegenerateUserPrompt } from "@/lib/continueNarrative";
import { OPENING_TURN_USER } from "@/lib/chatGreetingContext";
import { normalizeMemoryMeta, parseMemoryMeta } from "@/lib/chatMemory";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import type { CanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_GEMINI_25_PRO_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
  OPENROUTER_TENCENT_HY3_MODEL,
} from "@/lib/chatModels";
import { SCENE_MOMENTUM_HEADER } from "@/lib/sceneMomentum/types";
import {
  buildSceneMomentumInputFromRoute,
  toSceneMomentumTurns,
} from "@/lib/sceneMomentum/routeInput";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

const THIN_HISTORY = [
  { role: "user" as const, content: "오늘 약초밭에 꽃 좀 피었어?" },
  { role: "assistant" as const, content: "...피었어. 신경 쓸 거 없어." },
  { role: "user" as const, content: "물 마셔." },
  { role: "assistant" as const, content: "마셨어. 별거 아니야." },
];

const SCENE_CUE = "오늘 하루 좀 수고했어. 이제 쉬자.";

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

const CREATOR_RAW =
  "[이름]\n이준서\n[성격]\n차분하고 과묵하다.\n[세계관]\n현대 서울. 음악학원과 자취방.";

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
  canaryPercent: 100,
  cohortEligible: true,
  cohortBucket: 0,
  cohortEligibilityReason: "PERCENT_100",
};

const CONTROL_POLICY: CanonInjectionPolicy = {
  modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  injectionEnabled: true,
  shadowOnly: true,
  canonMode: "FULL_LEGACY",
  archiveMode: "FULL_ALWAYS",
  rolloutStage: "D0",
  forceFullLegacy: false,
  canaryActualInjection: false,
  actualCanonMode: "FULL_LEGACY",
  actualArchiveMode: "FULL_ALWAYS",
  masterCanaryEnabled: false,
  canaryPercent: 0,
  cohortEligible: false,
  cohortBucket: null,
  cohortEligibilityReason: "N/A",
};

function compilePlan() {
  const res = buildCanonPlanForSave({ creatorRawDescription: CREATOR_RAW });
  if (!res.plan) throw new Error("plan compile failed: " + res.error);
  return res.plan;
}

function routeMomentumInput(
  history = THIN_HISTORY,
  cue = SCENE_CUE,
  memoryMetaRaw?: string
) {
  const normalized = memoryMetaRaw
    ? normalizeMemoryMeta(parseMemoryMeta(memoryMetaRaw), {
        charName: "이준서",
        userName: "user",
      })
    : null;
  return buildSceneMomentumInputFromRoute({
    shortTermHistory: history,
    currentUserMessage: cue,
    normalizedMemoryMeta: normalized,
  });
}

function buildWithMomentum(opts: {
  history?: typeof THIN_HISTORY;
  cue?: string;
  modelId: string;
  provider?: "openrouter" | "gemini";
  policy: CanonInjectionPolicy;
  sceneMomentumInput?: ReturnType<typeof routeMomentumInput> | null;
  regenerate?: boolean;
  promptUserMessage?: string;
}) {
  const history = opts.history ?? THIN_HISTORY;
  const cue = opts.cue ?? SCENE_CUE;
  return buildContext({
    charName: "이준서",
    chunks: [chunk],
    userNickname: "user",
    shortTermHistory: history,
    currentUserMessage: opts.promptUserMessage ?? cue,
    nsfw: false,
    modelId: opts.modelId,
    provider: opts.provider ?? "openrouter",
    canonInjectionPolicy: opts.policy,
    canonPlan: compilePlan(),
    sceneMomentumInput: opts.sceneMomentumInput ?? undefined,
    regenerate: opts.regenerate,
  });
}

function lastUserPayload(built: ReturnType<typeof buildContext>): string {
  if (built.provider === "gemini" && Array.isArray(built.contents)) {
    const last = built.contents.at(-1);
    return (last?.parts ?? []).map((p) => p.text ?? "").join("\n");
  }
  return built.history.at(-1)?.content ?? "";
}

function countHeaderMatches(text: string): number {
  return (text.match(/\[CURRENT SCENE CONTINUITY\]/g) ?? []).length;
}

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

describe("Scene Momentum route wiring — buildSceneMomentumInputFromRoute (A, G, H, J)", () => {
  it("A. route helper produces non-null SceneMomentumInput from history + cue", () => {
    const input = routeMomentumInput();
    assert.ok(input);
    assert.equal(input.currentUserMessage, SCENE_CUE);
    assert.equal(input.recentHistory.length, THIN_HISTORY.length);
    assert.deepEqual(
      input.recentHistory,
      toSceneMomentumTurns(THIN_HISTORY).slice(-4)
    );
    assert.equal(input.currentLocation, null);
  });

  it("G. current user cue is evidence only — not copied verbatim into block", () => {
    const input = routeMomentumInput();
    const built = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: input,
    });
    const lastUser = lastUserPayload(built);
    assert.match(lastUser, /CURRENT SCENE CONTINUITY/);
    assert.ok(!lastUser.includes(SCENE_CUE));
  });

  it("H. dormant greeting hooks and unrelated lore are not emitted", () => {
    const greetingWithHook =
      "준서의 자취방. 그가 물을 따른다. 다음에 마더가 나타난다.";
    const history = [
      { role: "user" as const, content: OPENING_TURN_USER },
      { role: "assistant" as const, content: greetingWithHook },
    ];
    const input = buildSceneMomentumInputFromRoute({
      shortTermHistory: history,
      currentUserMessage: "쉬자.",
      normalizedMemoryMeta: null,
    });
    assert.equal(input.openingGreeting, greetingWithHook);
    const built = buildWithMomentum({
      history,
      cue: "쉬자.",
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: input,
    });
    const lastUser = lastUserPayload(built);
    const momentumSection =
      lastUser.match(/\[CURRENT SCENE CONTINUITY\][\s\S]*?(?=\n\[|$)/)?.[0] ?? "";
    assert.ok(momentumSection.length > 0);
    assert.ok(!momentumSection.includes("마더"));
    assert.ok(!momentumSection.includes("나타난다"));
  });

  it("J. regeneration uses original scene cue rather than regenerate meta-wrapper text", () => {
    const regenWrapper = buildRegenerateUserPrompt({
      userMessage: SCENE_CUE,
      personaName: "user",
      charName: "이준서",
      usesBanmal: false,
      coNarrationEnabled: false,
      rejectedAssistantDraft: "old draft",
      regenAttemptId: 1,
      targetResponseChars: 3000,
    });
    assert.match(regenWrapper, /\[SYSTEM: REGENERATE/);
    assert.doesNotMatch(SCENE_CUE, /\[SYSTEM: REGENERATE/);

    const routeInput = routeMomentumInput(THIN_HISTORY, SCENE_CUE);
    assert.equal(routeInput.currentUserMessage, SCENE_CUE);
    assert.ok(!routeInput.currentUserMessage.includes("[SYSTEM: REGENERATE"));

    const built = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: routeInput,
      regenerate: true,
      promptUserMessage: regenWrapper,
      cue: SCENE_CUE,
    });
    const lastUser = lastUserPayload(built);
    assert.match(lastUser, /CURRENT SCENE CONTINUITY/);
    assert.ok(!lastUser.includes("[SYSTEM: REGENERATE — rewrite ONLY"));
  });
});

describe("Scene Momentum route wiring — buildContext gating (B–F, I)", () => {
  it("B. DeepSeek + Layered Canon + thin history + route input -> momentumActive + header once", () => {
    const input = routeMomentumInput();
    const built = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: input,
    });
    const lastUser = lastUserPayload(built);
    assert.equal(countHeaderMatches(lastUser), 1);
    assert.equal(built.meta.momentumActivation?.momentumActive, true);
    assert.equal(
      built.meta.momentumActivation?.activationReason,
      "THIN_LENGTH_AND_LOW_EXCHANGES"
    );
    assert.ok((built.meta.momentumActivation?.fieldsPresent.length ?? 0) > 0);
    assert.ok((built.meta.momentumActivation?.blockChars ?? 0) > 0);
  });

  it("C. DeepSeek mature history above alternating boundary -> momentumActive=false", () => {
    const matureCue = "응, 좋아. 오늘은 쉬자.";
    const input = routeMomentumInput(MANY_SHORT_HISTORY, matureCue);
    const built = buildWithMomentum({
      history: MANY_SHORT_HISTORY,
      cue: matureCue,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: input,
    });
    const lastUser = lastUserPayload(built);
    assert.doesNotMatch(lastUser, /CURRENT SCENE CONTINUITY/);
    assert.equal(built.meta.momentumActivation?.momentumActive, false);
    assert.equal(
      built.meta.momentumActivation?.activationReason,
      "MATURE_EXCHANGE_GUARD"
    );
    assert.deepEqual(built.meta.momentumActivation?.fieldsPresent, []);
    assert.equal(built.meta.momentumActivation?.blockChars, 0);
  });

  it("D. DeepSeek without Layered Canon -> no Momentum block", () => {
    const input = routeMomentumInput();
    const built = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: CONTROL_POLICY,
      sceneMomentumInput: input,
    });
    const lastUser = lastUserPayload(built);
    assert.doesNotMatch(lastUser, /CURRENT SCENE CONTINUITY/);
    assert.equal(built.meta.momentumActivation?.momentumActive, false);
    assert.equal(built.meta.momentumActivation?.activationReason, "MODEL_POLICY_OFF");
    assert.deepEqual(built.meta.momentumActivation?.fieldsPresent, []);
    assert.equal(built.meta.momentumActivation?.blockChars, 0);
  });

  it("E. Muse / Gemini / HY3 with same route input -> no Momentum prompt block", () => {
    const input = routeMomentumInput();
    for (const m of [
      { id: "Muse", modelId: OPENROUTER_MUSE_SPARK_11_MODEL, provider: "openrouter" as const },
      { id: "HY3", modelId: OPENROUTER_TENCENT_HY3_MODEL, provider: "openrouter" as const },
      {
        id: "Gemini",
        modelId: OPENROUTER_GEMINI_25_PRO_MODEL,
        provider: "gemini" as const,
      },
    ]) {
      const withoutInput = buildWithMomentum({
        modelId: m.modelId,
        provider: m.provider,
        policy: D2_CANARY_ON_POLICY,
        sceneMomentumInput: null,
      });
      const built = buildWithMomentum({
        modelId: m.modelId,
        provider: m.provider,
        policy: D2_CANARY_ON_POLICY,
        sceneMomentumInput: input,
      });
      const payload =
        m.provider === "gemini"
          ? (built.systemPrompt ?? "") +
            (Array.isArray(built.contents)
              ? built.contents
                  .flatMap((turn) => turn.parts ?? [])
                  .map((p) => p.text ?? "")
                  .join("\n")
              : "")
          : `${built.systemPrompt ?? ""}\n${built.history.map((h) => h.content).join("\n")}`;
      const baselinePayload =
        m.provider === "gemini"
          ? (withoutInput.systemPrompt ?? "") +
            (Array.isArray(withoutInput.contents)
              ? withoutInput.contents
                  .flatMap((turn) => turn.parts ?? [])
                  .map((p) => p.text ?? "")
                  .join("\n")
              : "")
          : `${withoutInput.systemPrompt ?? ""}\n${withoutInput.history.map((h) => h.content).join("\n")}`;
      assert.equal(payload, baselinePayload, m.id + ": prompt identical with/without input");
      assert.doesNotMatch(payload, /CURRENT SCENE CONTINUITY/, m.id);
      assert.equal(built.meta.momentumActivation?.momentumActive, false, m.id);
      assert.equal(
        built.meta.momentumActivation?.activationReason,
        "MODEL_POLICY_OFF",
        m.id
      );
      assert.deepEqual(built.meta.momentumActivation?.fieldsPresent, [], m.id);
      assert.equal(built.meta.momentumActivation?.blockChars, 0, m.id);
    }
  });

  it("F. callers omitting sceneMomentumInput remain backward-compatible (MODEL_POLICY_OFF)", () => {
    const built = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: null,
    });
    const lastUser = lastUserPayload(built);
    assert.doesNotMatch(lastUser, /CURRENT SCENE CONTINUITY/);
    assert.equal(built.meta.momentumActivation?.momentumActive, false);
    assert.equal(built.meta.momentumActivation?.activationReason, "MODEL_POLICY_OFF");
    assert.deepEqual(built.meta.momentumActivation?.fieldsPresent, []);
    assert.equal(built.meta.momentumActivation?.blockChars, 0);
  });

  it("I. route input does not change LENGTH/Terminal/prose-style sections", () => {
    const without = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: null,
    });
    const withInput = buildWithMomentum({
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      policy: D2_CANARY_ON_POLICY,
      sceneMomentumInput: routeMomentumInput(),
    });
    assert.equal(without.systemPrompt, withInput.systemPrompt);
    const withoutUser = lastUserPayload(without);
    const withUser = lastUserPayload(withInput);
    const frozenSnippets = [
      "[DEEPSEEK LENGTH — SINGLE CALL]",
      "Complete the requested narrative depth in this single response.",
      "[SHORT HISTORY]",
      "Recent assistant length is context, not a response-length example.",
      "[SHORT USER TURN]",
      "A brief user message is an interaction cue, not a request for a brief reply.",
      "TARGET_LENGTH 3,200+ · MINIMUM_FLOOR 2,700+",
    ];
    for (const snip of frozenSnippets) {
      assert.ok(withoutUser.includes(snip), "baseline missing: " + snip);
      assert.ok(withUser.includes(snip), "wired missing: " + snip);
    }
    assert.doesNotMatch(withoutUser, /\[CURRENT SCENE CONTINUITY\]/);
    assert.match(withUser, /\[CURRENT SCENE CONTINUITY\]/);
  });
});
