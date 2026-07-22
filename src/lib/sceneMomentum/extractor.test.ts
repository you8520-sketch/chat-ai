import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import {
  buildSceneMomentumBlock,
  isThinSceneHistory,
} from "@/lib/sceneMomentum/extractor";
import { SCENE_MOMENTUM_HEADER } from "@/lib/sceneMomentum/types";
import type { buildContext as BuildContextFn } from "@/services/contextBuilder";
import {
  OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "@/lib/chatModels";
import { buildCanonPlanForSave } from "@/lib/canonPlan/compileForSave";
import type { CanonInjectionPolicy } from "@/lib/canonInjectionPolicy";
import type { CharacterChunk } from "@/types";

let buildContext: typeof BuildContextFn;

before(async () => {
  ({ buildContext } = await import("@/services/contextBuilder"));
});

// ───── Shared fixtures ─────

const MODERN_THIN_HISTORY = [
  { role: "user", content: "오늘 레슨 길었어? 피곤해 보여." },
  {
    role: "assistant",
    content:
      "아니, 그 정도는 아니야. 그냥 오늘 학생 하나가 처음으로 페달을 연결했거든. 그것 때문에 좀 생각할 게 많았을 뿐이야. 물 좀 마셔.",
  },
  { role: "user", content: "그 학생, 네 연주 유튜브 찾아봤대. 많이 놀라더라며." },
  {
    role: "assistant",
    content:
      "...그래. 나쁘지 않았어, 그 학생 손. 형이 옛날 얘기까지 꺼냈다던. 좀 오래 서 있었나 보다.",
  },
] as const;

const MODERN_CURRENT_CUE =
  "오늘 하루 좀 수고했어. 이제 일찍 쉬자. 내일 일정도 없고. 그냥 둘이서 아무것도 안 하고 있어도 될 것 같아.";

// Mature: long assistant turns (avg no-ws chars well above 2200).
// "준서는 잠시 건반을 내려다보았다. " = 15 no-ws chars; repeat(200) -> 3000/turn.
const MATURE_ASSISTANT_TURN = "준서는 잠시 건반을 내려다보았다. ".repeat(200);
const MODERN_MATURE_HISTORY = [
  { role: "user", content: "그래, 그럼 물부터. 너 주방 어디야? 내가 따를게." },
  { role: "assistant", content: MATURE_ASSISTANT_TURN },
  { role: "user", content: "오늘 왜 이렇게 조용해. 평소엔 레슨 얘기 좀 더 하잖아." },
  { role: "assistant", content: MATURE_ASSISTANT_TURN },
  { role: "user", content: "피아노 한 번 쳐줘. 듣고 싶어." },
  { role: "assistant", content: MATURE_ASSISTANT_TURN },
];

const chunk: CharacterChunk = {
  id: "c1",
  characterId: "1",
  content: "[이름]\n이준서\n[세계관]\n현대 서울. 자취방.",
  category: "identity",
  importance: "CRITICAL",
  tokenCount: 20,
  keywords: ["이준서"],
};

const CREATOR_RAW = "[이름]\n이준서\n[성격]\n차분하고 과묵하다.\n[세계관]\n현대 서울. 음악학원과 자취방.";

function compilePlan() {
  const res = buildCanonPlanForSave({ creatorRawDescription: CREATOR_RAW });
  if (!res.plan) throw new Error("plan compile failed: " + res.error);
  return res.plan;
}

// D2 canary ON policy (actual LAYERED, not shadow).
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
};

// CONTROL / canary-off policy (actual FULL_LEGACY).
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
};

function momentumInputFor(history = MODERN_THIN_HISTORY, cue = MODERN_CURRENT_CUE) {
  return {
    recentHistory: history,
    currentUserMessage: cue,
    currentLocation: "준서의 자취방",
    promises: [] as string[],
    openingGreeting: null as string | null,
  };
}

describe("Scene Momentum — extractor determinism (A-H)", () => {
  it("A. same context -> same momentum block byte-identical", () => {
    const input = momentumInputFor();
    const r1 = buildSceneMomentumBlock(input);
    const r2 = buildSceneMomentumBlock(input);
    assert.equal(r1.block, r2.block);
    assert.ok(r1.block != null);
    assert.equal(r1.meta.blockChars, r2.meta.blockChars);
  });

  it("B. thin history -> support ON (block produced)", () => {
    assert.equal(isThinSceneHistory([...MODERN_THIN_HISTORY]), true);
    const r = buildSceneMomentumBlock(momentumInputFor());
    assert.ok(r.block != null);
    assert.ok(r.block!.startsWith(SCENE_MOMENTUM_HEADER));
    assert.ok(r.meta.fieldsPresent.length > 0);
  });

  it("C. mature history -> support OFF (predicate false)", () => {
    assert.equal(isThinSceneHistory([...MODERN_MATURE_HISTORY]), false);
    // Even if forced, a mature history yields no thin-gated injection at the call site.
    // (buildSceneMomentumBlock itself is content-only; the gate is isThinSceneHistory.)
  });

  it("D. missing field evidence -> field omitted", () => {
    // No location keyword, no activity anchor, no affordance, no deflection, no register.
    // (Use neutral tokens — "..." would match the deflection marker.)
    const sparse = [
      { role: "user", content: "응." },
      { role: "assistant", content: "네." },
    ];
    const r = buildSceneMomentumBlock({
      recentHistory: sparse,
      currentUserMessage: "응.",
      currentLocation: null,
      promises: [],
      openingGreeting: null,
    });
    // With no usable scene state, the block is null.
    assert.equal(r.block, null);
    assert.equal(r.meta.fieldsPresent.length, 0);
  });

  it("E. raw history not duplicated in the block", () => {
    const r = buildSceneMomentumBlock(momentumInputFor());
    assert.ok(r.block != null);
    for (const turn of MODERN_THIN_HISTORY) {
      // No raw turn content (a long clause) appears verbatim in the block.
      const raw = turn.content.replace(/\s+/g, " ").trim();
      const longSlice = raw.slice(0, 24);
      if (longSlice.length >= 12) {
        assert.ok(!r.block!.includes(longSlice), `raw copy leaked: ${longSlice}`);
      }
    }
    // The current cue is NOT re-injected verbatim.
    assert.ok(!r.block!.includes(MODERN_CURRENT_CUE.slice(0, 24)));
  });

  it("F. dormant greeting hook excluded", () => {
    const greetingWithHook =
      "준서의 자취방. 그가 물을 따른다. 다음에 마더가 나타난다."; // dormant hook embedded
    const r = buildSceneMomentumBlock({
      recentHistory: [], // cold-start
      currentUserMessage: "쉬자.",
      currentLocation: null,
      promises: [],
      openingGreeting: greetingWithHook,
    });
    // WHERE may surface from greeting, but the dormant hook term must be filtered out.
    assert.ok(!r.block || !r.block.includes("마더"));
    assert.ok(!r.block || !r.block.includes("나타난다"));
  });

  it("G. current location included when established (no history location)", () => {
    // Recent history has no location keyword; currentLocation is the WHERE source.
    const historyNoLoc = [
      { role: "user", content: "피곤해 보여." },
      { role: "assistant", content: "물 좀 마셔." },
    ];
    const r = buildSceneMomentumBlock({
      recentHistory: historyNoLoc,
      currentUserMessage: "쉬자.",
      currentLocation: "준서의 자취방",
      promises: [],
      openingGreeting: null,
    });
    assert.ok(r.fields.where);
    assert.equal(r.fields.where, "준서의 자취방");
    assert.ok(r.block!.includes("WHERE: 준서의 자취방"));
  });

  it("H. unrelated canon sentinel absent from the block", () => {
    // Sentinel placed in recent history (e.g. a stray archive fact); extractor must not copy it.
    const historyWithSentinel = [
      { role: "user", content: "여기 자취방. 느티나무 얘기 들었어?" },
      { role: "assistant", content: "물 마셔. 느티나무라니, 별거 아니야." },
    ];
    const r = buildSceneMomentumBlock({
      recentHistory: historyWithSentinel,
      currentUserMessage: "쉬자.",
      currentLocation: "준서의 자취방",
      promises: [],
      openingGreeting: null,
    });
    assert.ok(!r.block || !r.block.includes("느티나무"));
  });
});

describe("Scene Momentum — wiring gating (I, J)", () => {
  it("I. Muse/Gemini/HY3 (non-DeepSeek) actual payload unchanged (no momentum)", () => {
    const plan = compilePlan();
    const built = buildContext({
      charName: "이준서",
      chunks: [chunk],
      userNickname: "User",
      shortTermHistory: [...MODERN_THIN_HISTORY],
      currentUserMessage: MODERN_CURRENT_CUE,
      nsfw: false,
      modelId: OPENROUTER_QWEN_37_MAX_MODEL,
      provider: "openrouter",
      canonInjectionPolicy: D2_CANARY_ON_POLICY,
      canonPlan: plan,
      sceneMomentumInput: momentumInputFor(),
    });
    const lastUser = built.history.at(-1)!;
    assert.doesNotMatch(lastUser.content, /CURRENT SCENE CONTINUITY/);
  });

  it("J. kill switch / canary off -> no momentum (exact current CONTROL behavior)", () => {
    const plan = compilePlan();
    // CONTROL / canary-off policy -> layeredCanonActive false -> no momentum.
    const built = buildContext({
      charName: "이준서",
      chunks: [chunk],
      userNickname: "User",
      shortTermHistory: [...MODERN_THIN_HISTORY],
      currentUserMessage: MODERN_CURRENT_CUE,
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      canonInjectionPolicy: CONTROL_POLICY,
      canonPlan: plan,
      sceneMomentumInput: momentumInputFor(),
    });
    const lastUser = built.history.at(-1)!;
    assert.doesNotMatch(lastUser.content, /CURRENT SCENE CONTINUITY/);
    // SHORT HISTORY still present (existing behavior unchanged).
    assert.match(lastUser.content, /SHORT HISTORY/);
  });

  it("J2. D2 canary ON + thin -> momentum IS injected (positive gate)", () => {
    const plan = compilePlan();
    const built = buildContext({
      charName: "이준서",
      chunks: [chunk],
      userNickname: "User",
      shortTermHistory: [...MODERN_THIN_HISTORY],
      currentUserMessage: MODERN_CURRENT_CUE,
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      canonInjectionPolicy: D2_CANARY_ON_POLICY,
      canonPlan: plan,
      sceneMomentumInput: momentumInputFor(),
    });
    const lastUser = built.history.at(-1)!;
    assert.match(lastUser.content, /CURRENT SCENE CONTINUITY/);
    // Momentum precedes SHORT HISTORY (scene state before length nudge).
    const momIdx = lastUser.content.indexOf("CURRENT SCENE CONTINUITY");
    const shIdx = lastUser.content.indexOf("SHORT HISTORY");
    assert.ok(momIdx > -1 && shIdx > -1 && momIdx < shIdx);
  });

  it("J3. D2 canary ON + MATURE -> momentum auto-off (no momentum)", () => {
    const plan = compilePlan();
    const built = buildContext({
      charName: "이준서",
      chunks: [chunk],
      userNickname: "User",
      shortTermHistory: [...MODERN_MATURE_HISTORY],
      currentUserMessage: MODERN_CURRENT_CUE,
      nsfw: false,
      modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      provider: "openrouter",
      canonInjectionPolicy: D2_CANARY_ON_POLICY,
      canonPlan: plan,
      sceneMomentumInput: momentumInputFor([...MODERN_MATURE_HISTORY]),
    });
    const lastUser = built.history.at(-1)!;
    assert.doesNotMatch(lastUser.content, /CURRENT SCENE CONTINUITY/);
  });
});
