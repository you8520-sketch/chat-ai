/**
 * Dead system / parallel owner audit — sceneDirectiveV2 + livingSceneDirective.
 * Zero provider calls. Production execution path is source of truth.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  getSceneDirectiveV2Mode,
  isSceneDirectiveV2ComputeEnabled,
  isSceneDirectiveV2InjectEnabled,
  resolveScenePacingPromptOwner,
} from "@/lib/sceneDirectiveV2Policy";
import { isLivingSceneDirectiveV2EnabledForUser } from "@/lib/livingSceneDirectivePolicy";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

const PRIMARY = "테스트주인공";
const ROUTE_SOURCE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function productionDefaultEnv(): NodeJS.ProcessEnv {
  return { SCENE_DIRECTIVE_V2_MODE: "off" };
}

/** Mirrors route.ts default-off prompt block selection (no rpDiagnosticCanary). */
function defaultOffSceneDirectiveBlock(): string {
  const directive = buildSceneDirective({
    mode: "interactive",
    contentKind: "character",
    primaryCharacterName: PRIMARY,
    currentUserMessage: "조용히 있다.",
    chatId: 3001,
    currentTurn: 2,
  });
  return renderSceneDirectiveForPrompt(directive);
}

function wireProduction(input: {
  mode?: "interactive" | "auto_progression";
  contentKind?: "character" | "simulation";
  skipMotionCue?: boolean;
  fullBlock?: string;
}) {
  const mode = input.mode ?? "interactive";
  const contentKind = input.contentKind ?? "character";
  const directive = buildSceneDirective({
    mode,
    contentKind,
    primaryCharacterName: PRIMARY,
    establishedActiveCastNames:
      contentKind === "simulation" ? ["테스트조연", "테스트NPC"] : undefined,
    currentUserMessage: "조용히 있다.",
    chatId: 3002,
    currentTurn: 2,
  });
  const block =
    input.fullBlock ??
    (mode === "auto_progression" || contentKind === "simulation"
      ? renderSceneDirectiveForPrompt(directive)
      : "");
  return applyProductionServerControlsToMessages({
    messages: [
      {
        role: "system",
        content: `[CORE]\n${SCENE_FLOW_BLOCK}${block ? `\n${block}` : ""}\n[IMMERSIVE PROSE]\nok`,
      },
      { role: "user", content: "조용히 있다." },
    ],
    mode,
    contentKind,
    primaryCharacterName: PRIMARY,
    currentUserMessage: "조용히 있다.",
    canonicalSceneDirective: directive,
    skipMotionCue: input.skipMotionCue ?? (mode === "auto_progression" || contentKind === "simulation"),
  });
}

describe("dead system parallel owner audit D1-D12", () => {
  it("D1 sceneDirectiveV2 production caller exists in route (env-gated experiment)", () => {
    assert.match(ROUTE_SOURCE, /buildSceneDirectiveV2\(/);
    assert.match(ROUTE_SOURCE, /sceneDirectiveV2Compute/);
    assert.match(ROUTE_SOURCE, /renderSceneDirectiveV2ForPrompt/);
    assert.match(ROUTE_SOURCE, /commitReconvergenceTransition/);
    assert.doesNotMatch(ROUTE_SOURCE, /buildSceneDirectiveV2PromptBlock/);
  });

  it("D2 livingSceneDirective production caller exists in route (env-gated canary)", () => {
    assert.match(ROUTE_SOURCE, /buildLivingSceneDirective\(/);
    assert.match(ROUTE_SOURCE, /isLivingSceneDirectiveV2EnabledForUser/);
    assert.match(ROUTE_SOURCE, /renderLivingSceneDirectiveForPrompt/);
    assert.doesNotMatch(ROUTE_SOURCE, /buildLivingSceneDirectivePromptBlock/);
  });

  it("D3 feature flag / env OFF — default production prompt owner is legacy v1.2", () => {
    const env = productionDefaultEnv();
    assert.equal(getSceneDirectiveV2Mode(env), "off");
    assert.equal(isSceneDirectiveV2ComputeEnabled(env), false);
    assert.equal(isSceneDirectiveV2InjectEnabled(env), false);
    assert.equal(isLivingSceneDirectiveV2EnabledForUser(1, "gpt-5.6-luna"), false);
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false }),
      "legacy_v1"
    );
    const block = defaultOffSceneDirectiveBlock();
    assert.match(block, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.doesNotMatch(block, /\[PRIVATE SCENE PACING RULE\]/);
  });

  it("D4 Standard final prompt parity — default-off wire unchanged", () => {
    const before = wireProduction({ mode: "interactive", skipMotionCue: false });
    const after = wireProduction({ mode: "interactive", skipMotionCue: false });
    const sysBefore = before.messages.find((m) => m.role === "system")?.content ?? "";
    const sysAfter = after.messages.find((m) => m.role === "system")?.content ?? "";
    assert.equal(sha256(sysBefore), sha256(sysAfter));
    const owners = countPacingOwners(sysBefore);
    assert.equal(owners.scene_pacing, 1);
    assert.equal(owners.pacing_sot_count, 1);
    assert.doesNotMatch(sysBefore, /\[PRIVATE SCENE ENGINE RULE\]/);
  });

  it("D5 Auto final prompt parity — full v1.2 block only", () => {
    const applied = wireProduction({ mode: "auto_progression", skipMotionCue: true });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 0);
    assert.equal(owners.pacing_sot_count, 1);
    assert.match(system, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.doesNotMatch(system, /\[PRIVATE SCENE PACING RULE\]/);
  });

  it("D6 Simulation final prompt parity — full v1.2 block only", () => {
    const applied = wireProduction({
      mode: "interactive",
      contentKind: "simulation",
      skipMotionCue: true,
    });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 0);
    assert.equal(owners.pacing_sot_count, 1);
    assert.match(system, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.equal(applied.decision.castMode, "simulation");
  });

  it("D7 motion owner count unchanged under default-off policy", () => {
    const standard = wireProduction({ mode: "interactive" });
    const auto = wireProduction({ mode: "auto_progression" });
    const sim = wireProduction({ contentKind: "simulation" });
    for (const applied of [standard, auto, sim]) {
      const owners = countPacingOwners(
        applied.messages.find((m) => m.role === "system")?.content ?? ""
      );
      assert.equal(owners.pacing_sot_count, 1);
    }
  });

  it("D8 prompt owner count unchanged — no dual V2/Living inject when flags off", () => {
    const owner = resolveScenePacingPromptOwner({ v2Mode: "off", livingEnabled: false });
    assert.equal(owner, "legacy_v1");
    const block = defaultOffSceneDirectiveBlock();
    assert.doesNotMatch(block, /Event Restraint|Continuity Director|PRIVATE SCENE PACING RULE/);
  });

  it("D9 progression history writer/reader — route commits legacy sceneDirective only", () => {
    const commitIdx = ROUTE_SOURCE.indexOf("commitSceneProgressionState({");
    assert.ok(commitIdx >= 0);
    const commitSnippet = ROUTE_SOURCE.slice(commitIdx, commitIdx + 400);
    assert.match(commitSnippet, /types:\s*sceneDirective\.progressionTypes/);
    assert.doesNotMatch(commitSnippet, /eventRestraintV2/);
    assert.doesNotMatch(commitSnippet, /livingSceneDirective/);
    assert.match(ROUTE_SOURCE, /canonicalSceneDirective:\s*legacySceneDirective/);
  });

  it("D10 fallback / regen / continuation — buildContext without V2/Living flags", () => {
    const regen = buildContext({
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
    });
    assert.doesNotMatch(regen.systemPrompt, /PRIVATE SCENE PACING RULE/);
    assert.doesNotMatch(regen.systemPrompt, /Continuity Director/);

    const continuation = buildContext({
      charName: PRIMARY,
      contentKind: "character",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [{ role: "assistant", content: "..." }],
      currentUserMessage: "이어서.",
      nsfw: false,
      provider: "openrouter",
      isContinue: true,
    });
    assert.doesNotMatch(continuation.systemPrompt, /PRIVATE SCENE PACING RULE/);
  });

  it("D11 provider call count — V2/Living are pre-provider compute only", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /buildSceneDirectiveV2[\s\S]{0,200}fetch\(/);
    assert.doesNotMatch(ROUTE_SOURCE, /buildLivingSceneDirective[\s\S]{0,200}fetch\(/);
    assert.doesNotMatch(ROUTE_SOURCE, /logSceneDirectiveV2Telemetry[\s\S]{0,120}openRouter/);
  });

  it("D12 billing path unchanged — no V2/Living billing hooks in chat route", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /sceneDirectiveV2[\s\S]{0,80}(deduct|billing|points|charge)/i);
    assert.doesNotMatch(ROUTE_SOURCE, /livingSceneDirective[\s\S]{0,80}(deduct|billing|points|charge)/i);
    assert.doesNotMatch(ROUTE_SOURCE, /eventRestraintV2[\s\S]{0,80}(deduct|billing|points|charge)/i);
  });
});

describe("dead system parallel owner — policy matrix", () => {
  it("V2 shadow computes but legacy owns prompt; V2 on wins owner only when inject enabled", () => {
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "shadow", livingEnabled: false }),
      "legacy_v1"
    );
    assert.equal(
      resolveScenePacingPromptOwner({ v2Mode: "on", livingEnabled: true }),
      "event_restraint_v2"
    );
    assert.equal(isSceneDirectiveV2InjectEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), false);
    assert.equal(isSceneDirectiveV2ComputeEnabled({ SCENE_DIRECTIVE_V2_MODE: "shadow" }), true);
  });

  it("rpDiagnosticCanary gates alternate block render — normal path uses legacy v1 only", () => {
    assert.match(ROUTE_SOURCE, /const sceneDirectiveBlock = rpDiagnosticCanary/);
    assert.match(
      ROUTE_SOURCE,
      /:\s*renderSceneDirectiveForPrompt\(sceneDirectiveForRender\)/
    );
  });
});
