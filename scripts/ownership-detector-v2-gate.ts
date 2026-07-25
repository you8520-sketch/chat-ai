/**
 * Offline quality gate for ownership shadow detector v2.
 * No model/API calls.
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { detectOwnershipShadowV2 } from "../src/lib/ownershipShadowDetectorV2";
import {
  OWNERSHIP_SHADOW_ALL_FIXTURES,
  OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS,
  OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS,
} from "../src/lib/ownershipShadowDetectorV2.fixture";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORPUS_PATH = path.join(ROOT, "data/_tmp-ownership-detector-v2-corpus.json");
const REPORT_PATH = path.join(ROOT, "data/_tmp-ownership-detector-v2-gate-report.json");

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function runGate() {
  const hardTruePositives: string[] = [];
  const hardFalseNegatives: string[] = [];
  const hardFalsePositives: string[] = [];
  const softFindings: string[] = [];
  const safeCarveOuts: string[] = [];

  for (const entry of OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS) {
    const result = detectOwnershipShadowV2(entry.text, {
      mode: "interactive",
      userAliases: [entry.userAlias ?? "렌"],
      actorNames: entry.actorNames,
    });
    if (result.hardCount > 0) hardTruePositives.push(entry.text);
    else hardFalseNegatives.push(entry.text);
  }

  for (const entry of OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS) {
    const result = detectOwnershipShadowV2(entry.text, {
      mode: "interactive",
      userAliases: [entry.userAlias ?? "렌"],
      actorNames: entry.actorNames,
    });
    if (result.hardCount > 0) hardFalsePositives.push(entry.text);
    if (result.safeCarveOutCount > 0) safeCarveOuts.push(entry.text);
  }

  for (const entry of OWNERSHIP_SHADOW_ALL_FIXTURES.filter((f) => f.expectedSeverity === "SOFT")) {
    const result = detectOwnershipShadowV2(entry.text, {
      mode: "interactive",
      userAliases: [entry.userAlias ?? "렌", "[B]", "{{user}}"],
      actorNames: entry.actorNames,
    });
    if (result.softCount > 0) softFindings.push(entry.text);
  }

  const corpusTexts: string[] = [];
  if (fs.existsSync(CORPUS_PATH)) {
    const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8")) as {
      entries?: Array<{ text?: string }>;
    };
    for (const e of corpus.entries ?? []) {
      if (e.text) corpusTexts.push(e.text);
    }
  } else {
    corpusTexts.push(
      ...OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS.map((e) => e.text),
      ...OWNERSHIP_SHADOW_KNOWN_SAFE_INTERACTIONS.map((e) => e.text)
    );
  }

  const runtimes: number[] = [];
  for (const text of corpusTexts) {
    const started = performance.now();
    detectOwnershipShadowV2(text, {
      mode: "interactive",
      userAliases: ["렌", "[B]", "{{user}}"],
      actorNames: ["에녹", "이준서", "카일"],
    });
    runtimes.push(performance.now() - started);
  }

  const tp = hardTruePositives.length;
  const fn = hardFalseNegatives.length;
  const fp = hardFalsePositives.length;
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  const report = {
    version: "v2.0.0",
    generatedAt: new Date().toISOString(),
    corpusSampleCount: corpusTexts.length,
    knownHardViolationCount: OWNERSHIP_SHADOW_KNOWN_HARD_VIOLATIONS.length,
    hardTruePositives: tp,
    hardFalseNegatives: fn,
    hardFalsePositives: fp,
    hardFalseNegativeSentences: hardFalseNegatives,
    hardFalsePositiveSentences: hardFalsePositives,
    softFindings,
    safeCarveOuts,
    precision,
    recall,
    f1,
    runtimeMs: {
      p50: percentile(runtimes, 50),
      p95: percentile(runtimes, 95),
      max: runtimes.length ? Math.max(...runtimes) : 0,
    },
    verdict:
      fn === 0 && fp === 0
        ? "A. SHADOW DETECTOR V2 READY FOR REVIEW"
        : fn > 0
          ? "B. DETECTOR RECALL GAPS"
          : "C. DETECTOR FALSE-POSITIVE BLOCKER",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

runGate();
