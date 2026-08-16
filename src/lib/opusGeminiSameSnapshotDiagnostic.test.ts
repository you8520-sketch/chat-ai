import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateEstimatedSectionTokens,
  buildLikeScaleSnapshot,
  diagnoseSameSnapshot,
} from "./opusGeminiSameSnapshotDiagnostic";

describe("same-snapshot Opus vs Gemini diagnostic", () => {
  it("receipt section tokens are proportional allocations of draftInput", () => {
    const rows = allocateEstimatedSectionTokens(
      [
        { label: "최근 raw 턴", est: 30_000 },
        { label: "캐릭터 프롬프트", est: 9_000 },
        { label: "시스템 프롬프트 (고정 규칙)", est: 6_000 },
      ],
      53_000
    );
    const raw = rows.find((r) => r.label === "최근 raw 턴");
    const sys = rows.find((r) => r.label === "시스템 프롬프트 (고정 규칙)");
    assert.ok(raw && sys);
    assert.equal(raw.tokens, Math.round((30_000 / 45_000) * 53_000));
    assert.equal(sys.tokens, Math.round((6_000 / 45_000) * 53_000));
    assert.notEqual(sys.tokens, 6_000);
  });

  it("same snapshot: RAW history text is identical; Opus is not 2x larger", () => {
    const report = diagnoseSameSnapshot(buildLikeScaleSnapshot());
    assert.equal(report.opus.payload.historyAssistantChars, report.gemini.payload.historyAssistantChars);
    assert.equal(report.opus.payload.historyUserChars, report.gemini.payload.historyUserChars);
    assert.equal(report.opus.historyMessageCount, report.gemini.historyMessageCount);
    assert.ok(Math.abs(report.physicalDelta.historyChars) < 80);
    assert.ok(
      report.opus.payload.totalChars < report.gemini.payload.totalChars * 1.15,
      `opus ${report.opus.payload.totalChars} vs gemini ${report.gemini.payload.totalChars}`
    );
  });

  it("same snapshot: system/character physical chars are not 1.7x apart", () => {
    const report = diagnoseSameSnapshot(buildLikeScaleSnapshot());
    assert.ok(Math.abs(report.physicalDelta.systemRulesChars) < 800);
    assert.ok(Math.abs(report.physicalDelta.characterSettingsChars) < 200);
    assert.ok(report.sectionDiff.opusOnly.length === 0);
  });

  it("CI fetch body keeps thinking disabled and does not add Claude prefill", () => {
    const report = diagnoseSameSnapshot(buildLikeScaleSnapshot());
    assert.deepEqual(report.opus.thinking, { type: "disabled" });
    assert.deepEqual(report.opus.outputConfig, { effort: "low" });
    assert.equal(report.opus.reasoningEffort, "low");
    assert.equal(report.opus.payload.hasAssistantPrefill, false);
    // CI Opus: 2 system cache blocks + 1 history breakpoint. Gemini keeps system only.
    assert.ok(
      report.opus.payload.cacheControlBlocks >= 3,
      `opus cache blocks ${report.opus.payload.cacheControlBlocks}`
    );
    assert.ok(report.gemini.payload.cacheControlBlocks >= 2);
    assert.ok(report.opus.payload.cacheControlBlocks > report.gemini.payload.cacheControlBlocks);
  });
});
