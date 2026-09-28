import { isKeepPath, isProtectedBoundaryPath } from "@/lib/codeHealth/keep";
import type {
  CleanupStopReason,
  CodeHealthCandidate,
  CodeHealthClassification,
  CodeHealthCounts,
  CodeHealthDelta,
} from "@/lib/codeHealth/types";
import { emptyCodeHealthCounts } from "@/lib/codeHealth/types";

const UNUSED_KINDS = new Set([
  "unused_file",
  "unused_export",
  "unused_dependency",
  "unused_helper",
  "unused_constant",
]);

function evidenceCompleteForDelete(candidate: CodeHealthCandidate): boolean {
  const e = candidate.evidence;
  return (
    e.writerPresent === false &&
    e.readerPresent === false &&
    e.staticReferences === 0 &&
    e.dynamicOrRuntimeReferences === 0 &&
    e.productionExecutionPath === false &&
    e.dbExistingDataImpact === false &&
    e.rollbackOrCompatibilityImpact === false
  );
}

export function stopReasonsFor(
  candidate: CodeHealthCandidate,
  opts?: { includeUnconfirmed?: boolean }
): CleanupStopReason[] {
  const reasons = new Set<CleanupStopReason>(candidate.stopReasons);
  if (isProtectedBoundaryPath(candidate.path)) {
    reasons.add("security_auth_adult_boundary");
    if (/pricing|billing|payout|openRouter|chatModels/i.test(candidate.path)) {
      reasons.add("provider_cost_pricing_routing");
    }
  }
  if (candidate.kind === "db_field_writer_reader_gap" || candidate.kind === "stale_migration_remnant") {
    reasons.add("destructive_migration");
  }
  if (candidate.kind === "unused_file" && candidate.evidence.dynamicOrRuntimeReferences > 0) {
    reasons.add("static_analyzer_false_positive_unresolved");
  }
  if (candidate.kind === "duplicate_canonical_owner") {
    reasons.add("canonical_owner_mismatch");
  }
  const includeUnconfirmed = opts?.includeUnconfirmed !== false;
  if (
    includeUnconfirmed &&
    (candidate.classification === "UNCONFIRMED" ||
      candidate.evidence.productionExecutionPath == null ||
      candidate.evidence.readerPresent == null)
  ) {
    reasons.add("unconfirmed_production_usage");
  }
  return [...reasons];
}

export function classifyCandidate(
  candidate: CodeHealthCandidate,
  opts?: { allowSafeDelete?: boolean }
): CodeHealthCandidate {
  const allowSafeDelete = opts?.allowSafeDelete !== false;
  let classification: CodeHealthClassification = candidate.classification;
  const structuralStops = stopReasonsFor(candidate, { includeUnconfirmed: false });

  if (candidate.bugfix || candidate.kind === "critical_bugfix") {
    classification = "REQUIRED_CLEANUP";
  } else if (candidate.kind === "duplicate_canonical_owner") {
    classification = "REQUIRED_CLEANUP";
  } else if (isKeepPath(candidate.path) && UNUSED_KINDS.has(candidate.kind)) {
    classification = "KEEP";
  } else if (
    allowSafeDelete &&
    candidate.kind === "unused_file" &&
    evidenceCompleteForDelete(candidate) &&
    structuralStops.length === 0 &&
    !isKeepPath(candidate.path) &&
    !isProtectedBoundaryPath(candidate.path) &&
    !candidate.path.startsWith("src/app/") &&
    !candidate.path.startsWith("src/components/") &&
    !candidate.path.startsWith("src/lib/") &&
    !candidate.path.startsWith("public/")
  ) {
    classification = "SAFE_TO_DELETE";
  } else if (classification === "SAFE_TO_DELETE") {
    classification = "UNCONFIRMED";
  }

  const stopReasons = stopReasonsFor({ ...candidate, classification }, {
    includeUnconfirmed: classification !== "SAFE_TO_DELETE" && classification !== "KEEP",
  });

  if (classification === "SAFE_TO_DELETE" && structuralStops.length > 0) {
    classification = "UNCONFIRMED";
  }

  return { ...candidate, classification, stopReasons };
}

export function classifyAll(
  candidates: readonly CodeHealthCandidate[],
  opts?: { allowSafeDelete?: boolean }
): CodeHealthCandidate[] {
  const seen = new Set<string>();
  const out: CodeHealthCandidate[] = [];
  for (const candidate of candidates) {
    const next = classifyCandidate(candidate, opts);
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
  }
  return out;
}

export function countCandidates(
  candidates: readonly CodeHealthCandidate[],
  previous?: readonly CodeHealthCandidate[] | null
): CodeHealthCounts {
  const counts = emptyCodeHealthCounts();
  const prevIds = new Set((previous ?? []).map((c) => c.id));
  const currentIds = new Set(candidates.map((c) => c.id));
  counts.newFindings = candidates.filter((c) => !prevIds.has(c.id)).length;
  counts.resolved = (previous ?? []).filter((c) => !currentIds.has(c.id)).length;
  for (const candidate of candidates) {
    switch (candidate.classification) {
      case "SAFE_TO_DELETE":
        counts.safeToDelete += 1;
        break;
      case "REQUIRED_CLEANUP":
        counts.requiredCleanup += 1;
        break;
      case "FOLLOW_UP":
        counts.followUp += 1;
        break;
      case "KEEP":
        counts.keep += 1;
        break;
      case "UNCONFIRMED":
        counts.unconfirmed += 1;
        break;
      default: {
        const _exhaustive: never = candidate.classification;
        return _exhaustive;
      }
    }
    switch (candidate.kind) {
      case "duplicate_canonical_owner":
      case "duplicate_helper":
      case "duplicate_constant":
      case "duplicate_prompt_section":
        if (candidate.kind === "duplicate_canonical_owner") counts.duplicateOwners += 1;
        break;
      case "unused_file":
        counts.unusedFiles += 1;
        break;
      case "unused_export":
        counts.unusedExports += 1;
        break;
      case "unused_dependency":
        counts.unusedDependencies += 1;
        break;
      case "obsolete_feature_flag":
      case "unused_env_var":
        counts.obsoleteFlagsEnvs += 1;
        break;
      case "ci_runtime_error":
        counts.runtimeCiAnomalies += 1;
        break;
      default:
        break;
    }
  }
  return counts;
}

export function unusedCandidateTotal(counts: CodeHealthCounts): number {
  return counts.unusedFiles + counts.unusedExports + counts.unusedDependencies;
}

export function computeDelta(
  current: CodeHealthCounts,
  previous: CodeHealthCounts | null
): CodeHealthDelta {
  return {
    unusedCandidates: {
      previous: previous ? unusedCandidateTotal(previous) : null,
      current: unusedCandidateTotal(current),
    },
    duplicateOwners: {
      previous: previous ? previous.duplicateOwners : null,
      current: current.duplicateOwners,
    },
    obsoleteEnvs: {
      previous: previous ? previous.obsoleteFlagsEnvs : null,
      current: current.obsoleteFlagsEnvs,
    },
    flakyCiCandidates: {
      previous: previous ? previous.runtimeCiAnomalies : null,
      current: current.runtimeCiAnomalies,
    },
  };
}

export function decideRunStatus(candidates: readonly CodeHealthCandidate[]): "SUCCESS" | "WARNING" | "FAILED" {
  if (candidates.some((c) => c.bugfix || c.kind === "critical_bugfix")) return "FAILED";
  if (candidates.some((c) => c.classification === "REQUIRED_CLEANUP")) return "WARNING";
  if (candidates.some((c) => c.kind === "ci_runtime_error")) return "WARNING";
  return "SUCCESS";
}
