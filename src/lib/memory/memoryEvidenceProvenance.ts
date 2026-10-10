/**
 * Single owner for monthly / research memory-evidence source labels.
 * Prevents HISTORICAL_ONLY or deterministic retrieve tests from being
 * promoted to CURRENT_LIVE_PROVIDER (paid latest-site model output).
 */

export const MEMORY_EVIDENCE_PROVENANCE = [
  "HISTORICAL_ONLY",
  "CURRENT_CODE_DETERMINISTIC",
  "CURRENT_LIVE_PROVIDER",
] as const;

export type MemoryEvidenceProvenance = (typeof MEMORY_EVIDENCE_PROVENANCE)[number];

export type DeterministicSummaryQualityClaim = "NOT_PROVEN";

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

export function memoryEvidenceTitle(provenance: MemoryEvidenceProvenance): string {
  switch (provenance) {
    case "HISTORICAL_ONLY":
      return "HISTORICAL_ONLY memory evidence — not current-site quality";
    case "CURRENT_CODE_DETERMINISTIC":
      return "CURRENT_CODE_DETERMINISTIC memory regression — not live provider quality";
    case "CURRENT_LIVE_PROVIDER":
      return "CURRENT_LIVE_PROVIDER memory evidence";
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
