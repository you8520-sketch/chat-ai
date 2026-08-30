import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMsg } from "@/lib/ai";
import { DEFAULT_STATUS_WIDGET } from "@/lib/statusWidget/defaultTemplate";
import { extractStatusWidgetValuesForTurn } from "@/lib/statusWidget/extract";
import { collectWidgetJsonKeys } from "@/lib/statusWidget/prompt";
import { resolveStatusWidgetTurn } from "@/lib/statusWidget/resolve";
import { serializeStatusWidget } from "@/lib/statusWidget/serialize";
import { evaluateSharedEnrichmentBillingAllocationGate } from "@/lib/postTurnEnrichment/billingAllocationGate";
import {
  countAssistantProseInitialReads,
  planCurrentMainPostTurnInitialCalls,
} from "@/lib/postTurnEnrichment/eligibility";
import { buildPostTurnEnrichmentPlan } from "@/lib/postTurnEnrichment/orchestrator";
import type { PostTurnEnrichmentTurnConfig } from "@/lib/postTurnEnrichment/types";

const creatorJson = serializeStatusWidget(DEFAULT_STATUS_WIDGET);
const userJson = serializeStatusWidget({
  ...DEFAULT_STATUS_WIDGET,
  name: "내 커스텀",
  fields: [{ id: "my_note", label: "메모", instruction: "표시용 메모" }],
});

const ASSISTANT =
  "*그는 천천히 고개를 들었다.* \"오늘은 좀 다르게 시작해볼까.\" *잔잔한 미소.*";

function makeSpyCaller(initialResponse: string) {
  const invocations: Array<{ requestKind: string; modelId: string }> = [];
  const caller = async (
    _system: string,
    _history: ChatMsg[],
    opts: { requestKind: string; modelId: string }
  ) => {
    invocations.push({ requestKind: opts.requestKind, modelId: opts.modelId });
    return {
      text: initialResponse,
      usage: {
        inputTokens: 1200,
        outputTokens: 400,
        estimated: false,
        upstreamCostUsd: 0.002,
      },
    };
  };
  return { caller, invocations };
}

describe("billing allocation gate", () => {
  it("BILLING_ALLOCATION_GATE=BLOCKED — no shared-call allocation owner", () => {
    const gate = evaluateSharedEnrichmentBillingAllocationGate();
    assert.equal(gate.status, "BLOCKED");
    assert.match(gate.reason, /user-billed/i);
    assert.ok(gate.options.length >= 2);
  });
});

describe("post-turn call plan — R1–R6 baseline (current main, no coalescing)", () => {
  const base: PostTurnEnrichmentTurnConfig = {
    statusWidgetActive: true,
    needsCharacterWidgetExtract: true,
    needsUserWidgetExtract: true,
    suggestedRepliesEnabled: true,
    statusMetaEnabled: false,
    htmlFlashOnlyTurn: false,
    oocSceneRenderTurn: false,
    hasAssistantProse: true,
  };

  it("R1 T4 creator+user widget + suggestions → 2 assistant-prose initial reads", () => {
    const planned = planCurrentMainPostTurnInitialCalls(base);
    assert.equal(countAssistantProseInitialReads(planned), 2);
    assert.equal(planned[0]?.family, "status_widget_combined_initial");
    assert.equal(planned[1]?.family, "suggested_replies_initial");
  });

  it("R2 widget OFF + suggestions ON → 1 initial read", () => {
    const planned = planCurrentMainPostTurnInitialCalls({
      ...base,
      statusWidgetActive: false,
      needsCharacterWidgetExtract: false,
      needsUserWidgetExtract: false,
    });
    assert.equal(countAssistantProseInitialReads(planned), 1);
    assert.equal(planned[0]?.family, "suggested_replies_initial");
  });

  it("R3 creator widget only + suggestions ON → 2 reads (single widget + suggestions)", () => {
    const planned = planCurrentMainPostTurnInitialCalls({
      ...base,
      needsUserWidgetExtract: false,
    });
    assert.equal(countAssistantProseInitialReads(planned), 2);
    assert.equal(planned[0]?.family, "status_widget_initial");
  });

  it("R5 creator+user widget + suggestions OFF → 1 read", () => {
    const planned = planCurrentMainPostTurnInitialCalls({
      ...base,
      suggestedRepliesEnabled: false,
    });
    assert.equal(countAssistantProseInitialReads(planned), 1);
    assert.equal(planned[0]?.family, "status_widget_combined_initial");
  });

  it("R6 statusMeta adds separate async initial (KEEP separate follow-up)", () => {
    const planned = planCurrentMainPostTurnInitialCalls({
      ...base,
      statusMetaEnabled: true,
    });
    assert.equal(countAssistantProseInitialReads(planned), 3);
    assert.equal(planned[2]?.family, "status_meta_initial");
  });
});

describe("deterministic provider caller spy — BEFORE duplicate graph", () => {
  it("T4 widget combined initial = 1 provider call (suggestions add +1 via separate job owner)", async () => {
    const both = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: userJson,
      chatMode: "both",
      displayMode: "hidden",
    });
    const characterValues: Record<string, string> = {};
    for (const key of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) {
      characterValues[key] = `값-${key}`;
    }
    const widgetSpy = makeSpyCaller(
      JSON.stringify({
        character_values: characterValues,
        user_values: { my_note: "짧은 메모" },
        extracted_facts: [],
      })
    );

    const widgetResult = await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: both,
      caller: widgetSpy.caller,
      primaryModelId: "gpt-5.6-luna",
    });

    assert.equal(widgetResult.meta.extractMode, "dual_combined");
    assert.equal(widgetResult.meta.actualCallCount, 1);
    assert.deepEqual(
      widgetSpy.invocations.map((i) => i.requestKind),
      ["background-status-widget-extract-combined"]
    );

    const planned = planCurrentMainPostTurnInitialCalls({
      statusWidgetActive: true,
      needsCharacterWidgetExtract: true,
      needsUserWidgetExtract: true,
      suggestedRepliesEnabled: true,
      statusMetaEnabled: false,
      htmlFlashOnlyTurn: false,
      oocSceneRenderTurn: false,
      hasAssistantProse: true,
    });
    assert.equal(countAssistantProseInitialReads(planned), 2);
    assert.equal(widgetSpy.invocations.length + 1, 2);
  });

  it("creator-only widget uses single initial not combined", async () => {
    const creatorOnly = resolveStatusWidgetTurn({
      characterWidgetJson: creatorJson,
      userWidgetJson: null,
      chatMode: "character_only",
      displayMode: "creator",
    });
    const characterValues: Record<string, string> = {};
    for (const key of collectWidgetJsonKeys(DEFAULT_STATUS_WIDGET)) {
      characterValues[key] = `값-${key}`;
    }
    const widgetSpy = makeSpyCaller(
      JSON.stringify({
        character_values: characterValues,
        extracted_facts: [],
      })
    );
    await extractStatusWidgetValuesForTurn({
      charName: "레온",
      personaName: "렌",
      userMessage: "안녕",
      assistantProse: ASSISTANT,
      resolved: creatorOnly,
      caller: widgetSpy.caller,
      primaryModelId: "gpt-5.6-luna",
    });
    assert.equal(widgetSpy.invocations[0]?.requestKind, "background-status-widget-extract");
    assert.ok(
      !widgetSpy.invocations.some((i) => i.requestKind === "background-status-widget-extract-combined")
    );
  });
});

describe("orchestrator stub — shared initial NOT implemented while gate blocked", () => {
  it("SHARED_INITIAL_IMPLEMENTED=false", () => {
    const plan = buildPostTurnEnrichmentPlan({
      statusWidgetActive: true,
      needsCharacterWidgetExtract: true,
      needsUserWidgetExtract: true,
      suggestedRepliesEnabled: true,
      statusMetaEnabled: false,
      htmlFlashOnlyTurn: false,
      oocSceneRenderTurn: false,
      hasAssistantProse: true,
    });
    assert.equal(plan.gate.status, "BLOCKED");
    assert.equal(plan.sharedInitialImplemented, false);
    assert.equal(countAssistantProseInitialReads(plan.baselineInitialCalls), 2);
  });
});
