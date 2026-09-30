import type { CycleReport } from "@/lib/memoryResearch/cycle";
import { renderBaselineTrendMarkdown } from "@/lib/memoryResearch/baselineTrend";
import { renderBenchmarkHarnessFeasibilityMarkdown } from "@/lib/memoryResearch/benchmarkHarnessFeasibility";
import { renderBenchmarkCasePortPlansMarkdown } from "@/lib/memoryResearch/benchmarkCasePortPlanner";
import { renderBenchmarkAdoptionMarkdown } from "@/lib/memoryResearch/benchmarkAdoptionBridge";
import { renderCompanionExperimentBridgeMarkdown } from "@/lib/memoryResearch/companionExperimentBridge";

/** Human-readable cycle summary (the JSON report stays the source of truth). */
export function renderCycleReportMarkdown(report: CycleReport): string {
  const c = report.counts;
  const lines = [
    `# Memory research cycle ${report.cycleKey}`,
    "",
    `- status: ${report.status}`,
    `- mode: ${report.mode}`,
    `- main: \`${report.mainSha}\``,
    `- architecture fingerprint: \`${report.architectureFingerprint}\``,
    `- started/finished: ${report.startedAt} / ${report.finishedAt}`,
    "",
    "## Counts",
    "",
    "| sources checked | sources failed | observations | new | skipped duplicates | evaluated | WATCH | REJECT | BENCHMARKED | ACCEPT | Draft PR packets |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    `| ${c.sourcesChecked} | ${c.sourcesFailed} | ${c.observations} | ${c.newCandidates} | ${c.skippedDuplicates} | ${c.evaluated} | ${c.watch} | ${c.reject} | ${c.benchmarked} | ${c.accept} | ${c.draftPrPackets} |`,
    "",
    "## Calls / cost",
    "",
    `- HTTP calls (sources): ${report.providerCalls.httpCalls} / budget ${report.providerCalls.httpBudget}`,
    `- paid provider calls: ${report.providerCalls.paidProviderCalls} / budget ${report.providerCalls.paidProviderCallBudget}`,
    `- estimated cost: $${report.estimatedCostUsd.toFixed(2)}`,
    "",
    "## Sources",
    "",
    ...report.sources.map(
      (s) => `- ${s.sourceId}: ${s.observations} observation(s)${s.failed ? " — FAILED" : ""}${s.errors.length > 0 ? ` — errors: ${s.errors.join(" | ")}` : ""}`
    ),
    "",
    renderCompanionExperimentBridgeMarkdown(report.companionExperimentProposals),
    renderBenchmarkAdoptionMarkdown(report.benchmarkAdoptionProposals),
    renderBenchmarkCasePortPlansMarkdown(report.benchmarkCasePortPlans),
    renderBenchmarkHarnessFeasibilityMarkdown(report.benchmarkHarnessFeasibility),
    renderBaselineTrendMarkdown(report.baselineTrend),
    "## Baseline (current main)",
    "",
    `- status: ${report.baseline.status}${report.baseline.error ? ` — ${report.baseline.error}` : ""}`,
    ...(report.baseline.metricsLine ? ["", "```", report.baseline.metricsLine, "```"] : []),
    "",
    "## Decisions",
    "",
    "| candidate | version | trigger | trail | decision | reason |",
    "|---|---|---|---|---|---|",
    ...report.decisions.map(
      (d) => `| ${d.candidateKey} | ${d.version ?? "-"} | ${d.trigger} | ${d.trail.join(" → ")} | ${d.decision} | ${d.reason.replace(/\|/g, "/")} |`
    ),
    "",
    "## Skipped",
    "",
    ...(report.skipped.length > 0 ? report.skipped.map((s) => `- ${s.candidateKey}: ${s.reason}`) : ["- (none)"]),
    "",
    "## Cleanup candidates",
    "",
    ...(report.cleanupCandidates.length > 0 ? report.cleanupCandidates.map((x) => `- ${x}`) : ["- (none)"]),
    "",
    `productionTouched: ${String(report.productionTouched)}`,
    "",
  ];
  return lines.join("\n");
}
