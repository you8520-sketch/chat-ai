import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearedTrpgImageSceneDiagnostics,
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
