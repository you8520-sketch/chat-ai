import type { ScheduledAutomationHealthReport } from "@/lib/codeHealth/automationHealth";

export const CODE_HEALTH_AUDIT_VERSION = 1 as const;
export const CODE_HEALTH_LEDGER_BRANCH = "code-health-ledger";
export const CODE_HEALTH_WEEKLY_WORKFLOW_PATH =
  ".github/workflows/code-health-weekly-audit.yml";
export const CODE_HEALTH_MONTHLY_WORKFLOW_PATH =
  ".github/workflows/code-health-monthly-cleanup.yml";
export const CODE_HEALTH_WEEKLY_WORKFLOW_NAME = "Weekly Code Health audit";
export const CODE_HEALTH_MONTHLY_WORKFLOW_NAME = "Monthly Code Health cleanup";
export const CODE_HEALTH_CLEANUP_MAX_ITEMS = 5;
export const CODE_HEALTH_AUDIT_MUTATES_PRODUCTION = false;
export const CODE_HEALTH_CLEANUP_AUTO_MERGE = false;

export const CODE_HEALTH_CLASSIFICATIONS = [
  "SAFE_TO_DELETE",
  "REQUIRED_CLEANUP",
  "KEEP",
  "FOLLOW_UP",
  "UNCONFIRMED",
] as const;

export type CodeHealthClassification = (typeof CODE_HEALTH_CLASSIFICATIONS)[number];

export const CODE_HEALTH_KINDS = [
  "ci_runtime_error",
  "unused_file",
  "unused_export",
  "unused_dependency",
  "unreachable_branch",
  "unused_helper",
  "unused_constant",
  "duplicate_helper",
  "duplicate_constant",
  "obsolete_feature_flag",
  "unused_env_var",
  "dead_fallback",
  "compatibility_shim",
  "temporary_debug",
  "unused_prompt_builder",
  "obsolete_model_adapter",
  "duplicate_prompt_section",
  "duplicate_canonical_owner",
  "db_field_writer_reader_gap",
  "stale_migration_remnant",
  "todo_fixme_hack",
  "critical_bugfix",
] as const;

export type CodeHealthKind = (typeof CODE_HEALTH_KINDS)[number];

export const CODE_HEALTH_RUN_STATUSES = ["SUCCESS", "WARNING", "FAILED"] as const;
export type CodeHealthRunStatus = (typeof CODE_HEALTH_RUN_STATUSES)[number];

export const CLEANUP_STOP_REASONS = [
  "unconfirmed_production_usage",
  "destructive_migration",
  "security_auth_adult_boundary",
  "provider_cost_pricing_routing",
  "unrelated_large_refactor",
  "canonical_owner_mismatch",
  "static_analyzer_false_positive_unresolved",
] as const;

export type CleanupStopReason = (typeof CLEANUP_STOP_REASONS)[number];

export type CandidateEvidence = {
  writerPresent: boolean | null;
  readerPresent: boolean | null;
  staticReferences: number;
  dynamicOrRuntimeReferences: number;
  productionExecutionPath: boolean | null;
  dbExistingDataImpact: boolean | null;
  rollbackOrCompatibilityImpact: boolean | null;
};

export type CodeHealthCandidate = {
  id: string;
  kind: CodeHealthKind;
  classification: CodeHealthClassification;
  path: string;
  symbol: string | null;
  summary: string;
  evidence: CandidateEvidence;
  stopReasons: CleanupStopReason[];
  bugfix: boolean;
  knipEquivalent: boolean;
};

export type CodeHealthCounts = {
  newFindings: number;
  resolved: number;
  safeToDelete: number;
  requiredCleanup: number;
  followUp: number;
  keep: number;
  unconfirmed: number;
  duplicateOwners: number;
  unusedFiles: number;
  unusedExports: number;
  unusedDependencies: number;
  obsoleteFlagsEnvs: number;
  runtimeCiAnomalies: number;
};

export type CodeHealthTrendPoint = {
  previous: number | null;
  current: number;
};

export type CodeHealthDelta = {
  unusedCandidates: CodeHealthTrendPoint;
  duplicateOwners: CodeHealthTrendPoint;
  obsoleteEnvs: CodeHealthTrendPoint;
  flakyCiCandidates: CodeHealthTrendPoint;
};

export type KnipReview = {
  considered: true;
  adoptedAsOwner: false;
  adoptedAsDeletionProof: false;
  reason: string;
};

export type WeeklyCodeHealthReport = {
  kind: "weekly";
  version: typeof CODE_HEALTH_AUDIT_VERSION;
  ranAt: string;
  mainSha: string;
  status: CodeHealthRunStatus;
  counts: CodeHealthCounts;
  previousCounts: CodeHealthCounts | null;
  delta: CodeHealthDelta | null;
  candidates: CodeHealthCandidate[];
  criticalBugfixCandidates: CodeHealthCandidate[];
  automationHealth?: ScheduledAutomationHealthReport;
  knipReview: KnipReview;
  productionMutated: false;
  githubRunUrl: string | null;
  notes: string[];
};

export type MonthlyCleanupDraftPr = {
  created: boolean;
  url: string | null;
  reason: string;
  selectedIds: string[];
};

export type MonthlyCleanupReport = {
  kind: "monthly";
  version: typeof CODE_HEALTH_AUDIT_VERSION;
  ranAt: string;
  mainSha: string;
  status: CodeHealthRunStatus;
  counts: CodeHealthCounts;
  previousCounts: CodeHealthCounts | null;
  delta: CodeHealthDelta | null;
  mergedWeeklyKeys: string[];
  candidates: CodeHealthCandidate[];
  eligibleIds: string[];
  rejectedByGate: Array<{ reason: CleanupStopReason | "not_safe_to_delete"; count: number }>;
  draftPr: MonthlyCleanupDraftPr;
  changeBudget: { maxItems: number; selected: number };
  productionMutated: false;
  autoMerged: false;
  githubRunUrl: string | null;
  notes: string[];
};

export type CodeHealthLedger = {
  version: typeof CODE_HEALTH_AUDIT_VERSION;
  weekly: WeeklyCodeHealthReport[];
  monthly: MonthlyCleanupReport[];
};

export function emptyCodeHealthCounts(): CodeHealthCounts {
  return {
    newFindings: 0,
    resolved: 0,
    safeToDelete: 0,
    requiredCleanup: 0,
    followUp: 0,
    keep: 0,
    unconfirmed: 0,
    duplicateOwners: 0,
    unusedFiles: 0,
    unusedExports: 0,
    unusedDependencies: 0,
    obsoleteFlagsEnvs: 0,
    runtimeCiAnomalies: 0,
  };
}

export function candidateIdentity(candidate: Pick<CodeHealthCandidate, "kind" | "path" | "symbol">): string {
  return `${candidate.kind}:${candidate.path}:${candidate.symbol ?? ""}`;
}

export function formatTrend(point: CodeHealthTrendPoint): string {
  if (point.previous == null) return String(point.current);
  return `${point.previous} → ${point.current}`;
}
