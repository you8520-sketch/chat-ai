import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRemovalStageRecord,
  buildRemovalTraceReport,
  diffRemovedRegions,
  formatRemovalTraceLog,
  RemovalTraceCollector,
} from "@/lib/removalTrace";

describe("removalTrace", () => {
  it("diffRemovedRegions finds exact removed tail", () => {
    const before = "RP 본문입니다." + "X".repeat(100);
    const after = "RP 본문입니다.";
    const { regions, removedChars } = diffRemovedRegions(before, after);
    assert.equal(removedChars, 100);
    assert.equal(regions[0]!.text, "X".repeat(100));
  });

  it("buildRemovalStageRecord includes removed snippet", () => {
    const before = "앞글자" + "REMOVED" + "뒤글자";
    const after = "앞글자뒤글자";
    const rec = buildRemovalStageRecord("test", before, after, "unit test");
    assert.ok(rec);
    assert.equal(rec!.removedChars, 7);
    assert.equal(rec!.removedText, "REMOVED");
  });

  it("collector tracks dominant culprit", () => {
    const c = new RemovalTraceCollector();
    c.setRawModelText("aaaaBBBBcccc");
    c.record("big", "aaaaBBBBcccc", "aaaa", "removed BBBBcccc");
    c.record("small", "aaaa", "aaa", "removed one a");
    c.setFinalSavedText("aaa");
    const report = c.build();
    assert.equal(report.dominantCulprit, "big");
    assert.equal(report.finalLossChars, 9);
  });

  it("buildRemovalTraceReport records chronological stages without hypothetical probes", () => {
    const raw = "model delivered text with STATUS junk";
    const report = buildRemovalTraceReport({
      rawModelText: raw,
      rawModelTextReason: "baseline test",
      preRouteSteps: [
        {
          stage: "openRouter_stripRpMetaLeakage",
          before: raw + " meta",
          after: raw,
          reason: "strip meta",
        },
      ],
      steps: [
        {
          stage: "partitionModelStatusArtifacts",
          before: raw,
          after: "model delivered text",
          reason: "strip status",
        },
        {
          stage: "stripEmotionTagsForDisplay",
          before: "model delivered text",
          after: "model delivered text",
          reason: "no tags",
        },
      ],
      finalSavedText: "model delivered text",
    });
    assert.equal(report.stages[0]!.stage, "openRouter_stripRpMetaLeakage");
    assert.equal(report.stages[1]!.stage, "raw_model_text");
    assert.equal(report.stages[1]!.removedChars, 0);
    assert.equal(report.stages[2]!.stage, "partitionModelStatusArtifacts");
    assert.ok(!report.stages.some((s) => s.stage === "sanitizeRepeatedEnding"));
    assert.ok(!report.stages.some((s) => s.stage === "removeLoopTail"));
    assert.equal(report.finalLossChars, raw.length - "model delivered text".length);
  });

  it("formatRemovalTraceLog truncates long removed_text by default", () => {
    const removed = "X".repeat(5000);
    const report = buildRemovalTraceReport({
      rawModelText: "start" + removed,
      rawModelTextReason: "baseline",
      steps: [
        {
          stage: "test_stage",
          before: "start" + removed,
          after: "start",
          reason: "test",
        },
      ],
      finalSavedText: "start",
    });
    const log = formatRemovalTraceLog(report);
    assert.ok(log.includes("[REMOVAL TRACE]"));
    assert.ok(log.includes("removed_text_truncated"));
    assert.ok(!log.includes("X".repeat(5000)));
  });
});
