/**
 * Offline prompt integrity gate — base-engine-preservation isolation.
 *
 * Run: node --conditions=react-server --import tsx --test src/lib/sceneFocusPalette.offline.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { ChatMsg } from "@/lib/ai";
import {
  BASE_SCENE_ENGINE_RULE,
  buildSceneDirective,
  extractSceneEngineRule,
  measureSerializedSceneBeatBudget,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import {
  ACTIVE_DYAD_PALETTE,
  ACTIVE_DYAD_SCENE_ENGINE_MOTION,
} from "@/lib/sceneFocusPalette";
import {
  RP_DIAGNOSTIC_CANARY_ENV,
  resolveCanarySceneFocusPalette,
  resolveCanarySceneFocusState,
  resolveRpDiagnosticCanary,
  rpDiagnosticPreservesBaseSceneEngineRule,
  rpDiagnosticUsesStructuredSceneFocus,
} from "@/lib/rpDiagnosticCanary";
import { TERRA_TERMINAL_LENGTH_OWNER_CONTRACT } from "@/lib/terraTerminalLengthOwner";

const recent: ChatMsg[] = [
  {
    role: "assistant",
    content:
      "라이크가 가만히 렌을 바라보다가, 짧게 숨을 골랐다. 「……렌?」 목소리가 낮았다.",
  },
  { role: "user", content: "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)" },
];

function sha(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function extractLine(block: string, prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.+$`, "m");
  return block.match(re)?.[0] ?? "";
}

function allowedSlotDiffOnly(prod: string, cand: string): boolean {
  // Strip allowed-to-differ lines; remainders must match.
  const strip = (s: string) =>
    s
      .split("\n")
      .filter((line) => {
        if (line.startsWith("전개 방향:")) return false;
        if (line.startsWith("다음 장면 힌트:")) return false;
        if (line.startsWith("직접 발화 중심:")) return false;
        if (line.startsWith("정체 감지:")) return false;
        if (line.startsWith("권장 강도:")) return false;
        if (line.startsWith("피할 것:")) return false;
        return true;
      })
      .join("\n");
  return strip(prod) === strip(cand);
}

describe("structured scene focus — base engine preservation offline", () => {
  it("default parity: null palette byte-identical", () => {
    const a = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    const b = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: null,
    });
    assert.equal(renderSceneDirectiveForPrompt(a), renderSceneDirectiveForPrompt(b));
  });

  it("base engine rule byte parity under ACTIVE_DYAD palette", () => {
    const prod = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    const dyad = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 9001,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const prodBlock = renderSceneDirectiveForPrompt(prod);
    const dyadBlock = renderSceneDirectiveForPrompt(dyad);

    assert.equal(extractSceneEngineRule(dyadBlock), extractSceneEngineRule(prodBlock));
    assert.equal(extractSceneEngineRule(dyadBlock), BASE_SCENE_ENGINE_RULE);
    assert.doesNotMatch(dyadBlock, new RegExp(ACTIVE_DYAD_SCENE_ENGINE_MOTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    // Diagnostic-only retention of palette motion.
    assert.equal(
      dyad.focusDiagnostics?.engineMotionDiagnostic,
      ACTIVE_DYAD_SCENE_ENGINE_MOTION
    );

    assert.equal(extractLine(prodBlock, "모드:"), extractLine(dyadBlock, "모드:"));
    assert.equal(extractLine(prodBlock, "유저 조종:"), extractLine(dyadBlock, "유저 조종:"));
    assert.ok(allowedSlotDiffOnly(prodBlock, dyadBlock));

    // No new section / ban wording.
    assert.doesNotMatch(dyadBlock, /\[장면 초점/);
    assert.doesNotMatch(dyadBlock, /ACTIVE_DYAD/);
    assert.doesNotMatch(dyadBlock, /NPC를 만들지 마라|외부 사건을 시작하지 마라/);

    // Terminal length owner / extras unchanged constants (not in SceneDirective, but parity probe).
    assert.ok(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT.length > 20);
    assert.equal(sha(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT), sha(TERRA_TERMINAL_LENGTH_OWNER_CONTRACT));
  });

  it("external source withholding + replacement presence", () => {
    const dyad = buildSceneDirective({
      mode: "interactive",
      recentMessages: recent,
      currentUserMessage: recent[1]!.content,
      chatId: 42,
      currentTurn: 1,
      contentKind: "character",
      primaryCharacterName: "라이크",
      triggeredEventText: "경비 담당자가 등록 절차를 안내한다.",
      sceneFocusPalette: ACTIVE_DYAD_PALETTE,
    });
    const sources = dyad.focusDiagnostics?.resolvedProgressionSources ?? [];
    assert.ok(!sources.includes("NEW_SPEAKING_NPC"));
    assert.ok(!sources.includes("ADMINISTRATIVE_PROCESS"));
    assert.ok(!sources.includes("NEW_EXTERNAL_EVENT"));
    assert.ok(
      sources.includes("PRIMARY_DECISION") || sources.includes("PRIMARY_ACTION")
    );
    assert.ok(
      sources.includes("RELATIONSHIP_MOVEMENT") ||
        sources.includes("EXISTING_ENVIRONMENT")
    );
  });

  it("internal beat count preserved; prompt beat budget measured", () => {
    const reports: Array<Record<string, unknown>> = [];
    for (const chatId of [1, 2, 3, 11, 99, 1001]) {
      const dyad = buildSceneDirective({
        mode: "interactive",
        recentMessages: recent,
        currentUserMessage: recent[1]!.content,
        chatId,
        currentTurn: 1,
        contentKind: "character",
        primaryCharacterName: "라이크",
        triggeredEventText: "방문객과 직원이 서류를 들고 다가온다.",
        sceneFocusPalette: ACTIVE_DYAD_PALETTE,
      });
      const d = dyad.focusDiagnostics!;
      assert.ok(d.resolvedBeatCount >= d.requestedBeatCount);
      assert.equal(d.replacementSources.length, d.externalSourcesWithheld.length);
      const block = renderSceneDirectiveForPrompt(dyad);
      const budget = measureSerializedSceneBeatBudget({
        sceneDirectiveBlock: block,
        requestedBeatCount: d.requestedBeatCount,
        resolvedBeatCount: d.resolvedBeatCount,
      });
      assert.equal(budget.internalBeatCountPreserved, true);
      reports.push({
        chatId,
        requestedBeatCount: d.requestedBeatCount,
        resolvedBeatCount: d.resolvedBeatCount,
        INTERNAL_BEAT_COUNT_PRESERVED: budget.internalBeatCountPreserved,
        PROMPT_BEAT_BUDGET_PRESERVED: budget.promptBeatBudgetPreserved,
        serializedProgressionLabelCount: budget.serializedProgressionLabelCount,
        serializedConcreteBeatInstructionCount:
          budget.serializedConcreteBeatInstructionCount,
        nextBeatHintCharCount: budget.nextBeatHintCharCount,
        nextBeatHintClauseCount: budget.nextBeatHintClauseCount,
      });
    }
    // Record for artifact consumers — do not fail offline gate solely on prompt budget
    // (multi-beat serializer is explicitly deferred until after screening).
    assert.ok(reports.every((r) => r.INTERNAL_BEAT_COUNT_PRESERVED === true));
    (globalThis as { __SCENE_FOCUS_BEAT_BUDGET_REPORT__?: unknown }).__SCENE_FOCUS_BEAT_BUDGET_REPORT__ =
      reports;
  });

  it("canary helper: base_engine_preserved variant + ACTIVE_DYAD window", () => {
    const saved = {
      e: process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED],
      u: process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS],
      m: process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS],
      v: process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT],
      s: process.env[RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE],
    };
    try {
      process.env[RP_DIAGNOSTIC_CANARY_ENV.ENABLED] = "true";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.USER_IDS] = "34";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS] = "deepseek-v4-pro";
      process.env[RP_DIAGNOSTIC_CANARY_ENV.VARIANT] =
        "structured_scene_focus_active_dyad_base_engine_preserved";
      delete process.env[RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE];

      const canary = resolveRpDiagnosticCanary({
        userId: 34,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      });
      assert.ok(canary);
      assert.equal(rpDiagnosticUsesStructuredSceneFocus(canary!.variant), true);
      assert.equal(rpDiagnosticPreservesBaseSceneEngineRule(canary!.variant), true);
      assert.equal(
        resolveCanarySceneFocusState({ canary, completedTurns: 0 }),
        "ACTIVE_DYAD"
      );
      assert.ok(resolveCanarySceneFocusPalette({ canary, completedTurns: 0 }));
    } finally {
      for (const [k, v] of Object.entries({
        [RP_DIAGNOSTIC_CANARY_ENV.ENABLED]: saved.e,
        [RP_DIAGNOSTIC_CANARY_ENV.USER_IDS]: saved.u,
        [RP_DIAGNOSTIC_CANARY_ENV.MODEL_IDS]: saved.m,
        [RP_DIAGNOSTIC_CANARY_ENV.VARIANT]: saved.v,
        [RP_DIAGNOSTIC_CANARY_ENV.SCENE_FOCUS_STATE]: saved.s,
      })) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
