/**
 * Dialogue Rhythm — layer responsibility audit (read-only).
 * Maps prompt layers to rhythm metrics on production samples; recommends SoT.
 *
 * Usage: npx tsx scripts/audit-dialogue-rhythm-responsibility.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  analyzeDialogueRhythm,
  dialogueRhythmScore,
} from "./lib/dialogue-rhythm-metrics";
import {
  METRIC_LABEL,
  buildLayerInventories,
  buildResponsibilityMatrix,
  recommendDialogueRhythmSoT,
  type RhythmMetricKey,
} from "./lib/dialogue-rhythm-layer-inventory";
import { collectStyleAuditSamples } from "./lib/collect-style-audit-samples";

const AUDIT_JSON = join(process.cwd(), "output", "webnovel-style-production-audit.json");

type SampleRow = {
  sampleId?: string;
  messageId: number;
  text?: string;
  dimensionScores?: { dimension: string; score: number }[];
};

function loadSampleTexts(): { id: string; messageId: number; text: string }[] {
  if (existsSync(AUDIT_JSON)) {
    const data = JSON.parse(readFileSync(AUDIT_JSON, "utf8")) as {
      samples: SampleRow[];
    };
    const fromAudit = data.samples
      .filter((s) => (s as { raw?: unknown }).raw || s.dimensionScores)
      .map((s, i) => {
        const full = data.samples[i] as SampleRow & { raw?: unknown };
        return {
          id: s.sampleId ?? `audit-${s.messageId}`,
          messageId: s.messageId,
          text: "", // need full text from pairs - audit json has raw but not text in compact form
        };
      });
    void fromAudit;
  }

  const { samples } = collectStyleAuditSamples({ target: 60 });
  return samples.map((s) => ({
    id: s.id,
    messageId: s.messageId ?? 0,
    text: s.text,
  }));
}

function corpusStats(values: number[]): { mean: number; median: number; p90: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  return {
    mean: Math.round(mean * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    p90: Math.round(p90 * 1000) / 1000,
  };
}

function main() {
  const samples = loadSampleTexts();
  const inventories = buildLayerInventories();
  const matrix = buildResponsibilityMatrix(inventories);
  const sot = recommendDialogueRhythmSoT(inventories);

  const analyzed = samples.map((s) => {
    const m = analyzeDialogueRhythm(s.text);
    const score = dialogueRhythmScore(m);
    return { ...s, metrics: m, rhythmScore: score };
  });

  analyzed.sort((a, b) => a.rhythmScore - b.rhythmScore);

  const metricCorpus = {
    rhythmScore: corpusStats(analyzed.map((a) => a.rhythmScore)),
    alternationScore: corpusStats(analyzed.map((a) => a.metrics.alternationScore)),
    maxConsecutiveNarration: corpusStats(
      analyzed.map((a) => a.metrics.maxConsecutiveNarrationBlocks)
    ),
    dialogueCharShare: corpusStats(analyzed.map((a) => a.metrics.dialogueCharShare)),
    meanDialogueQuoteChars: corpusStats(analyzed.map((a) => a.metrics.meanDialogueQuoteChars)),
    inlineDialogueWithoutQuotes: corpusStats(
      analyzed.map((a) => a.metrics.inlineDialogueWithoutQuotes)
    ),
    narrationWallRate:
      analyzed.filter((a) => a.metrics.narrationWall).length / (analyzed.length || 1),
    zeroQuoteRate:
      analyzed.filter((a) => a.metrics.dialogueQuoteCount === 0).length / (analyzed.length || 1),
  };

  const worst5 = analyzed.slice(0, 5).map((a) => ({
    sampleId: a.id,
    messageId: a.messageId,
    rhythmScore: a.rhythmScore,
    metrics: a.metrics,
    excerpt: a.text.replace(/\s+/g, " ").slice(0, 280),
  }));

  const layerBlame = {
    lengthControl: {
      narrationWallAmongWorst5: worst5.filter((w) => w.metrics.maxConsecutiveNarrationBlocks >= 6)
        .length,
      avgNarrGapWorst5:
        worst5.reduce((s, w) => s + w.metrics.meanNarrationGapBetweenDialogue, 0) / (worst5.length || 1),
    },
    outputLayout: {
      inlineWithoutQuotesWorst5: worst5.reduce(
        (s, w) => s + w.metrics.inlineDialogueWithoutQuotes,
        0
      ),
      zeroQuoteWorst5: worst5.filter((w) => w.metrics.dialogueQuoteCount === 0).length,
    },
    turnHandoff: {
      longTurnNoDialogue: analyzed.filter(
        (a) => a.text.length > 2500 && a.metrics.dialogueQuoteCount <= 2
      ).length,
    },
  };

  const bottleneckLayers = [
    {
      layer: "lengthControl",
      label: "LENGTH CONTROL + NARRATIVE DENSITY + MOMENT-TO-MOMENT",
      evidence: `${(metricCorpus.narrationWallRate * 100).toFixed(0)}% narration wall; worst5 avg narration gap ${layerBlame.lengthControl.avgNarrGapWorst5.toFixed(1)} blocks`,
      impact: "high",
    },
    {
      layer: "outputLayout + dialogueNarration",
      label: "OUTPUT LAYOUT / DIALOGUE & NARRATION (format gap)",
      evidence: `${(metricCorpus.zeroQuoteRate * 100).toFixed(0)}% turns with zero \" quotes; inline speech ${metricCorpus.inlineDialogueWithoutQuotes.mean.toFixed(1)}/turn avg`,
      impact: "high",
    },
    {
      layer: "turnHandoff",
      label: "TURN HANDOFF",
      evidence: `${layerBlame.turnHandoff.longTurnNoDialogue} long turns (2500+ chars) with ≤2 quoted lines`,
      impact: "medium",
    },
    {
      layer: "fewShot",
      label: "Few-shot",
      evidence: "Platform fallback OFF — most turns lack alternation anchor",
      impact: "medium-low",
    },
    {
      layer: "proseStyle",
      label: "PROSE STYLE [RHYTHM]",
      evidence: "Within-narration only; defers dialogue rhythm — not root cause",
      impact: "low",
    },
  ];

  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });

  const result = {
    audit: "dialogue-rhythm-responsibility",
    step: "Step 2 incremental — audit only (no rule/production changes)",
    sampleCount: analyzed.length,
    referenceDialogueRhythmMean: 5.1,
    corpusMetrics: metricCorpus,
    layerInventories: inventories.map((i) => ({
      id: i.id,
      label: i.label,
      sourceFile: i.sourceFile,
      trackedSectionId: i.trackedSectionId,
      charCount: i.charCount,
      clauses: i.clauses,
    })),
    responsibilityMatrix: matrix,
    empiricalLayerBlame: layerBlame,
    bottleneckLayers,
    worstSamples: worst5,
    sotRecommendation: sot,
    step2FollowUp: {
      primaryTarget: "Expand [DIALOGUE & NARRATION] as semantic rhythm SoT",
      secondaryCoordination: "LENGTH + TURN HANDOFF must defer beat alternation to DNR",
      formatEnforcement: "[OUTPUT LAYOUT] stays mechanical \" + paragraph SoT",
      doNotChangeYet: ["hand/touch", "PROSE STYLE [RHYTHM] sentence craft"],
    },
  };

  const jsonPath = join(outDir, "dialogue-rhythm-responsibility-audit.json");
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf8");

  const txtLines = [
    "Dialogue Rhythm — Layer Responsibility Audit",
    "=".repeat(72),
    `Samples: ${analyzed.length} | rhythm score mean ${metricCorpus.rhythmScore.mean}/10 (style audit ref 5.1)`,
    "",
    "── Corpus metrics ──",
    `  alternation mean: ${metricCorpus.alternationScore.mean}`,
    `  max consecutive narration (mean/p90): ${metricCorpus.maxConsecutiveNarration.mean} / ${metricCorpus.maxConsecutiveNarration.p90}`,
    `  dialogue char share mean: ${(metricCorpus.dialogueCharShare.mean * 100).toFixed(1)}%`,
    `  narration wall rate: ${(metricCorpus.narrationWallRate * 100).toFixed(0)}%`,
    `  zero \" quote rate: ${(metricCorpus.zeroQuoteRate * 100).toFixed(0)}%`,
    `  inline dialogue without quotes (mean): ${metricCorpus.inlineDialogueWithoutQuotes.mean}`,
    "",
    "── Layer → metric responsibility (summary) ──",
  ];

  for (const inv of inventories) {
    txtLines.push(`\n[${inv.label}] ${inv.sourceFile}`);
    for (const metric of Object.keys(METRIC_LABEL) as RhythmMetricKey[]) {
      const cell = matrix.find((c) => c.layer === inv.id && c.metric === metric);
      txtLines.push(`  ${METRIC_LABEL[metric]}: ${cell?.influence ?? "?"} — ${cell?.summary.slice(0, 70)}`);
    }
  }

  txtLines.push(
    "",
    "── Empirical root cause (production samples) ──",
    `1. LENGTH+MOMENT-TO-MOMENT: ${(metricCorpus.narrationWallRate * 100).toFixed(0)}% narration wall`,
    `2. Format gap: ${(metricCorpus.zeroQuoteRate * 100).toFixed(0)}% turns lack \" dialogue blocks (speech embedded in narration)`,
    `3. TURN HANDOFF: ${layerBlame.turnHandoff.longTurnNoDialogue} long turns with ≤2 quotes`,
    "",
    "── SoT Recommendation ──",
    `Semantic rhythm SoT → ${sot.semanticRhythmSoT}`,
    `Format SoT → ${sot.formatSoT}`,
    "Must defer:",
    ...sot.mustDefer.map((d) => `  • ${d}`),
    "",
    "Gaps (no owner today):",
    ...sot.gaps.map((g) => `  • ${g}`),
    "",
    "── Worst sample excerpts ──"
  );
  for (const w of worst5) {
    txtLines.push(
      `\n#${w.sampleId} score=${w.rhythmScore} quotes=${w.metrics.dialogueQuoteCount} maxNar=${w.metrics.maxConsecutiveNarrationBlocks}`,
      w.excerpt + "…"
    );
  }

  const txtPath = join(outDir, "dialogue-rhythm-responsibility-summary.txt");
  writeFileSync(txtPath, txtLines.join("\n"), "utf8");

  console.log("=== Dialogue Rhythm Responsibility Audit ===");
  console.log(`Samples: ${analyzed.length}`);
  console.log(`Rhythm score mean: ${metricCorpus.rhythmScore.mean}/10`);
  console.log(`Narration wall: ${(metricCorpus.narrationWallRate * 100).toFixed(0)}% | Zero quotes: ${(metricCorpus.zeroQuoteRate * 100).toFixed(0)}%`);
  console.log(`\nSoT → Semantic: ${sot.semanticRhythmSoT}`);
  console.log(`    Format: ${sot.formatSoT}`);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${txtPath}`);
}

main();
