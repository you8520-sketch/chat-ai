/**
 * SceneDirective V2 / Living feature-flag contract + runtime owner consistency audit.
 * Zero provider calls.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildContext } from "@/services/contextBuilder";
import {
  applyProductionServerControlsToMessages,
  countPacingOwners,
} from "@/lib/scenePacingController";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import {
  buildSceneDirectiveV2,
  renderSceneDirectiveV2ForPrompt,
} from "@/lib/sceneDirectiveV2";
import {
  buildLivingSceneDirective,
  renderLivingSceneDirectiveForPrompt,
} from "@/lib/livingSceneDirective";
import {
  getSceneDirectiveV2Mode,
  isExperimentScenePacingPromptOwner,
  isSceneDirectiveV2ComputeEnabled,
  isSceneDirectiveV2InjectEnabled,
  materializeSceneDirectivePromptBlock,
  resolveScenePacingPromptOwner,
  type ScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";
import { applyRpDiagnosticToSceneDirectiveBlock } from "@/lib/rpDiagnosticCanary";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

const PRIMARY = "테스트주인공";
const ROUTE_SOURCE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

const V1_MARKER = "[PRIVATE SCENE ENGINE RULE]";
const V2_MARKER = "[PRIVATE SCENE PACING RULE]";
const LIVING_MARKER = "[PRIVATE SCENE CONTINUITY RULE]";

function railwayLikeEnv(): NodeJS.ProcessEnv {
  return {};
}

function legacyBlock(): string {
  return renderSceneDirectiveForPrompt(
    buildSceneDirective({
      mode: "interactive",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "조용히 있다.",
      chatId: 4001,
      currentTurn: 2,
    })
  );
}

function v2Block(): string {
  return renderSceneDirectiveV2ForPrompt(
    buildSceneDirectiveV2({
      mode: "interactive",
      recentMessages: [
        { role: "assistant", content: "소파에 앉는다." },
        { role: "user", content: "옆에 앉는다." },
      ],
      currentUserMessage: "조용히 있다.",
      currentTurn: 2,
    })
  );
}

function livingBlock(): string {
  return renderLivingSceneDirectiveForPrompt(
    buildLivingSceneDirective({
      mode: "interactive",
      recentMessages: [{ role: "assistant", content: "..." }],
      currentUserMessage: "조용히 있다.",
    })
  );
}

/** Pre-fix bug: owner selection lived inside rpDiagnosticCanary branch only. */
function preFixBuggyBlockSelection(input: {
  scenePacingOwner: ScenePacingPromptOwner;
  hasCanary: boolean;
}): string {
  const legacy = legacyBlock();
  if (!input.hasCanary) return legacy;
  return materializeSceneDirectivePromptBlock({
    scenePacingOwner: input.scenePacingOwner,
    v2Block: v2Block(),
    livingBlock: livingBlock(),
    legacyBlock: legacy,
  });
}

function detectRenderedOwner(block: string): ScenePacingPromptOwner {
  if (block.includes(V2_MARKER)) return "event_restraint_v2";
  if (block.includes(LIVING_MARKER)) return "living_continuity_director";
  if (block.includes(V1_MARKER)) return "legacy_v1";
  return "legacy_v1";
}

function wireWithBlock(input: {
  block: string;
  owner: ScenePacingPromptOwner;
  mode?: "interactive" | "auto_progression";
  contentKind?: "character" | "simulation";
}) {
  const mode = input.mode ?? "interactive";
  const contentKind = input.contentKind ?? "character";
  const directive = buildSceneDirective({
    mode,
    contentKind,
    primaryCharacterName: PRIMARY,
    currentUserMessage: "조용히 있다.",
    chatId: 4002,
    currentTurn: 2,
  });
  const skipMotionCue =
    mode === "auto_progression" ||
    contentKind === "simulation" ||
    isExperimentScenePacingPromptOwner(input.owner);
  return applyProductionServerControlsToMessages({
    messages: [
      {
        role: "system",
        content: `[CORE]\n${SCENE_FLOW_BLOCK}\n${input.block}\n[IMMERSIVE PROSE]\nok`,
      },
      { role: "user", content: "조용히 있다." },
    ],
    mode,
    contentKind,
    primaryCharacterName: PRIMARY,
    currentUserMessage: "조용히 있다.",
    canonicalSceneDirective: directive,
    skipMotionCue,
  });
}

describe("scene directive owner contract C1-C14", () => {
  it("C1 V2 off / no canary — legacy_v1 owner parity", () => {
    const owner = resolveScenePacingPromptOwner({
      v2Mode: "off",
      livingEnabled: false,
    });
    assert.equal(owner, "legacy_v1");
    const block = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    assert.equal(detectRenderedOwner(block), "legacy_v1");
    assert.ok(block.includes(V1_MARKER));
  });

  it("C2 V2 shadow / no canary — compute on, prompt owner legacy_v1", () => {
    const env = { SCENE_DIRECTIVE_V2_MODE: "shadow" };
    assert.equal(getSceneDirectiveV2Mode(env), "shadow");
    assert.equal(isSceneDirectiveV2ComputeEnabled(env), true);
    assert.equal(isSceneDirectiveV2InjectEnabled(env), false);
    const owner = resolveScenePacingPromptOwner({
      v2Mode: "shadow",
      livingEnabled: false,
    });
    assert.equal(owner, "legacy_v1");
    const block = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    assert.equal(detectRenderedOwner(block), "legacy_v1");
  });

  it("C3 V2 on / no canary — pre-fix FAIL, post-fix PASS owner parity", () => {
    const owner = resolveScenePacingPromptOwner({
      v2Mode: "on",
      livingEnabled: false,
    });
    assert.equal(owner, "event_restraint_v2");
    const preFix = preFixBuggyBlockSelection({ scenePacingOwner: owner, hasCanary: false });
    assert.equal(detectRenderedOwner(preFix), "legacy_v1", "pre-fix reproduced split-brain");
    const postFix = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    assert.equal(detectRenderedOwner(postFix), "event_restraint_v2");
    assert.ok(!postFix.includes(V1_MARKER));
  });

  it("C4 Living / no canary — living_continuity_director owner parity", () => {
    const owner = resolveScenePacingPromptOwner({
      v2Mode: "off",
      livingEnabled: true,
    });
    assert.equal(owner, "living_continuity_director");
    const postFix = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    assert.equal(detectRenderedOwner(postFix), "living_continuity_director");
    const preFix = preFixBuggyBlockSelection({ scenePacingOwner: owner, hasCanary: false });
    assert.equal(detectRenderedOwner(preFix), "legacy_v1");
  });

  it("C5 V2 shadow + Living — Living prompt owner, V2 shadow compute only", () => {
    const owner = resolveScenePacingPromptOwner({
      v2Mode: "shadow",
      livingEnabled: true,
    });
    assert.equal(owner, "living_continuity_director");
    const block = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    assert.equal(detectRenderedOwner(block), "living_continuity_director");
  });

  it("C6 V2 on + Living — V2 sole prompt owner", () => {
    const owner = resolveScenePacingPromptOwner({
      v2Mode: "on",
      livingEnabled: true,
    });
    assert.equal(owner, "event_restraint_v2");
    const block = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    assert.equal(detectRenderedOwner(block), "event_restraint_v2");
    assert.ok(!block.includes(LIVING_MARKER));
  });

  it("C7 V2 on + canary — canary transforms selected V2 block, not V1 fallback", () => {
    const owner = resolveScenePacingPromptOwner({ v2Mode: "on", livingEnabled: false });
    const raw = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    const transformed = applyRpDiagnosticToSceneDirectiveBlock({
      block: raw,
      canary: { variant: "baseline", userId: 1, modelId: "x", contentKind: "character" },
      completedTurns: 1,
      progressionAxis: "relationship",
    });
    assert.ok(transformed.includes(V2_MARKER));
    assert.ok(!transformed.includes(V1_MARKER));
  });

  it("C8 Living + canary — canary transforms selected Living block", () => {
    const owner = resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: true });
    const raw = materializeSceneDirectivePromptBlock({
      scenePacingOwner: owner,
      v2Block: v2Block(),
      livingBlock: livingBlock(),
      legacyBlock: legacyBlock(),
    });
    const transformed = applyRpDiagnosticToSceneDirectiveBlock({
      block: raw,
      canary: { variant: "baseline", userId: 1, modelId: "x", contentKind: "character" },
      completedTurns: 1,
      progressionAxis: null,
    });
    assert.ok(transformed.includes(LIVING_MARKER));
  });

  it("C9 final provider prompt owner count — experiment owners skip [SCENE PACING]", () => {
    const v2Applied = wireWithBlock({
      block: v2Block(),
      owner: "event_restraint_v2",
    });
    const v2System = v2Applied.messages.find((m) => m.role === "system")?.content ?? "";
    const v2Owners = countPacingOwners(v2System);
    assert.equal(v2Owners.scene_pacing, 0);
    assert.equal(v2Owners.pacing_sot_count, 1);

    const standardApplied = wireWithBlock({
      block: legacyBlock(),
      owner: "legacy_v1",
    });
    const standardSystem = standardApplied.messages.find((m) => m.role === "system")?.content ?? "";
    const standardOwners = countPacingOwners(standardSystem);
    assert.equal(standardOwners.scene_pacing, 1);
    assert.ok(!standardSystem.includes(V2_MARKER));
  });

  it("C10 generationPreparationUi uses same scenePacingOwner source as materialize", () => {
    assert.match(ROUTE_SOURCE, /scenePacingOwner === "event_restraint_v2"/);
    assert.match(ROUTE_SOURCE, /materializeSceneDirectivePromptBlock\(/);
    assert.match(ROUTE_SOURCE, /scenePacingPromptOwner:\s*scenePacingOwner/);
  });

  it("C11 reconvergence namespace — shadow vs production from inject flag", () => {
    assert.match(ROUTE_SOURCE, /sceneDirectiveV2Inject\s*\?\s*"production"\s*:\s*"shadow"/);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "off" }), false);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "on" }), true);
  });

  it("C12 default Railway-like env — unset flags, legacy_v1 unchanged", () => {
    const env = railwayLikeEnv();
    assert.equal(getSceneDirectiveV2Mode(env), "off");
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false }),
      "legacy_v1"
    );
    const built = buildContext({
      charName: PRIMARY,
      contentKind: "character",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "안녕.",
      nsfw: false,
      provider: "openrouter",
    });
    assert.ok(!built.systemPrompt.includes(V2_MARKER));
    assert.ok(!built.systemPrompt.includes(LIVING_MARKER));
  });

  it("C13 regen — scenePacingPromptOwner preserved via contextBuildInput spread", () => {
    const block = v2Block();
    const built = buildContext({
      charName: PRIMARY,
      contentKind: "character",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]",
      nsfw: false,
      provider: "openrouter",
      regenerate: true,
      rejectedAssistantDraft: "테스트 초안.",
      sceneDirectiveBlock: block,
      scenePacingPromptOwner: "event_restraint_v2",
    });
    assert.ok(built.systemPrompt.includes(V2_MARKER));
    assert.ok(!built.systemPrompt.includes("[SCENE PACING]"));
  });

  it("C14 continuation — experiment owner injects block on standard interactive", () => {
    const block = livingBlock();
    const built = buildContext({
      charName: PRIMARY,
      contentKind: "character",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [{ role: "assistant", content: "..." }],
      currentUserMessage: "이어서.",
      nsfw: false,
      provider: "openrouter",
      isContinue: true,
      sceneDirectiveBlock: block,
      scenePacingPromptOwner: "living_continuity_director",
    });
    assert.ok(built.systemPrompt.includes(LIVING_MARKER));
  });
});

describe("scene directive owner contract — route assembly order", () => {
  it("owner materialize precedes optional rpDiagnosticCanary transform", () => {
    assert.match(ROUTE_SOURCE, /rawSceneDirectiveBlock = materializeSceneDirectivePromptBlock/);
    assert.match(
      ROUTE_SOURCE,
      /const sceneDirectiveBlock = rpDiagnosticCanary[\s\S]*block:\s*rawSceneDirectiveBlock/
    );
    assert.doesNotMatch(
      ROUTE_SOURCE,
      /const sceneDirectiveBlock = rpDiagnosticCanary[\s\S]*:\s*renderSceneDirectiveForPrompt\(sceneDirectiveForRender\)/
    );
  });
});
