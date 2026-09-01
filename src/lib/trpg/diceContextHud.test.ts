import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildTrpgDiceContextViewModel,
  trpgDiceActorStatLine,
  trpgDiceA11yStatus,
  trpgDiceResultFormulaLine,
  trpgDiceResultVisible,
  trpgDiceTargetDcLine,
} from "./diceContextHud";
import {
  activePresentationRollProgress,
  buildRoundPresentationActors,
  type RoundPresentationState,
} from "./roundPresentation";
import type { TrpgPublicAction, TrpgPublicRoll } from "./snapshot";
import type { TrpgStatDefinition } from "./types";

const DICE_PHASE: RoundPresentationState = {
  mode: "cinematic",
  phase: "actor-dice",
  presentationIndex: 0,
};

function action(
  participantId: number,
  kind: TrpgPublicAction["kind"] = "human"
): TrpgPublicAction {
  return {
    participantId,
    name: `actor-${participantId}`,
    body: `action-${participantId}`,
    revealed: true,
    kind,
    actionType: "investigate",
  };
}

function roll(
  participantId: number,
  overrides: Partial<TrpgPublicRoll> = {}
): TrpgPublicRoll {
  return {
    participantId,
    name: `actor-${participantId}`,
    d20: 12,
    statKey: "nerve",
    finalScore: 12,
    dc: 11,
    tier: "SUCCESS",
    success: true,
    actionBody: `action-${participantId}`,
    actionType: "investigate",
    kind: participantId === 1 ? "human" : "ai_character",
    ...overrides,
  };
}

const statDefs: TrpgStatDefinition[] = [
  { key: "body", label: "육체", description: "", min: 0, max: 20 },
  { key: "nerve", label: "담력", description: "", min: 0, max: 20 },
];

function progressFor(
  order: number[],
  rolls: TrpgPublicRoll[],
  presentationIndex: number
) {
  const actors = buildRoundPresentationActors({
    resolutionOrder: order,
    actions: order.map((id) => action(id, id === 1 ? "human" : "ai_character")),
    rolls,
  });
  return activePresentationRollProgress({
    actors,
    state: { ...DICE_PHASE, presentationIndex },
  });
}

describe("TRPG contextual dice HUD", () => {
  it("A: numbers three roll actors 1/3, 2/3, 3/3", () => {
    const rolls = [roll(1), roll(2), roll(3)];
    assert.deepEqual(progressFor([1, 2, 3], rolls, 0), { rollOrdinal: 1, rollTotal: 3 });
    assert.deepEqual(progressFor([1, 2, 3], rolls, 1), { rollOrdinal: 2, rollTotal: 3 });
    assert.deepEqual(progressFor([1, 2, 3], rolls, 2), { rollOrdinal: 3, rollTotal: 3 });
  });

  it("B: excludes a no-roll human from 1/2, 2/2", () => {
    const rolls = [roll(2), roll(3)];
    assert.deepEqual(progressFor([1, 2, 3], rolls, 1), { rollOrdinal: 1, rollTotal: 2 });
    assert.deepEqual(progressFor([1, 2, 3], rolls, 2), { rollOrdinal: 2, rollTotal: 2 });
  });

  it("C: excludes a no-roll bot between human and bot2", () => {
    const rolls = [roll(1), roll(3)];
    assert.deepEqual(progressFor([1, 2, 3], rolls, 0), { rollOrdinal: 1, rollTotal: 2 });
    assert.deepEqual(progressFor([1, 2, 3], rolls, 2), { rollOrdinal: 2, rollTotal: 2 });
  });

  it("D: follows resolutionOrder rather than declaration persistence order", () => {
    const actions = [action(3), action(1), action(2)];
    const rolls = [roll(3), roll(1), roll(2)];
    const actors = buildRoundPresentationActors({
      resolutionOrder: [2, 3, 1],
      actions,
      rolls,
    });
    assert.deepEqual(actors.map((actor) => actor.actorId), [2, 3, 1]);
    assert.deepEqual(
      activePresentationRollProgress({
        actors,
        state: { ...DICE_PHASE, presentationIndex: 0 },
      }),
      { rollOrdinal: 1, rollTotal: 3 }
    );
    assert.deepEqual(
      activePresentationRollProgress({
        actors,
        state: { ...DICE_PHASE, presentationIndex: 2 },
      }),
      { rollOrdinal: 3, rollTotal: 3 }
    );
  });

  it("returns no progress outside the actor-dice phase", () => {
    const actors = buildRoundPresentationActors({
      resolutionOrder: [1],
      actions: [action(1)],
      rolls: [roll(1)],
    });
    assert.equal(
      activePresentationRollProgress({
        actors,
        state: { mode: "cinematic", phase: "actor-action", presentationIndex: 0 },
      }),
      null
    );
  });

  it("E: resolves custom stat labels instead of exposing raw stat keys", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(2),
      progress: { rollOrdinal: 1, rollTotal: 2 },
      statDefs,
    });
    assert.equal(vm.statLabel, "담력");
    assert.notEqual(vm.statLabel, "nerve");
  });

  it("F: uses parsed AI intent and removes provider control markers", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(2, {
        actionBody:
          "문 앞에 선다.\n<<<ACTION_TYPE>>>\nattack\n<<<INTENT>>>\n강이현은 문을 걷어차 열려 했다.",
        actionType: "attack",
      }),
      progress: { rollOrdinal: 1, rollTotal: 1 },
      statDefs,
    });
    assert.equal(vm.actionSummary, "강이현은 문을 걷어차 열려 했다.");
    assert.equal(vm.actionTypeLabel, "공격");
    assert.doesNotMatch(vm.actionSummary, /<<<(?:INTENT|ACTION_TYPE)>>>/);
  });

  it("G: missing AI intent yields empty canonical summary (no prose fallback)", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(2, {
        actionBody: "상자 뒤를 살피며 조심스럽게 다가간다.\n<<<ACTION_TYPE>>>\ninvestigate",
      }),
      progress: null,
      statDefs,
    });
    assert.equal(vm.actionSummary, "");
    assert.doesNotMatch(vm.actionSummary, /상자 뒤를/);
  });

  it("H: shows canonical human action safely and clips long text", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(1, {
        actionBody: `렌의 옆으로 파고들어 무너지는 문을 받친다. ${"긴 행동 ".repeat(40)}`,
      }),
      progress: null,
      statDefs,
    });
    assert.match(vm.actionSummary, /^렌의 옆으로/);
    assert.ok(Array.from(vm.actionSummary).length <= 140);
  });

  it("I/J/K: derives positive, negative, and zero combined modifiers with sign-safe formula", () => {
    const positive = buildTrpgDiceContextViewModel({
      roll: roll(1, { d20: 17, finalScore: 20 }),
      progress: null,
      statDefs,
    });
    const negative = buildTrpgDiceContextViewModel({
      roll: roll(1, { d20: 17, finalScore: 15 }),
      progress: null,
      statDefs,
    });
    const zero = buildTrpgDiceContextViewModel({
      roll: roll(1, { d20: 17, finalScore: 17 }),
      progress: null,
      statDefs,
    });
    assert.deepEqual(
      [positive.combinedModifierLabel, negative.combinedModifierLabel, zero.combinedModifierLabel],
      ["+3", "-2", "+0"]
    );
    assert.equal(trpgDiceResultFormulaLine(positive), "d20 17 · 총 보정 +3 → 최종 20");
    assert.equal(trpgDiceResultFormulaLine(negative), "d20 17 · 총 보정 -2 → 최종 15");
    assert.equal(trpgDiceResultFormulaLine(zero), "d20 17 · 총 보정 +0 → 최종 17");
  });

  it("L: exposes every exact tier through the shared successLabelKo owner", () => {
    const expected: Array<[TrpgPublicRoll["tier"], string]> = [
      ["CRITICAL_FAILURE", "치명적 실패"],
      ["SEVERE_FAILURE", "처참한 실패"],
      ["FAILURE", "실패"],
      ["PARTIAL_SUCCESS", "부분 성공"],
      ["SUCCESS", "성공"],
      ["GREAT_SUCCESS", "대성공"],
      ["CRITICAL_SUCCESS", "치명적 성공"],
    ];
    for (const [tier, label] of expected) {
      const vm = buildTrpgDiceContextViewModel({
        roll: roll(1, { tier }),
        progress: null,
        statDefs,
      });
      assert.equal(vm.tierLabel, label);
    }
  });

  it("M: preserves suspense until settle and then exposes formula + exact tier with actor identity", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(1, { d20: 17, finalScore: 20, tier: "GREAT_SUCCESS", name: "권태현", statKey: "body" }),
      progress: { rollOrdinal: 2, rollTotal: 3 },
      statDefs,
    });
    vm.statLabel = "힘";
    const actorStat = trpgDiceActorStatLine(vm);
    assert.equal(actorStat, "권태현 · 힘 판정");
    assert.equal(trpgDiceResultVisible("rolling"), false);
    assert.equal(trpgDiceResultVisible("entering"), true);
    assert.doesNotMatch(trpgDiceA11yStatus(vm, false), /17|최종|대성공/);
    assert.match(trpgDiceA11yStatus(vm, false), /판정 2\/3.*권태현.*힘 판정.*목표 DC 11/);
    assert.match(
      trpgDiceA11yStatus(vm, true),
      /권태현.*힘 판정.*17.*총 보정 \+3.*최종 20.*목표 DC 11.*대성공/
    );
    assert.equal(trpgDiceResultFormulaLine(vm), "d20 17 · 총 보정 +3 → 최종 20");
    assert.equal(trpgDiceTargetDcLine(vm.dc), "목표 DC 11");

    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /trpgDiceResultVisible\(resultPhase\)/);
    assert.match(overlay, /\{showResult \? \(/);
    assert.match(overlay, /trpgDiceActorStatLine\(context\)/);
    assert.match(overlay, /data-trpg-dice-actor-stat-line/);
    assert.match(overlay, /trpgDiceResultFormulaLine\(context\)/);
    assert.match(overlay, /data-trpg-dice-result-formula/);
    assert.match(overlay, /data-trpg-dice-target-dc/);
    assert.match(overlay, /data-trpg-dice-context-phase=\{showResult \? "result" : "rolling"\}/);
    assert.match(overlay, /!showResult && context\.actionSummary/);
    assert.match(overlay, /!showResult && context\.actionTypeLabel/);
    assert.doesNotMatch(overlay, /data-trpg-dice-numeral/);
    assert.doesNotMatch(overlay, /주사위.*이상.*성공/);
    assert.doesNotMatch(overlay, /스탯 보너스/);
  });

  it("N: contextual HUD and static settle lifecycle share renderer parity across WebGL/static/reduced motion", () => {
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    const contextAt = overlay.indexOf("data-trpg-dice-context");
    const rendererBranchAt = overlay.indexOf("decision && use3d");
    assert.ok(contextAt > 0 && contextAt < rendererBranchAt);
    assert.match(overlay, /decision && !use3d/);
    assert.match(overlay, /data-trpg-dice-reduced-motion/);
    assert.match(overlay, /shouldScheduleTrpgStaticSettle/);
    assert.match(overlay, /onDieSettled\("static"\)/);
    assert.match(overlay, /if \(!visible \|\| ordered\.length === 0 \|\| !use3d\) return/);
    assert.match(overlay, /data-trpg-dice-static-settle-ms/);
  });

  it("O: preserves existing nat20 and nat1 visual effects", () => {
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /data-trpg-dice-burst="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst-ring="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst-spark="nat20"/);
    assert.match(overlay, /data-trpg-dice-burst="nat1"/);
    assert.match(overlay, /data-trpg-dice-burst-ring="nat1"/);
    assert.match(overlay, /data-trpg-dice-burst-vignette="nat1"/);
  });

  it("P: preserves the existing mount-consumption replay owner", () => {
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /shouldConsumeMountRollSession/);
    assert.match(overlay, /consumedKeysRef/);
    assert.match(overlay, /trpgDiceOverlaySessionAction/);
  });

  it("Q: keeps declaration streaming and the single scroll owner untouched", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    assert.match(room, /resolveLiveActorDeclarationPresentation/);
    assert.match(room, /resolveTrpgLiveFollowOwner/);
    assert.match(room, /activeDeclarationReveal: liveDeclaration\.activeDeclarationActorId != null/);
    assert.match(room, /data-trpg-live-follow-owner/);
  });

  it("uses one overlay and one a11y status owner with deterministic diagnostics", () => {
    const room = readFileSync("src/app/trpg/TrpgCampaignRoom.tsx", "utf8");
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.equal((room.match(/<TrpgDiceOverlay(?:\s|>)/g) ?? []).length, 1);
    assert.equal((overlay.match(/role="status"/g) ?? []).length, 1);
    for (const attribute of [
      "roll-ordinal",
      "roll-total",
      "actor-id",
      "actor-name",
      "stat-key",
      "stat-label",
      "action-type",
      "action-summary",
      "d20",
      "combined-modifier",
      "final-score",
      "dc",
      "tier",
      "actor-stat-line",
      "action-type-label",
      "target-dc",
      "context-phase",
      "result-tier",
    ]) {
      assert.match(overlay, new RegExp(`data-trpg-dice-${attribute}`));
    }
  });

  it("identity: actor name visible during rolling and result phases", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(1, { name: "권태현" }),
      progress: { rollOrdinal: 2, rollTotal: 3 },
      statDefs,
    });
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(trpgDiceA11yStatus(vm, false), /권태현/);
    assert.match(trpgDiceA11yStatus(vm, true), /권태현/);
    assert.match(overlay, /data-trpg-dice-actor-stat-line/);
    assert.match(overlay, /data-trpg-dice-actor-name=\{context\.actorName\}/);
  });

  it("identity: stat label visible during rolling and result phases", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(1, { statKey: "body" }),
      progress: { rollOrdinal: 1, rollTotal: 1 },
      statDefs,
    });
    assert.equal(vm.statLabel, "육체");
    assert.match(trpgDiceActorStatLine(vm), /육체 판정/);
    assert.match(trpgDiceA11yStatus(vm, false), /육체 판정/);
    assert.match(trpgDiceA11yStatus(vm, true), /육체 판정/);
  });

  it("identity: d20 hidden pre-settle and visible post-settle with final score, target DC, and tier", () => {
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(1, { d20: 17, finalScore: 20, dc: 12, tier: "GREAT_SUCCESS" }),
      progress: null,
      statDefs,
    });
    assert.equal(trpgDiceResultVisible("rolling"), false);
    assert.equal(trpgDiceResultVisible("holding"), true);
    assert.match(trpgDiceResultFormulaLine(vm), /d20 17 · 총 보정 \+3 → 최종 20/);
    assert.equal(trpgDiceTargetDcLine(12), "목표 DC 12");
    assert.equal(vm.tierLabel, "대성공");

    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /data-trpg-dice-result-numeral=\{face\}/);
    assert.match(overlay, /\{face\}/);
    assert.match(overlay, /data-trpg-dice-result-tier/);
  });

  it("identity: long rolling action summary is clamped and hidden during result to avoid covering die", () => {
    const longBody = `렌의 옆으로 파고들어 무너지는 문을 받친다. ${"긴 행동 ".repeat(40)}`;
    const vm = buildTrpgDiceContextViewModel({
      roll: roll(1, { actionBody: longBody }),
      progress: null,
      statDefs,
    });
    assert.ok(Array.from(vm.actionSummary).length <= 140);
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /WebkitLineClamp: 2/);
    assert.match(overlay, /!showResult && context\.actionSummary/);
    assert.match(overlay, /data-trpg-dice-context-phase/);
    assert.match(overlay, /pt-28 md:-translate-y-\[2%\]/);
  });

  it("identity: action type visible during rolling when present and omitted when null", () => {
    const withType = buildTrpgDiceContextViewModel({
      roll: roll(2, { actionType: "support" }),
      progress: null,
      statDefs,
    });
    assert.equal(withType.actionTypeLabel, "지원");
    const withoutType = buildTrpgDiceContextViewModel({
      roll: roll(1, { actionType: undefined }),
      progress: null,
      statDefs,
    });
    assert.equal(withoutType.actionTypeLabel, null);

    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /!showResult && context\.actionTypeLabel/);
    assert.match(overlay, /data-trpg-dice-action-type-label/);
  });

  it("identity: preserves #696 single production dice style without theme selector code", () => {
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /trpgProductionDiceStaticFallback/);
    assert.match(overlay, /data-trpg-dice-visual="production-d20"/);
    assert.doesNotMatch(overlay, /TrpgD20ThemeId/);
    assert.doesNotMatch(overlay, /PRODUCTION_D20_THEME/);
    assert.doesNotMatch(overlay, /data-trpg-dice-theme/);
    assert.doesNotMatch(overlay, /theme=/);
  });

  it("identity: large d20 result numeral styling preserved from production fallback owner", () => {
    const overlay = readFileSync("src/app/trpg/TrpgDiceOverlay.tsx", "utf8");
    assert.match(overlay, /trpgD20ResultHudStyle\(tone, face\)/);
    assert.match(overlay, /style=\{resultHud\.numeral\}/);
    assert.match(overlay, /data-trpg-dice-result-numeral=\{face\}/);
  });
});
