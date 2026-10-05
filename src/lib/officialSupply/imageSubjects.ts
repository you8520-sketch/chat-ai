import {
  OFFICIAL_BACKGROUND_EXTRAS,
  OFFICIAL_FOREGROUND_CASTS,
  type OfficialAssetSlotKind,
  type OfficialAssetSlotPlan,
  type OfficialBackgroundExtras,
  type OfficialForegroundCast,
  type OfficialImageSubjects,
} from "@/lib/officialSupply/types";

export const OFFICIAL_LEGACY_ONE_PERSON_SENTENCE =
  "Exactly one person unless the situation explicitly needs unnamed background extras";

export const OFFICIAL_FOREGROUND_CAST_MARKER = "FOREGROUND CAST:";

export const OFFICIAL_SOLO_FOREGROUND_CLAUSE =
  "FOREGROUND CAST: exactly one foreground person — the named character only. Do not add a second foreground interaction partner.";

export const OFFICIAL_REQUIRED_PARTNER_FOREGROUND_CLAUSE =
  "FOREGROUND CAST: the named character plus one required foreground interaction partner. The partner is a scene participant required by the Pose line, not an unnamed background extra.";

export const OFFICIAL_NO_BACKGROUND_EXTRAS_CLAUSE = "No background extras.";

export const OFFICIAL_OPTIONAL_UNNAMED_EXTRAS_CLAUSE =
  "Unnamed background extras may appear only if the situation needs them; they are not foreground interaction partners.";

export function isOfficialForegroundCast(value: unknown): value is OfficialForegroundCast {
  return typeof value === "string" && (OFFICIAL_FOREGROUND_CASTS as readonly string[]).includes(value);
}

export function isOfficialBackgroundExtras(value: unknown): value is OfficialBackgroundExtras {
  return typeof value === "string" && (OFFICIAL_BACKGROUND_EXTRAS as readonly string[]).includes(value);
}

export function isOfficialImageSubjects(value: unknown): value is OfficialImageSubjects {
  if (!value || typeof value !== "object") return false;
  const row = value as { foreground?: unknown; backgroundExtras?: unknown };
  return isOfficialForegroundCast(row.foreground) && isOfficialBackgroundExtras(row.backgroundExtras);
}

/**
 * Compatibility default for rows that predate the explicit contract.
 * Kind-based extras only — never pose/situation keyword matching.
 */
export function defaultOfficialImageSubjects(kind: OfficialAssetSlotKind): OfficialImageSubjects {
  return {
    foreground: "solo_character",
    backgroundExtras: kind === "scene" ? "optional_unnamed" : "none",
  };
}

export function resolveOfficialImageSubjects(
  slot: Pick<OfficialAssetSlotPlan, "kind" | "imageSubjects">
): OfficialImageSubjects {
  if (isOfficialImageSubjects(slot.imageSubjects)) return slot.imageSubjects;
  return defaultOfficialImageSubjects(slot.kind);
}

export function renderOfficialImageSubjectRule(subjects: OfficialImageSubjects): string {
  let foreground: string;
  switch (subjects.foreground) {
    case "solo_character":
      foreground = OFFICIAL_SOLO_FOREGROUND_CLAUSE;
      break;
    case "character_plus_required_partner":
      foreground = OFFICIAL_REQUIRED_PARTNER_FOREGROUND_CLAUSE;
      break;
    default: {
      const exhaustive: never = subjects.foreground;
      throw new Error(`Unknown official foreground cast ${String(exhaustive)}`);
    }
  }
  let extras: string;
  switch (subjects.backgroundExtras) {
    case "none":
      extras = OFFICIAL_NO_BACKGROUND_EXTRAS_CLAUSE;
      break;
    case "optional_unnamed":
      extras = OFFICIAL_OPTIONAL_UNNAMED_EXTRAS_CLAUSE;
      break;
    default: {
      const exhaustive: never = subjects.backgroundExtras;
      throw new Error(`Unknown official background extras ${String(exhaustive)}`);
    }
  }
  return `${foreground} ${extras}`;
}

export function officialImageSubjectRuleForSlot(
  slot: Pick<OfficialAssetSlotPlan, "kind" | "imageSubjects">
): string {
  return renderOfficialImageSubjectRule(resolveOfficialImageSubjects(slot));
}
