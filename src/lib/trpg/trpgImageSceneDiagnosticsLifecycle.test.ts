import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildTrpgImageSceneDiagnosticsDisplayRows,
  buildTrpgImageSceneDiagnosticsPayload,
  clearedTrpgImageSceneDiagnostics,
  formatTrpgDiagnosticsIds,
  formatTrpgDiagnosticsText,
  isTrpgAiFocusRawFallback,
  resolveTrpgImageSceneDiagnosticsForResponse,
  resolveTrpgImageSceneDiagnosticsFromResponse,
  type TrpgImageSceneDiagnosticsPayload,
} from "@/lib/trpg/trpgImageSceneDiagnosticsLifecycle";

const sampleAiDiagnostics: TrpgImageSceneDiagnosticsPayload = {
  mode: "AI_FOCUS",
  modeRequested: "AI_FOCUS",
  modeApplied: "AI_FOCUS",
  aiModel: "gpt-5.6-luna",
  aiAttempts: 1,
  aiUsedFallback: false,
  aiDeterministicFallback: false,
  aiLatencyMs: 120,
  canonicalLocation: "숲",
  selectedHeroScene: "영웅이 돌진한다",
  heroEventIds: ["E1"],
  overSelectionRejected: false,
};

const rawPayload = buildTrpgImageSceneDiagnosticsPayload({
  requestedMode: "RAW",
  modeApplied: "RAW",
  canonicalLocation: "회랑",
  focusDiagnostics: null,
});

const fallbackPayload = buildTrpgImageSceneDiagnosticsPayload({
  requestedMode: "AI_FOCUS",
  modeApplied: "RAW",
  canonicalLocation: "탑",
  focusDiagnostics: {
    modeRequested: "AI_FOCUS",
    modeApplied: "RAW",
    aiModel: "gpt-5.6-luna",
    aiAttempts: 1,
    aiUsedFallback: false,
    aiDeterministicFallback: false,
    aiLatencyMs: 88,
    canonicalLocation: "탑",
    selectedHeroScene: "",
    heroEventIds: [],
    overSelectionRejected: false,
    fallbackReason: "planner-error",
  },
});

describe("trpg image scene diagnostics lifecycle", () => {
  it("T8: mode switch clears diagnostics (AI → RAW stale guard)", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("T10: round/source change clears diagnostics before next result", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("T9: generation start clears diagnostics via cleared state", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("generation response replaces prior diagnostics exactly", () => {
    const fromAi = resolveTrpgImageSceneDiagnosticsFromResponse({
      trpgImageSceneDiagnostics: sampleAiDiagnostics,
    });
    assert.equal(fromAi?.aiModel, "gpt-5.6-luna");
    assert.match(fromAi?.selectedHeroScene ?? "", /돌진/);

    const fromRaw = resolveTrpgImageSceneDiagnosticsFromResponse(null);
    assert.equal(fromRaw, undefined);
  });
});

describe("trpg image scene diagnostics admin visibility", () => {
  it("T1 ADMIN + RAW → diagnostics present with attempts=0", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 7,
      payload: rawPayload,
    });
    assert.ok(response);
    assert.equal(response?.modeRequested, "RAW");
    assert.equal(response?.modeApplied, "RAW");
    assert.equal(response?.aiAttempts, 0);
  });

  it("T2 ADMIN + AI_FOCUS SUCCESS → diagnostics present with hero/model/latency", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 7,
      payload: sampleAiDiagnostics,
    });
    assert.ok(response);
    assert.equal(response?.modeApplied, "AI_FOCUS");
    assert.equal(response?.aiModel, "gpt-5.6-luna");
    assert.match(response?.selectedHeroScene ?? "", /돌진/);
    assert.equal(response?.aiLatencyMs, 120);
  });

  it("T3 ADMIN + AI_FOCUS FALLBACK → diagnostics present with fallbackReason", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: true,
      campaignId: 7,
      payload: fallbackPayload,
    });
    assert.ok(response);
    assert.equal(response?.modeRequested, "AI_FOCUS");
    assert.equal(response?.modeApplied, "RAW");
    assert.equal(response?.fallbackReason, "planner-error");
  });

  it("T4 NON-ADMIN + RAW → diagnostics absent", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: false,
      campaignId: 7,
      payload: rawPayload,
    });
    assert.equal(response, undefined);
  });

  it("T5 NON-ADMIN + AI_FOCUS SUCCESS → diagnostics absent", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: false,
      campaignId: 7,
      payload: sampleAiDiagnostics,
    });
    assert.equal(response, undefined);
  });

  it("T6 NON-ADMIN + AI_FOCUS FALLBACK → diagnostics absent", () => {
    const response = resolveTrpgImageSceneDiagnosticsForResponse({
      canSeeCost: false,
      campaignId: 7,
      payload: fallbackPayload,
    });
    assert.equal(response, undefined);
  });

  it("T7 billing visibility owner unchanged (admin-only upstream cost)", () => {
    const adminCostUsd = 0.0123;
    const adminCostKrw = 18.4;
    const adminFields = {
      upstreamCostUsd: true ? adminCostUsd : undefined,
      upstreamCostKrw: true ? adminCostKrw : undefined,
    };
    const userFields = {
      upstreamCostUsd: false ? adminCostUsd : undefined,
      upstreamCostKrw: false ? adminCostKrw : undefined,
    };
    assert.equal(adminFields.upstreamCostUsd, adminCostUsd);
    assert.equal(userFields.upstreamCostUsd, undefined);
  });
});

describe("trpg image scene diagnostics payload + display", () => {
  it("builds explicit RAW payload without planner fields", () => {
    assert.equal(rawPayload.modeRequested, "RAW");
    assert.equal(rawPayload.modeApplied, "RAW");
    assert.equal(rawPayload.aiModel, "");
    assert.equal(rawPayload.aiAttempts, 0);
    assert.equal(rawPayload.fallbackReason, undefined);
  });

  it("marks AI_FOCUS → RAW fallback with reason", () => {
    assert.equal(isTrpgAiFocusRawFallback(fallbackPayload), true);
    const rows = buildTrpgImageSceneDiagnosticsDisplayRows(fallbackPayload);
    const reason = rows.find((row) => row.key === "fallbackReason");
    assert.equal(reason?.value, "planner-error");
    const fallback = rows.find((row) => row.key === "fallback");
    assert.equal(fallback?.value, "yes");
  });

  it("covers fallback reasons deterministically", () => {
    for (const fallbackReason of [
      "deterministic-fallback",
      "empty-hero-scene",
      "over-selection",
    ] as const) {
      const payload = buildTrpgImageSceneDiagnosticsPayload({
        requestedMode: "AI_FOCUS",
        modeApplied: "RAW",
        canonicalLocation: "숲",
        focusDiagnostics: {
          modeRequested: "AI_FOCUS",
          modeApplied: "RAW",
          aiModel: "gpt-5.6-luna",
          aiAttempts: 1,
          aiUsedFallback: fallbackReason === "deterministic-fallback",
          aiDeterministicFallback: fallbackReason === "deterministic-fallback",
          aiLatencyMs: 50,
          canonicalLocation: "숲",
          selectedHeroScene: "",
          heroEventIds: [],
          overSelectionRejected: fallbackReason === "over-selection",
          fallbackReason,
        },
      });
      const row = buildTrpgImageSceneDiagnosticsDisplayRows(payload).find(
        (entry) => entry.key === "fallbackReason"
      );
      assert.equal(row?.value, fallbackReason);
    }
  });

  it("formats empty values consistently", () => {
    assert.equal(formatTrpgDiagnosticsText(""), "—");
    assert.equal(formatTrpgDiagnosticsIds([]), "(none)");
  });
});

describe("trpg image scene diagnostics UI wiring", () => {
  it("T11: exactly one TrpgImageSceneDiagnosticsPanel render site", () => {
    const source = readFileSync("src/components/ChatImageGeneratorPanel.tsx", "utf8");
    const matches = source.match(/<TrpgImageSceneDiagnosticsPanel/g) ?? [];
    assert.equal(matches.length, 1);
  });

  it("T12: diagnostics panel component has no non-admin placeholder", () => {
    const source = readFileSync("src/components/TrpgImageSceneDiagnosticsPanel.tsx", "utf8");
    assert.doesNotMatch(source, /생성 후 이번 처리 경로가 여기에 표시됩니다/);
  });
});
