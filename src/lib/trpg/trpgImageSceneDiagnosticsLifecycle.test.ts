import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTrpgImageSceneDiagnosticsDisplayRows,
  buildTrpgImageSceneDiagnosticsPayload,
  clearedTrpgImageSceneDiagnostics,
  formatTrpgDiagnosticsIds,
  formatTrpgDiagnosticsText,
  isTrpgAiFocusRawFallback,
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

describe("trpg image scene diagnostics lifecycle", () => {
  it("mode or source change clears diagnostics (AI → RAW stale guard)", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("round A → round B opens with cleared diagnostics before B result", () => {
    assert.equal(clearedTrpgImageSceneDiagnostics(), undefined);
  });

  it("RAW generation response without diagnostics does not retain AI fields", () => {
    const next = resolveTrpgImageSceneDiagnosticsFromResponse({});
    assert.equal(next, undefined);
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

describe("trpg image scene diagnostics payload + display", () => {
  it("builds explicit RAW payload without planner fields", () => {
    const payload = buildTrpgImageSceneDiagnosticsPayload({
      requestedMode: "RAW",
      modeApplied: "RAW",
      canonicalLocation: "회랑",
      focusDiagnostics: null,
    });
    assert.equal(payload.modeRequested, "RAW");
    assert.equal(payload.modeApplied, "RAW");
    assert.equal(payload.aiModel, "");
    assert.equal(payload.aiAttempts, 0);
    assert.equal(payload.fallbackReason, undefined);
  });

  it("marks AI_FOCUS → RAW fallback with reason", () => {
    const payload = buildTrpgImageSceneDiagnosticsPayload({
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
    assert.equal(isTrpgAiFocusRawFallback(payload), true);
    const rows = buildTrpgImageSceneDiagnosticsDisplayRows(payload);
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
