import {
  INVESTIGATION_RESULT_TYPES,
  resultStateSatisfies,
} from "@/lib/investigationCatalog";
import type {
  InvestigationResultState,
  InvestigationResultType,
} from "@/lib/investigationTypes";
import type { PersonaSecretKnowledgeState } from "@/lib/personaSecretDiscoveryTypes";

export type InvestigationDiscoveryCondition = {
  evidenceKind: InvestigationResultType;
  requiredTags?: string[];
  forbiddenTags?: string[];
  matchMode?: "ANY" | "ALL";
  minimumResultState: InvestigationResultState;
  minimumConfidence?: number;
  requiredPriorKnowledge?: Array<{
    secretId: string;
    state: PersonaSecretKnowledgeState;
  }>;
  resultState?: PersonaSecretKnowledgeState;
  compilerConfidence?: number;
  needsReview?: boolean;
  compilerWarnings?: string[];
  dormant?: boolean;
};

const RESULT_TYPE_SET = new Set<string>(INVESTIGATION_RESULT_TYPES);

function isResultType(v: unknown): v is InvestigationResultType {
  return typeof v === "string" && RESULT_TYPE_SET.has(v);
}

/**
 * Map legacy compiler evidenceKinds → InvestigationResultType.
 */
function mapLegacyEvidenceKind(kind: string): InvestigationResultType | null {
  switch (kind) {
    case "DOCUMENT_RECORD":
      return "DOCUMENT_CONTENT_VERIFIED";
    case "IDENTITY_VERIFICATION":
      return "IDENTITY_RECORD_MISMATCH";
    case "MEDICAL_EXAM":
      return "ABILITY_COST_CONFIRMED";
    case "TRUSTED_TESTIMONY":
      return "TRUSTED_TESTIMONY_RECEIVED";
    default:
      return isResultType(kind) ? kind : null;
  }
}

export function parseInvestigationRuleConditions(
  conditionsJson: string
): InvestigationDiscoveryCondition | null {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(conditionsJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  let evidenceKind: InvestigationResultType | null = isResultType(raw.evidenceKind)
    ? raw.evidenceKind
    : null;
  if (!evidenceKind && Array.isArray(raw.evidenceKinds)) {
    for (const k of raw.evidenceKinds.map(String)) {
      const mapped = mapLegacyEvidenceKind(k);
      if (mapped) {
        evidenceKind = mapped;
        break;
      }
    }
  }
  if (!evidenceKind) return null;

  const minimumResultState: InvestigationResultState =
    raw.minimumResultState === "PARTIAL" ? "PARTIAL" : "VERIFIED";

  return {
    evidenceKind,
    requiredTags: Array.isArray(raw.requiredTags)
      ? raw.requiredTags.map(String).filter(Boolean).slice(0, 12)
      : undefined,
    forbiddenTags: Array.isArray(raw.forbiddenTags)
      ? raw.forbiddenTags.map(String).filter(Boolean).slice(0, 12)
      : undefined,
    matchMode: raw.matchMode === "ANY" ? "ANY" : "ALL",
    minimumResultState,
    minimumConfidence:
      typeof raw.minimumConfidence === "number" ? raw.minimumConfidence : undefined,
    requiredPriorKnowledge: Array.isArray(raw.requiredPriorKnowledge)
      ? raw.requiredPriorKnowledge
          .filter(
            (x): x is { secretId: string; state: PersonaSecretKnowledgeState } =>
              !!x &&
              typeof x === "object" &&
              typeof (x as { secretId?: unknown }).secretId === "string" &&
              ((x as { state?: unknown }).state === "SUSPECTED" ||
                (x as { state?: unknown }).state === "CONFIRMED")
          )
          .map((x) => ({ secretId: x.secretId, state: x.state }))
      : undefined,
    resultState:
      raw.resultState === "CONFIRMED"
        ? "CONFIRMED"
        : raw.resultState === "SUSPECTED"
          ? "SUSPECTED"
          : undefined,
    compilerConfidence:
      typeof raw.compilerConfidence === "number" ? raw.compilerConfidence : undefined,
    needsReview: Boolean(raw.needsReview),
    compilerWarnings: Array.isArray(raw.compilerWarnings)
      ? raw.compilerWarnings.map(String)
      : undefined,
    dormant: raw.dormant !== false,
  };
}

export function tagsSatisfy(
  resultTags: string[],
  requiredTags: string[] | undefined,
  matchMode: "ANY" | "ALL" = "ALL"
): boolean {
  if (!requiredTags || requiredTags.length === 0) return true;
  const have = new Set(resultTags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const need = requiredTags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (need.length === 0) return true;
  if (matchMode === "ANY") return need.some((t) => have.has(t));
  return need.every((t) => have.has(t));
}

export function containsForbiddenTags(
  resultTags: string[],
  forbiddenTags: string[] | undefined
): boolean {
  if (!forbiddenTags || forbiddenTags.length === 0) return false;
  const have = new Set(resultTags.map((t) => t.trim().toLowerCase()).filter(Boolean));
  return forbiddenTags
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((t) => have.has(t));
}

export { resultStateSatisfies };
