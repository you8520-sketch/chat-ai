/**
 * Re-score saved layout A/B outputs without live CI calls.
 * node --conditions=react-server --import tsx scripts/gemini31-layout-ab-rescore.ts
 */
import fs from "node:fs";
import path from "node:path";

import { visibleAssistantDisplayCharCount } from "../src/lib/chatDisplayLength";
import { computeLayoutAbParagraphMetrics } from "../src/lib/gemini31LayoutAbMetrics";
import {
  aggregateFixtureVerdict,
  isGradedFixtureVerdict,
  scoreLayoutAbQualityRubric,
  type FixtureVerdict,
  type LayoutAbQualityRubric,
} from "../src/lib/gemini31LayoutAbRubric";

const OUT_DIR = path.join(process.cwd(), "docs/audits/gemini31-layout-owner-live-ab");
const FIXTURES = ["Q1", "Q2", "Q3", "Q4"] as const;
type FixtureId = (typeof FIXTURES)[number];

type RunRecord = {
  fixtureId: FixtureId;
  variant: "A" | "B";
  runIndex: number;
  visibleChars: number;
  visibleTokens: number | null;
  layoutMetrics: ReturnType<typeof computeLayoutAbParagraphMetrics>;
  providerPromptTokens: number | null;
  cachedTokens: number | null;
  cacheRatio: number | null;
  ttftMs: number | null;
  totalMs: number | null;
  costUsd: number | null;
  textPreview: string;
  qualityArtifactAvailable: boolean;
  performanceMetadataAvailable: boolean;
};

function loadText(fixtureId: string, variant: "A" | "B", runIndex: number): string | null {
  const p = path.join(OUT_DIR, `${fixtureId}-${variant}-run${runIndex}.txt`);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}

function loadMeta(fixtureId: string, variant: "A" | "B", runIndex: number): Partial<RunRecord> | null {
  const p = path.join(OUT_DIR, `${fixtureId}-${variant}-run${runIndex}.meta.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RunRecord>;
}

function hasPerformanceMetadata(meta: Partial<RunRecord> | null): boolean {
  if (!meta) return false;
  return (
    typeof meta.providerPromptTokens === "number" &&
    meta.providerPromptTokens > 0 &&
    typeof meta.totalMs === "number" &&
    meta.totalMs > 0
  );
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function buildRun(
  fixtureId: FixtureId,
  variant: "A" | "B",
  runIndex: number,
  text: string,
  meta: Partial<RunRecord> | null
): RunRecord {
  const perfOk = hasPerformanceMetadata(meta);
  return {
    fixtureId,
    variant,
    runIndex,
    visibleChars: visibleAssistantDisplayCharCount(text),
    visibleTokens: perfOk ? (meta?.visibleTokens ?? null) : null,
    layoutMetrics: computeLayoutAbParagraphMetrics(text),
    providerPromptTokens: perfOk ? (meta?.providerPromptTokens ?? null) : null,
    cachedTokens: perfOk ? (meta?.cachedTokens ?? null) : null,
    cacheRatio: perfOk ? (meta?.cacheRatio ?? null) : null,
    ttftMs: perfOk ? (meta?.ttftMs ?? null) : null,
    totalMs: perfOk ? (meta?.totalMs ?? null) : null,
    costUsd: perfOk ? (meta?.costUsd ?? null) : null,
    textPreview: text.slice(0, 500),
    qualityArtifactAvailable: true,
    performanceMetadataAvailable: perfOk,
  };
}

const runs: RunRecord[] = [];
const rubricsByFixture: Record<FixtureId, LayoutAbQualityRubric[]> = {
  Q1: [],
  Q2: [],
  Q3: [],
  Q4: [],
};

for (const fixtureId of FIXTURES) {
  for (let runIndex = 1; runIndex <= 3; runIndex++) {
    const textA = loadText(fixtureId, "A", runIndex);
    const textB = loadText(fixtureId, "B", runIndex);
    if (!textA || !textB) continue;
    const runA = buildRun(fixtureId, "A", runIndex, textA, loadMeta(fixtureId, "A", runIndex));
    const runB = buildRun(fixtureId, "B", runIndex, textB, loadMeta(fixtureId, "B", runIndex));
    runs.push(runA, runB);
    rubricsByFixture[fixtureId].push(
      scoreLayoutAbQualityRubric({
        fixtureId,
        metricsA: runA.layoutMetrics,
        metricsB: runB.layoutMetrics,
        visibleCharsA: runA.visibleChars,
        visibleCharsB: runB.visibleChars,
        metaLeakB: /\[SYSTEM|as an AI|language model/i.test(runB.textPreview),
      })
    );
  }
}

const fixtureVerdicts: Record<FixtureId, FixtureVerdict> = {
  Q1: rubricsByFixture.Q1.length ? aggregateFixtureVerdict(rubricsByFixture.Q1) : "INCOMPLETE",
  Q2: rubricsByFixture.Q2.length ? aggregateFixtureVerdict(rubricsByFixture.Q2) : "INCOMPLETE",
  Q3: rubricsByFixture.Q3.length ? aggregateFixtureVerdict(rubricsByFixture.Q3) : "INCOMPLETE",
  Q4: rubricsByFixture.Q4.length ? aggregateFixtureVerdict(rubricsByFixture.Q4) : "INCOMPLETE",
};

const gradedFixtures = FIXTURES.filter((id) => isGradedFixtureVerdict(fixtureVerdicts[id]));
const allRequiredGraded = gradedFixtures.length === 4;
const allPass = allRequiredGraded && gradedFixtures.every((id) => fixtureVerdicts[id] === "PASS");
const anyFail = gradedFixtures.some((id) => fixtureVerdicts[id] === "FAIL");

let mergeCase: "A" | "B" | "C";
if (!allRequiredGraded) {
  mergeCase = "C";
} else if (allPass) {
  mergeCase = "A";
} else if (anyFail) {
  mergeCase = "C";
} else {
  mergeCase = "B";
}

const perfRuns = runs.filter((r) => r.performanceMetadataAvailable);

const report = {
  GEMINI31_LAYOUT_OWNER_LIVE_AB_RESCORE: {
    generatedAt: new Date().toISOString(),
    rescoreOnly: true,
    OLD_MERGE_CASE_NOTE: "Prior report may contain synthetic-zero performance rows",
    fixtureVerdicts,
    mergeCase,
    QUALITY_SAMPLE_N: runs.length,
    PERFORMANCE_SAMPLE_N: perfRuns.length,
    MISSING_METADATA_N: runs.filter((r) => !r.performanceMetadataAvailable).length,
    rubricsByFixture,
    runs,
  },
};

fs.writeFileSync(path.join(OUT_DIR, "report-rescore.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
