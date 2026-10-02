/**
 * Memory Research Effectiveness Audit.
 *
 * Read-only research-lab evidence over the durable candidate ledger.
 * It reports funnel/bottleneck health without changing sources, cooldowns,
 * candidates, benchmark policy, or production runtime.
 */
import type {
  CandidateDecisionCode,
  ResearchCandidate,
  ResearchSourceKind,
} from "@/lib/memoryResearch/types";

export type SourceEffectivenessRow = {
  sourceKind: ResearchSourceKind;
  candidates: number;
  watch: number;
  rejected: number;
  accepted: number;
  acceptedDraftPrs: number;
  implementationPrs: number;
  liveEvaluated: number;
};

export type WatchBottleneckRow = {
  decision: CandidateDecisionCode;
  candidates: number;
  exampleCandidateKeys: string[];
};

export type RepeatedWatchRow = {
  candidateKey: string;
  decision: CandidateDecisionCode;
  consecutiveSameDecision: number;
};

export type MemoryResearchEffectivenessAudit = {
  totalCandidates: number;
  watch: number;
  rejected: number;
  accepted: number;
  acceptedDraftPrs: number;
  implementationPrs: number;
  liveEvaluated: number;
  dueForReevaluation: string[];
  repeatedWatch: RepeatedWatchRow[];
  watchBottlenecks: WatchBottleneckRow[];
  bySourceKind: SourceEffectivenessRow[];
  note: string;
};

function isWatchDecision(
  decision: CandidateDecisionCode | null
): decision is CandidateDecisionCode {
  return typeof decision === "string" && decision.startsWith("WATCH_");
}

function countConsecutiveSameDecision(candidate: ResearchCandidate): number {
  const evaluations = [...candidate.evaluations].reverse();
  const latest = evaluations[0]?.decision ?? null;
  if (!latest || !latest.startsWith("WATCH_")) return 0;

  let count = 0;
  for (const evaluation of evaluations) {
    if (evaluation.decision !== latest) break;
    count += 1;
  }
  return count;
}

export function buildMemoryResearchEffectivenessAudit(
  candidates: Readonly<Record<string, ResearchCandidate>>,
  now: Date
): MemoryResearchEffectivenessAudit {
  const rows = Object.values(candidates);
  const sourceMap = new Map<ResearchSourceKind, SourceEffectivenessRow>();
  const bottleneckMap = new Map<
    CandidateDecisionCode,
    { candidates: number; keys: string[] }
  >();
  const dueForReevaluation: string[] = [];
  const repeatedWatch: RepeatedWatchRow[] = [];

  let watch = 0;
  let rejected = 0;
  let accepted = 0;
  let acceptedDraftPrs = 0;
  let implementationPrs = 0;
  let liveEvaluated = 0;

  for (const candidate of rows) {
    if (candidate.state === "WATCH") watch += 1;
    else if (candidate.state === "REJECTED") rejected += 1;
    else if (candidate.state === "ACCEPTED") accepted += 1;

    if (candidate.state === "ACCEPTED" && candidate.draftPrUrl) {
      acceptedDraftPrs += 1;
    }
    if (candidate.implementationPrUrl) implementationPrs += 1;
    if (candidate.liveExperiment?.evaluatedAt) liveEvaluated += 1;

    const source =
      sourceMap.get(candidate.sourceKind) ?? {
        sourceKind: candidate.sourceKind,
        candidates: 0,
        watch: 0,
        rejected: 0,
        accepted: 0,
        acceptedDraftPrs: 0,
        implementationPrs: 0,
        liveEvaluated: 0,
      };
    source.candidates += 1;
    if (candidate.state === "WATCH") source.watch += 1;
    else if (candidate.state === "REJECTED") source.rejected += 1;
    else if (candidate.state === "ACCEPTED") source.accepted += 1;
    if (candidate.state === "ACCEPTED" && candidate.draftPrUrl) {
      source.acceptedDraftPrs += 1;
    }
    if (candidate.implementationPrUrl) source.implementationPrs += 1;
    if (candidate.liveExperiment?.evaluatedAt) source.liveEvaluated += 1;
    sourceMap.set(candidate.sourceKind, source);

    if (candidate.state === "WATCH" && isWatchDecision(candidate.lastDecision)) {
      const current = bottleneckMap.get(candidate.lastDecision) ?? {
        candidates: 0,
        keys: [],
      };
      current.candidates += 1;
      if (current.keys.length < 5) current.keys.push(candidate.candidateKey);
      bottleneckMap.set(candidate.lastDecision, current);

      const consecutiveSameDecision = countConsecutiveSameDecision(candidate);
      if (consecutiveSameDecision >= 2) {
        repeatedWatch.push({
          candidateKey: candidate.candidateKey,
          decision: candidate.lastDecision,
          consecutiveSameDecision,
        });
      }

      if (candidate.cooldownUntil) {
        const cooldownMs = Date.parse(candidate.cooldownUntil);
        if (Number.isFinite(cooldownMs) && cooldownMs <= now.getTime()) {
          dueForReevaluation.push(candidate.candidateKey);
        }
      }
    }
  }

  const watchBottlenecks = [...bottleneckMap.entries()]
    .map(([decision, row]) => ({
      decision,
      candidates: row.candidates,
      exampleCandidateKeys: [...row.keys].sort(),
    }))
    .sort(
      (a, b) =>
        b.candidates - a.candidates || a.decision.localeCompare(b.decision)
    );

  const bySourceKind = [...sourceMap.values()].sort((a, b) =>
    a.sourceKind.localeCompare(b.sourceKind)
  );

  return {
    totalCandidates: rows.length,
    watch,
    rejected,
    accepted,
    acceptedDraftPrs,
    implementationPrs,
    liveEvaluated,
    dueForReevaluation: dueForReevaluation.sort(),
    repeatedWatch: repeatedWatch.sort((a, b) =>
      a.candidateKey.localeCompare(b.candidateKey)
    ),
    watchBottlenecks,
    bySourceKind,
    note:
      "Descriptive research-automation evidence only. A low acceptance count does not prove a source is low quality; no source, candidate, or policy is changed automatically.",
  };
}

export function renderMemoryResearchEffectivenessMarkdown(
  audit: MemoryResearchEffectivenessAudit
): string {
  const lines = [
    "## Memory Research Effectiveness Audit",
    "",
    `- candidates: ${audit.totalCandidates} · WATCH ${audit.watch} · REJECT ${audit.rejected} · ACCEPT ${audit.accepted}`,
    `- accepted Draft PRs: ${audit.acceptedDraftPrs} · implementation PRs: ${audit.implementationPrs} · live evaluated: ${audit.liveEvaluated}`,
    `- cooldown due: ${audit.dueForReevaluation.length} · repeated WATCH: ${audit.repeatedWatch.length}`,
    "",
    "### WATCH bottlenecks",
    "",
    "| decision | candidates | examples |",
    "|---|---:|---|",
    ...(audit.watchBottlenecks.length
      ? audit.watchBottlenecks.map(
          (row) =>
            `| ${row.decision} | ${row.candidates} | ${row.exampleCandidateKeys.join(", ")} |`
        )
      : ["| (none) | 0 | - |"]),
    "",
    "### Source-kind funnel",
    "",
    "| source | candidates | WATCH | REJECT | ACCEPT | accepted Draft | implementation PR | live |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...audit.bySourceKind.map(
      (row) =>
        `| ${row.sourceKind} | ${row.candidates} | ${row.watch} | ${row.rejected} | ${row.accepted} | ${row.acceptedDraftPrs} | ${row.implementationPrs} | ${row.liveEvaluated} |`
    ),
    "",
    audit.note,
    "",
  ];
  return lines.join("\n");
}
