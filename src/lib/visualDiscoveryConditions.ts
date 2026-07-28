import {
  VISUAL_EVIDENCE_KINDS,
  VISUAL_EVIDENCE_TO_SCENE_EVENT,
  type VisualEvidenceKind,
} from "@/lib/visualDiscoveryCatalog";
import type { SceneEvidenceEvent } from "@/lib/sceneEvidenceTypes";
import type { PersonaSecretKnowledgeState } from "@/lib/personaSecretDiscoveryTypes";

export type VisualRuleConditions = {
  evidenceKind: VisualEvidenceKind;
  resultState?: PersonaSecretKnowledgeState;
  region?: string;
  minimumExposure?: "PARTIAL" | "CLEAR";
  manifestationTags?: string[];
  symptomTags?: string[];
  itemTags?: string[];
  documentTags?: string[];
  markTags?: string[];
  matchMode?: "ANY" | "ALL";
  compilerConfidence?: number;
  needsReview?: boolean;
  compilerWarnings?: string[];
  dormant?: boolean;
  evidenceKinds?: string[];
};

function isVisualEvidenceKind(v: unknown): v is VisualEvidenceKind {
  return (
    typeof v === "string" &&
    (VISUAL_EVIDENCE_KINDS as readonly string[]).includes(v)
  );
}

/**
 * Parse + normalize visual rule conditions from conditions_json.
 * Synthesizes a usable schema from evidenceKinds when typed fields are missing.
 */
export function parseVisualRuleConditions(
  conditionsJson: string
): VisualRuleConditions | null {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(conditionsJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      raw = parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  let evidenceKind: VisualEvidenceKind | null = isVisualEvidenceKind(raw.evidenceKind)
    ? raw.evidenceKind
    : null;
  if (!evidenceKind && Array.isArray(raw.evidenceKinds)) {
    const first = raw.evidenceKinds.map(String).find(isVisualEvidenceKind);
    evidenceKind = first ?? null;
  }
  if (!evidenceKind) return null;

  const matchMode = raw.matchMode === "ALL" ? "ALL" : "ANY";
  const resultState =
    raw.resultState === "CONFIRMED"
      ? "CONFIRMED"
      : raw.resultState === "SUSPECTED"
        ? "SUSPECTED"
        : undefined;

  return {
    evidenceKind,
    resultState,
    region: typeof raw.region === "string" ? raw.region : undefined,
    minimumExposure:
      raw.minimumExposure === "PARTIAL" || raw.minimumExposure === "CLEAR"
        ? raw.minimumExposure
        : undefined,
    manifestationTags: Array.isArray(raw.manifestationTags)
      ? raw.manifestationTags.map(String).filter(Boolean)
      : undefined,
    symptomTags: Array.isArray(raw.symptomTags)
      ? raw.symptomTags.map(String).filter(Boolean)
      : undefined,
    itemTags: Array.isArray(raw.itemTags)
      ? raw.itemTags.map(String).filter(Boolean)
      : undefined,
    documentTags: Array.isArray(raw.documentTags)
      ? raw.documentTags.map(String).filter(Boolean)
      : undefined,
    markTags: Array.isArray(raw.markTags)
      ? raw.markTags.map(String).filter(Boolean)
      : undefined,
    matchMode,
    compilerConfidence:
      typeof raw.compilerConfidence === "number" ? raw.compilerConfidence : undefined,
    needsReview: Boolean(raw.needsReview),
    compilerWarnings: Array.isArray(raw.compilerWarnings)
      ? raw.compilerWarnings.map(String)
      : undefined,
    dormant: raw.dormant !== false,
    evidenceKinds: Array.isArray(raw.evidenceKinds)
      ? raw.evidenceKinds.map(String)
      : undefined,
  };
}

function tagsMatch(
  eventValue: string | undefined,
  tags: string[] | undefined,
  mode: "ANY" | "ALL"
): boolean {
  if (!tags || tags.length === 0) return false;
  if (!eventValue) return false;
  const ev = eventValue.trim().toLowerCase();
  const normalizedTags = tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (mode === "ALL") return normalizedTags.every((t) => ev.includes(t) || t === ev);
  return normalizedTags.some((t) => ev.includes(t) || t === ev);
}

export function eventTypeMatchesEvidenceKind(
  eventType: SceneEvidenceEvent["eventType"],
  conditions: VisualRuleConditions
): boolean {
  return VISUAL_EVIDENCE_TO_SCENE_EVENT[conditions.evidenceKind] === eventType;
}

export function attributesSatisfyConditions(
  event: SceneEvidenceEvent,
  conditions: VisualRuleConditions
): boolean {
  const attrs = event.attributes;
  const mode = conditions.matchMode ?? "ANY";

  switch (conditions.evidenceKind) {
    case "BODY_REGION_EXPOSED": {
      if (!conditions.region) return false;
      if (String(attrs.region ?? "") !== conditions.region) return false;
      if (conditions.minimumExposure === "CLEAR") {
        const level = String(attrs.exposureLevel ?? "CLEAR");
        if (level === "PARTIAL") return false;
      }
      return true;
    }
    case "VISIBLE_MARK_SHOWN": {
      const label = String(attrs.markLabel ?? "");
      if (conditions.markTags?.length) {
        return tagsMatch(label, conditions.markTags, mode);
      }
      // If no tags, any presented mark event matches this evidence kind.
      return label.length > 0;
    }
    case "ABILITY_MANIFESTED": {
      const m = String(attrs.manifestation ?? "");
      return tagsMatch(m, conditions.manifestationTags, mode);
    }
    case "PHYSICAL_SYMPTOM_DISPLAYED":
    case "PHYSICAL_SYMPTOM_OBSERVED": {
      const s = String(attrs.symptom ?? "");
      return tagsMatch(s, conditions.symptomTags, mode);
    }
    case "VISIBLE_ITEM_PRESENTED":
    case "VISIBLE_ITEM_EXPOSED": {
      const item = String(attrs.itemLabel ?? "");
      return tagsMatch(item, conditions.itemTags, mode);
    }
    case "DOCUMENT_PRESENTED":
    case "IDENTITY_DOCUMENT_PRESENTED": {
      const doc = String(attrs.documentLabel ?? "");
      return tagsMatch(doc, conditions.documentTags, mode);
    }
    default:
      return false;
  }
}
