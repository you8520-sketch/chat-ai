/**
 * Benchmark Harness Feasibility Gate.
 *
 * Converts case-port plans into explicit measurement feasibility evidence.
 * Research-only: no provider calls, no LLM judge calls, no production imports,
 * and no automatic benchmark implementation.
 */
import type {
  BenchmarkCasePortPlan,
  CasePortReadiness,
} from "@/lib/memoryResearch/benchmarkCasePortPlanner";

export type HarnessFeasibilityStatus =
  | "READY_LOCAL_DETERMINISTIC"
  | "OWNER_UNRESOLVED"
  | "LOCAL_GOLD_AUTHORING_REQUIRED"
  | "LLM_JUDGE_REQUIRED"
  | "NO_ACTION";

export type HarnessFeasibilityEvidence = {
  planKey: string;
  candidateKey: string;
  ability: BenchmarkCasePortPlan["ability"];
  planReadiness: CasePortReadiness;
  status: HarnessFeasibilityStatus;
  scheduledResearchEligible: boolean;
  providerCallsRequired: boolean;
  llmJudgeRequired: boolean;
  objectiveGroundTruthAvailable: boolean;
  blocker: string | null;
  safeNextAction: string;
  interpretationBoundary: string;
};

function readyLocal(plan: BenchmarkCasePortPlan): HarnessFeasibilityEvidence {
  return {
    planKey: plan.planKey,
    candidateKey: plan.candidateKey,
    ability: plan.ability,
    planReadiness: plan.readiness,
    status: "READY_LOCAL_DETERMINISTIC",
    scheduledResearchEligible: true,
    providerCallsRequired: false,
    llmJudgeRequired: false,
    objectiveGroundTruthAvailable: true,
    blocker: null,
    safeNextAction:
      "Implement only the locally-authored deterministic fixture in the canonical owner identified by the plan, then run existing regression gates.",
    interpretationBoundary:
      "READY means the failure can be measured deterministically; it is not evidence that production behavior should change.",
  };
}

function noAction(plan: BenchmarkCasePortPlan): HarnessFeasibilityEvidence {
  return {
    planKey: plan.planKey,
    candidateKey: plan.candidateKey,
    ability: plan.ability,
    planReadiness: plan.readiness,
    status: "NO_ACTION",
    scheduledResearchEligible: false,
    providerCallsRequired: false,
    llmJudgeRequired: false,
    objectiveGroundTruthAvailable: false,
    blocker: null,
    safeNextAction: "Do not add a duplicate fixture or harness.",
    interpretationBoundary:
      "The planner found no justified local case to implement at this time.",
  };
}

export function assessBenchmarkHarnessFeasibility(
  plan: BenchmarkCasePortPlan
): HarnessFeasibilityEvidence {
  if (plan.readiness === "NO_PORT_REQUIRED") return noAction(plan);

  if (
    plan.readiness === "READY_DETERMINISTIC_FIXTURE" ||
    plan.readiness === "READY_MUTATION_LIFECYCLE_FIXTURE"
  ) {
    return readyLocal(plan);
  }

  if (plan.planKey === "trajectory_recall:persona_update") {
    return {
      planKey: plan.planKey,
      candidateKey: plan.candidateKey,
      ability: plan.ability,
      planReadiness: plan.readiness,
      status: "OWNER_UNRESOLVED",
      scheduledResearchEligible: false,
      providerCallsRequired: false,
      llmJudgeRequired: false,
      objectiveGroundTruthAvailable: false,
      blocker:
        "No canonical mutable character-persona owner is established for in-conversation persona updates.",
      safeNextAction:
        "Audit product semantics and current persona/state owners first. Do not manufacture a persona-update store or map this to episodic facts by convenience.",
      interpretationBoundary:
        "Relationship-role/state changes are not proof that the authored character persona itself is mutable.",
    };
  }

  if (plan.ability === "persona_continuity") {
    return {
      planKey: plan.planKey,
      candidateKey: plan.candidateKey,
      ability: plan.ability,
      planReadiness: plan.readiness,
      status: "LLM_JUDGE_REQUIRED",
      scheduledResearchEligible: false,
      providerCallsRequired: true,
      llmJudgeRequired: true,
      objectiveGroundTruthAvailable: false,
      blocker:
        "Actual role/boundary/value/style behavior is a generated-response property; current deterministic retrieval metrics cannot score it faithfully.",
      safeNextAction:
        "Keep this out of the zero-call weekly research cycle. If later qualified, use a bounded manual/model-quality evaluation with explicit judge provenance and never treat a questionnaire/retrieval proxy as equivalent to turn-level behavior.",
      interpretationBoundary:
        "Structured persona retention or fact retrieval may be useful proxies, but they do not establish user-facing persona continuity.",
    };
  }

  if (plan.ability === "persona_conditioned_insight") {
    return {
      planKey: plan.planKey,
      candidateKey: plan.candidateKey,
      ability: plan.ability,
      planReadiness: plan.readiness,
      status: "LOCAL_GOLD_AUTHORING_REQUIRED",
      scheduledResearchEligible: false,
      providerCallsRequired: false,
      llmJudgeRequired: false,
      objectiveGroundTruthAvailable: false,
      blocker:
        "No canonical deterministic gold set exists for fact→persona-grounded insight, and free-form psychological interpretations would be subjective.",
      safeNextAction:
        "Only proceed with manually authored synthetic persona premises + source facts + mechanically checkable insight/unsupported-inference pairs. Keep any such test research-only until its ground truth is reviewed.",
      interpretationBoundary:
        "A deterministic insight-retrieval proxy would not by itself prove generated roleplay quality and must not create a new insight memory owner.",
    };
  }

  return {
    planKey: plan.planKey,
    candidateKey: plan.candidateKey,
    ability: plan.ability,
    planReadiness: plan.readiness,
    status: "OWNER_UNRESOLVED",
    scheduledResearchEligible: false,
    providerCallsRequired: false,
    llmJudgeRequired: false,
    objectiveGroundTruthAvailable: false,
    blocker:
      "The current plan requires a harness extension but has no deterministic canonical owner/scorer.",
    safeNextAction:
      "Resolve the canonical owner and objective ground truth before implementing a benchmark extension.",
    interpretationBoundary:
      "Unknown harness extensions do not enter scheduled experimentation automatically.",
  };
}

export function assessBenchmarkHarnessFeasibilityBatch(
  plans: readonly BenchmarkCasePortPlan[]
): HarnessFeasibilityEvidence[] {
  return plans.map(assessBenchmarkHarnessFeasibility);
}

export function renderBenchmarkHarnessFeasibilityMarkdown(
  rows: readonly HarnessFeasibilityEvidence[]
): string {
  const lines = [
    "## Benchmark Harness Feasibility Gate",
    "",
    "This gate reports whether a planned benchmark gap can be measured honestly. It does not call providers/judges, alter production, or implement benchmark cases automatically.",
    "",
  ];

  if (rows.length === 0) {
    lines.push("- (no harness-feasibility evidence this cycle)", "");
    return lines.join("\n");
  }

  lines.push(
    "| plan | ability | feasibility | weekly zero-call eligible | provider | LLM judge | blocker / next action |",
    "|---|---|---|---|---|---|---|"
  );
  for (const row of rows) {
    const tail = [row.blocker, row.safeNextAction]
      .filter(Boolean)
      .join(" — ")
      .replace(/\|/g, "/");
    lines.push(
      `| ${row.planKey} | ${row.ability} | ${row.status} | ${row.scheduledResearchEligible ? "YES" : "NO"} | ${row.providerCallsRequired ? "REQUIRED" : "NO"} | ${row.llmJudgeRequired ? "REQUIRED" : "NO"} | ${tail} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}
