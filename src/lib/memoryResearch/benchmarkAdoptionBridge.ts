/**
 * Memory Benchmark Adoption Bridge.
 *
 * Maps external benchmark capability claims to our deterministic RP-memory
 * benchmark coverage. Research evidence only: no external dataset is copied,
 * no external judge is run, and no production memory/runtime is touched.
 */
import {
  BENCHMARK_CAPABILITY_CASE_IDS,
  type BenchmarkCapabilityGroup,
} from "@/lib/memory/memory-rp-benchmark";
import type { ResearchObservation } from "@/lib/memoryResearch/types";

export type BenchmarkAdoptionStatus =
  | "ALREADY_COVERED"
  | "PARTIAL_COVERAGE"
  | "CASE_PORT_WORTHY"
  | "INSUFFICIENT_EVIDENCE";

export type ExternalBenchmarkAbility =
  | "persona_continuity"
  | "trajectory_recall"
  | "persona_conditioned_insight"
  | "forgetting_fidelity"
  | "dynamic_state_tracking"
  | "premise_awareness"
  | "temporal_reasoning"
  | "unclassified";

export type BenchmarkAdoptionProposal = {
  candidateKey: string;
  sourceUrl: string;
  sourceVersion: string | null;
  evidenceLevel: "PUBLISHED_BENCHMARK_CAPABILITY_CLAIM";
  ability: ExternalBenchmarkAbility;
  status: BenchmarkAdoptionStatus;
  localGroups: readonly BenchmarkCapabilityGroup[];
  localCaseCount: number;
  coverage: string;
  gap: string | null;
  nextAction: string;
};

type Rule = {
  ability: Exclude<ExternalBenchmarkAbility, "unclassified">;
  pattern: RegExp;
  status: Exclude<BenchmarkAdoptionStatus, "INSUFFICIENT_EVIDENCE">;
  localGroups: readonly BenchmarkCapabilityGroup[];
  coverage: string;
  gap: string | null;
  nextAction: string;
};

const RULES: readonly Rule[] = [
  {
    ability: "persona_continuity",
    pattern: /persona continuity|persona retention|role.{0,20}boundar(?:y|ies).{0,20}values?.{0,20}style|remain themselves/i,
    status: "CASE_PORT_WORTHY",
    localGroups: ["IDENTITY_TRAJECTORY"],
    coverage:
      "IDENTITY_TRAJECTORY already checks durable role/state continuity and false-memory negatives.",
    gap:
      "Current deterministic cases do not separately stress long-horizon role, explicit boundaries, authored values, and communication style under relationship pressure.",
    nextAction:
      "Design local synthetic RP fixtures for boundary/value/style retention. Do not import external hidden/test conversations or their judge scores.",
  },
  {
    ability: "trajectory_recall",
    pattern: /trajectory recall|active commitment|expired commitment|persona update|user-state change|temporal order/i,
    status: "PARTIAL_COVERAGE",
    localGroups: ["DYNAMIC_STATE_TRACKING", "TEMPORAL_REASONING", "PREMISE_AWARENESS"],
    coverage:
      "Existing groups cover state replacement, promise lifecycle, temporal horizons, corrections, invalidated branches, and false premises.",
    gap:
      "Counterfactual distinction between active vs expired commitments and legitimate persona updates is not yet a dedicated case family.",
    nextAction:
      "Add only missing counterfactual state/commitment fixtures to the canonical benchmark; preserve existing raw metrics.",
  },
  {
    ability: "persona_conditioned_insight",
    pattern: /persona-conditioned insight|insight cognition|facts? to insights?|factual cognition/i,
    status: "CASE_PORT_WORTHY",
    localGroups: ["IDENTITY_TRAJECTORY"],
    coverage:
      "Current benchmark can verify factual recall and role consistency but does not score whether the same fact is interpreted differently under a persona.",
    gap:
      "Missing deterministic fact→persona-grounded-insight cases with an objective grounding check that prevents free-form psychological invention.",
    nextAction:
      "Prototype synthetic fact/insight pairs with explicit persona premises and negative unsupported-inference cases. Keep factual memory as canonical evidence.",
  },
  {
    ability: "forgetting_fidelity",
    pattern: /forgetting|obsolete|invalidated memor|deleted or updated|forgetting-aware|deletion fidelity/i,
    status: "PARTIAL_COVERAGE",
    localGroups: ["DYNAMIC_STATE_TRACKING", "PREMISE_AWARENESS"],
    coverage:
      "Current cases cover correction/supersession, stale state, edit/regen/fork/reset invalidation, and canonical last-turn deletion including summary-seal episodic provenance rollback.",
    gap:
      "The external forgetting benchmark is broader than the site's current mutation surface; no additional concrete local destructive path is presently proven to lack derived-tier invalidation coverage.",
    nextAction:
      "Keep the benchmark on watch. Re-open local case planning only when a real supported delete/update/rewind path is found without full derived-tier invalidation proof; reuse existing stale-state/false-memory metrics.",
  },
  {
    ability: "dynamic_state_tracking",
    pattern: /dynamic state tracking|knowledge updates?|state dynamics?/i,
    status: "ALREADY_COVERED",
    localGroups: ["DYNAMIC_STATE_TRACKING"],
    coverage:
      "DYNAMIC_STATE_TRACKING already covers latest-state replacement, item/location transitions, promises, and relationship role state.",
    gap: null,
    nextAction:
      "No parallel benchmark owner. Re-open only for a concrete case family not represented by current fixtures.",
  },
  {
    ability: "premise_awareness",
    pattern: /premise awareness|false premise|invalid premise/i,
    status: "ALREADY_COVERED",
    localGroups: ["PREMISE_AWARENESS"],
    coverage:
      "PREMISE_AWARENESS already covers false memory/premise, wrong-observer knowledge, and invalidated regen/delete/fork/reset histories.",
    gap: null,
    nextAction:
      "No new case family unless a benchmark exposes a materially different premise failure.",
  },
  {
    ability: "temporal_reasoning",
    pattern: /temporal reasoning|temporal order|multi-session reasoning/i,
    status: "ALREADY_COVERED",
    localGroups: ["TEMPORAL_REASONING"],
    coverage:
      "TEMPORAL_REASONING already spans 20/75/300/1000/2000-turn horizons, correction, first/never, and implicit paraphrase.",
    gap: null,
    nextAction:
      "Keep current canonical group; only add a fixture for a new temporal failure mode.",
  },
] as const;

function localCaseCount(groups: readonly BenchmarkCapabilityGroup[]): number {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const id of BENCHMARK_CAPABILITY_CASE_IDS[group]) ids.add(id);
  }
  return ids.size;
}

export function buildBenchmarkAdoptionProposals(
  observation: ResearchObservation
): BenchmarkAdoptionProposal[] {
  if (observation.category !== "memory_benchmark") return [];

  const text = [
    observation.title,
    observation.summary,
    observation.claimedAdvantage,
  ]
    .filter(Boolean)
    .join("\n");

  const matches = RULES.filter((rule) => rule.pattern.test(text));
  if (matches.length === 0) {
    return [{
      candidateKey: observation.candidateKey,
      sourceUrl: observation.sourceUrl,
      sourceVersion: observation.version,
      evidenceLevel: "PUBLISHED_BENCHMARK_CAPABILITY_CLAIM",
      ability: "unclassified",
      status: "INSUFFICIENT_EVIDENCE",
      localGroups: [],
      localCaseCount: 0,
      coverage: "No deterministic mapping to the current RP-memory capability groups.",
      gap: null,
      nextAction:
        "Keep the benchmark on the research watchlist and wait for a concrete capability/case description before changing local fixtures.",
    }];
  }

  return matches.map((rule) => ({
    candidateKey: observation.candidateKey,
    sourceUrl: observation.sourceUrl,
    sourceVersion: observation.version,
    evidenceLevel: "PUBLISHED_BENCHMARK_CAPABILITY_CLAIM" as const,
    ability: rule.ability,
    status: rule.status,
    localGroups: rule.localGroups,
    localCaseCount: localCaseCount(rule.localGroups),
    coverage: rule.coverage,
    gap: rule.gap,
    nextAction: rule.nextAction,
  }));
}

export function renderBenchmarkAdoptionMarkdown(
  proposals: readonly BenchmarkAdoptionProposal[]
): string {
  const lines = [
    "## RP Memory Benchmark Adoption Radar",
    "",
    "External benchmark capabilities are mapping evidence only. No external dataset, hidden test set, judge output, or leaderboard score is imported into the canonical benchmark.",
    "",
  ];
  if (proposals.length === 0) {
    lines.push("- (no benchmark adoption proposal this cycle)", "");
    return lines.join("\n");
  }
  lines.push(
    "| benchmark | ability | status | local groups | local cases | gap / action |",
    "|---|---|---|---|---:|---|"
  );
  for (const p of proposals) {
    const gapAction = [p.gap, p.nextAction].filter(Boolean).join(" — ").replace(/\|/g, "/");
    lines.push(
      `| ${p.candidateKey} | ${p.ability} | ${p.status} | ${p.localGroups.join(", ") || "-"} | ${p.localCaseCount} | ${gapAction} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
