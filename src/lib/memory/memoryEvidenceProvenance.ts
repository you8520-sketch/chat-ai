/**
 * Single owner for monthly / research memory-evidence source labels.
 * Prevents HISTORICAL_ONLY or deterministic retrieve tests from being
 * promoted to CURRENT_LIVE_PROVIDER (actual paid provider output).
 * CURRENT_LIVE_PROVIDER is not production-container, homepage, or
 * character-sheet parity.
 */

export const MEMORY_EVIDENCE_PROVENANCE = [
  "HISTORICAL_ONLY",
  "CURRENT_CODE_DETERMINISTIC",
  "CURRENT_LIVE_PROVIDER",
] as const;

export type MemoryEvidenceProvenance = (typeof MEMORY_EVIDENCE_PROVENANCE)[number];

export type DeterministicSummaryQualityClaim = "NOT_PROVEN";

export type ProductionParityClaim = "UNPROVEN";

export type MemoryEvidenceExecutionHost = "CURSOR_VM";

export type MemoryEvidenceRuntimeShaSource =
  | "PROCESS_OBSERVED"
  | "GITHUB_DEPLOY_METADATA"
  | "HARDCODED_CONSTANT"
  | "UNOBSERVED";

/** #1486 Phase 1 / 2A live-path retrieve fixtures. Not Luna generation quality. */
export const MONTHLY_RP_MEMORY_QUALITY_PHASE1_EVIDENCE = {
  provenance: "CURRENT_CODE_DETERMINISTIC",
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  providerPosts: 0,
  summaryQuality: "NOT_PROVEN",
} as const satisfies {
  provenance: MemoryEvidenceProvenance;
  characterId: number;
  characterName: string;
  personaName: string;
  providerPosts: number;
  summaryQuality: DeterministicSummaryQualityClaim;
};

/** #1486 Phase 2B — 5-turn summary request + validator-gap fixtures. Not Luna output. */
export const MONTHLY_RP_MEMORY_QUALITY_PHASE2B_EVIDENCE = {
  provenance: "CURRENT_CODE_DETERMINISTIC",
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  providerPosts: 0,
  summaryQuality: "NOT_PROVEN",
  paidEvaluationApproved: false,
  maxAttemptsPerCase: 3,
} as const satisfies {
  provenance: MemoryEvidenceProvenance;
  characterId: number;
  characterName: string;
  personaName: string;
  providerPosts: number;
  summaryQuality: DeterministicSummaryQualityClaim;
  paidEvaluationApproved: false;
  maxAttemptsPerCase: 3;
};

/**
 * #1486 Phase 2C — archival record of the completed one-case Luna sample.
 * Not a rerun license. Not production-runtime / homepage / identity parity.
 */
export const MONTHLY_RP_MEMORY_QUALITY_PHASE2C_SAMPLE_EVIDENCE = {
  provenance: "CURRENT_LIVE_PROVIDER",
  characterId: 18,
  characterName: "라이크",
  personaName: "렌",
  providerPosts: 1,
  providerRequestId: "52c1bd6a-23c2-4f82-83b4-9c9db9361694",
  billedUsd: 0.000209,
  resolvedModel: "gpt-6-luna",
  identitySource: "FIXTURE_NOT_PRODUCTION_SHEET",
  characterSheetRead: false,
  productionPersonaRead: false,
  executionHost: "CURSOR_VM",
  runtimeShaSource: "GITHUB_DEPLOY_METADATA",
  observedRuntimeSha: null,
  railwayDeployMetadataSha: "3a5238542dd594d72b55e46ba64cb498946b9082",
  productionRuntimeParity: "UNPROVEN",
  productionIdentityParity: "UNPROVEN",
  homepageParity: "UNPROVEN",
  rerunAuthorized: false,
  paidEvaluationApproved: false,
} as const satisfies {
  provenance: MemoryEvidenceProvenance;
  characterId: number;
  characterName: string;
  personaName: string;
  providerPosts: number;
  providerRequestId: string;
  billedUsd: number;
  resolvedModel: string;
  identitySource: "FIXTURE_NOT_PRODUCTION_SHEET";
  characterSheetRead: false;
  productionPersonaRead: false;
  executionHost: MemoryEvidenceExecutionHost;
  runtimeShaSource: MemoryEvidenceRuntimeShaSource;
  observedRuntimeSha: null;
  railwayDeployMetadataSha: string;
  productionRuntimeParity: ProductionParityClaim;
  productionIdentityParity: ProductionParityClaim;
  homepageParity: ProductionParityClaim;
  rerunAuthorized: false;
  paidEvaluationApproved: false;
};

/**
 * True when the packet recorded an actual paid provider response.
 * This is not production-container, homepage, or character-sheet parity.
 */
export function canClaimCurrentLiveProvider(
  provenance: MemoryEvidenceProvenance
): boolean {
  return provenance === "CURRENT_LIVE_PROVIDER";
}

export function isDeterministicCodeRegression(
  provenance: MemoryEvidenceProvenance
): boolean {
  return provenance === "CURRENT_CODE_DETERMINISTIC";
}

/**
 * Production-container / homepage / live-sheet parity.
 * A hardcoded or GitHub-deploy-metadata SHA is never enough, even when
 * it matches another SHA string. Cursor VM execution is never enough.
 */
export function canClaimCurrentProductionParity(opts: {
  executionHost: MemoryEvidenceExecutionHost | "RAILWAY_PRODUCTION_CONTAINER";
  runtimeShaSource: MemoryEvidenceRuntimeShaSource;
  observedRuntimeSha: string | null;
  characterSheetRead: boolean;
  productionPersonaRead: boolean;
}): boolean {
  if (opts.executionHost !== "RAILWAY_PRODUCTION_CONTAINER") return false;
  if (opts.runtimeShaSource !== "PROCESS_OBSERVED") return false;
  if (!opts.observedRuntimeSha) return false;
  if (!opts.characterSheetRead || !opts.productionPersonaRead) return false;
  return true;
}

export function memoryEvidenceTitle(provenance: MemoryEvidenceProvenance): string {
  switch (provenance) {
    case "HISTORICAL_ONLY":
      return "HISTORICAL_ONLY memory evidence — not current-site quality";
    case "CURRENT_CODE_DETERMINISTIC":
      return "CURRENT_CODE_DETERMINISTIC memory regression — not live provider quality";
    case "CURRENT_LIVE_PROVIDER":
      return "CURRENT_LIVE_PROVIDER memory evidence — actual paid provider output, not proven production-runtime parity";
    default: {
      const _exhaustive: never = provenance;
      return _exhaustive;
    }
  }
}

export function provenanceFromQualityFixtureKind(
  fixtureKind: string
): MemoryEvidenceProvenance {
  if (fixtureKind === "HISTORICAL_ONLY") return "HISTORICAL_ONLY";
  // Style/length GOLDEN_SNAPSHOT / CURRENT_LIVE dry-runs are code-path
  // assembly evidence, not paid current-site memory quality.
  return "CURRENT_CODE_DETERMINISTIC";
}
