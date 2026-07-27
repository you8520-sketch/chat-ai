/** Fixed discovery catalog — compiler may not invent kinds outside this set. */

export const PERSONA_SECRET_COMPILER_VERSION = 1;
export const PERSONA_SECRET_OUTPUT_SCHEMA_VERSION = 1;

export const COMPILER_MAX_SOURCE_CHARS = 4000;
export const COMPILER_MAX_SECRETS = 12;
export const COMPILER_MAX_ALIASES_PER_SECRET = 6;
export const COMPILER_MAX_DISCOVERY_RULES_PER_SECRET = 4;
export const COMPILER_MIN_ALIAS_CHARS = 6;

export const COMPILER_CATEGORIES = [
  "ORIGIN",
  "IDENTITY",
  "BODY_MARK",
  "ABILITY",
  "ABILITY_COST",
  "HEALTH",
  "FINANCIAL",
  "CRIME",
  "PAST_EVENT",
  "AFFILIATION",
  "ITEM",
  "OTHER",
] as const;

export type CompilerCategory = (typeof COMPILER_CATEGORIES)[number];

export const COMPILER_IMPORTANCE = ["NORMAL", "IMPORTANT", "CRITICAL"] as const;
export type CompilerImportance = (typeof COMPILER_IMPORTANCE)[number];

export const COMPILER_METHODS = [
  "DIRECT_DISCLOSURE",
  "VISUAL_DISCOVERY",
  "INVESTIGATION_DISCOVERY",
] as const;

export type CompilerDiscoveryMethod = (typeof COMPILER_METHODS)[number];

export const COMPILER_EVIDENCE_KINDS = [
  "BODY_REGION_EXPOSED",
  "VISIBLE_MARK_SHOWN",
  "VISIBLE_ITEM_PRESENTED",
  "VISIBLE_ITEM_EXPOSED",
  "ABILITY_MANIFESTED",
  "PHYSICAL_SYMPTOM_OBSERVED",
  "PHYSICAL_SYMPTOM_DISPLAYED",
  "DOCUMENT_PRESENTED",
  "IDENTITY_DOCUMENT_PRESENTED",
  "DOCUMENT_RECORD",
  "IDENTITY_VERIFICATION",
  "MEDICAL_EXAM",
  "TRUSTED_TESTIMONY",
  "USER_EXPLICIT_DISCLOSURE",
] as const;

export type CompilerEvidenceKind = (typeof COMPILER_EVIDENCE_KINDS)[number];

/** Safe dormant discovery suggestions by category — never invents concrete props/NPCs. */
export function suggestedDiscoveryMethodsForCategory(
  category: CompilerCategory
): CompilerDiscoveryMethod[] {
  switch (category) {
    case "BODY_MARK":
      return ["DIRECT_DISCLOSURE", "VISUAL_DISCOVERY", "INVESTIGATION_DISCOVERY"];
    case "ABILITY":
      return ["DIRECT_DISCLOSURE", "VISUAL_DISCOVERY"];
    case "ABILITY_COST":
      return ["DIRECT_DISCLOSURE", "VISUAL_DISCOVERY", "INVESTIGATION_DISCOVERY"];
    case "FINANCIAL":
    case "CRIME":
    case "IDENTITY":
    case "AFFILIATION":
    case "PAST_EVENT":
    case "ITEM":
      return ["DIRECT_DISCLOSURE", "INVESTIGATION_DISCOVERY"];
    case "HEALTH":
      return ["DIRECT_DISCLOSURE", "VISUAL_DISCOVERY", "INVESTIGATION_DISCOVERY"];
    case "ORIGIN":
      return ["DIRECT_DISCLOSURE", "INVESTIGATION_DISCOVERY"];
    case "OTHER":
    default:
      return ["DIRECT_DISCLOSURE"];
  }
}

export function suggestedEvidenceKinds(
  method: CompilerDiscoveryMethod,
  category: CompilerCategory
): CompilerEvidenceKind[] {
  if (method === "DIRECT_DISCLOSURE") return ["USER_EXPLICIT_DISCLOSURE"];
  if (method === "VISUAL_DISCOVERY") {
    if (category === "BODY_MARK") return ["BODY_REGION_EXPOSED", "VISIBLE_MARK_SHOWN"];
    if (category === "ABILITY") return ["ABILITY_MANIFESTED"];
    if (category === "ABILITY_COST" || category === "HEALTH") {
      return ["PHYSICAL_SYMPTOM_DISPLAYED"];
    }
    if (category === "ITEM") return ["VISIBLE_ITEM_PRESENTED", "VISIBLE_ITEM_EXPOSED"];
    if (category === "FINANCIAL") return ["DOCUMENT_PRESENTED"];
    return ["BODY_REGION_EXPOSED"];
  }
  // INVESTIGATION_DISCOVERY — evidenceKind stored as InvestigationResultType
  if (category === "FINANCIAL") return ["DOCUMENT_RECORD"]; // mapped → DEBT in compiler
  if (category === "HEALTH" || category === "ABILITY_COST") {
    return ["MEDICAL_EXAM"];
  }
  if (category === "BODY_MARK") return ["DOCUMENT_RECORD"]; // meaning → MARK_MEANING
  if (category === "ORIGIN") return ["IDENTITY_VERIFICATION"];
  if (category === "IDENTITY" || category === "AFFILIATION") {
    return ["IDENTITY_VERIFICATION"];
  }
  if (category === "PAST_EVENT") return ["TRUSTED_TESTIMONY"];
  return ["DOCUMENT_RECORD"];
}
