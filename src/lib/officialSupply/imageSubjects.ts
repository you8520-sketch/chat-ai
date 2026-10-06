import {
  OFFICIAL_BACKGROUND_EXTRAS,
  OFFICIAL_FOREGROUND_CASTS,
  OFFICIAL_PARTNER_ROLES,
  type OfficialAssetSlotPlan,
  type OfficialBackgroundExtras,
  type OfficialForegroundCast,
  type OfficialImageSubjects,
  type OfficialPartnerRole,
} from "@/lib/officialSupply/types";

export const OFFICIAL_LEGACY_ONE_PERSON_SENTENCE =
  "Exactly one person unless the situation explicitly needs unnamed background extras";

export const OFFICIAL_FOREGROUND_CAST_MARKER = "FOREGROUND CAST:";

export const OFFICIAL_SOLO_FOREGROUND_CLAUSE =
  "FOREGROUND CAST: exactly one foreground person — the named character only. Do not add a second foreground interaction partner.";

/** Shared count marker — partner slots still require exactly one interaction partner. */
export const OFFICIAL_REQUIRED_PARTNER_COUNT_MARKER = "plus one required";

/**
 * `partnerRole=user` depiction policy. Pose still owns the action; this clause
 * only limits how much of an unspecified RP user may appear.
 */
export const OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE =
  "FOREGROUND CAST: the named character plus one required user-role interaction partner, shown only as the smallest identity-neutral cropped body fragment the Pose needs — a hand, wrist, or forearm when that is enough, or a cropped arm, shoulder, or partial torso only when the Pose requires it — with the rest of that person outside the composition.";

export const OFFICIAL_NO_BACKGROUND_EXTRAS_CLAUSE = "No background extras.";

export const OFFICIAL_OPTIONAL_UNNAMED_EXTRAS_CLAUSE =
  "Unnamed background extras may appear only if the situation needs them; they are not foreground interaction partners.";

const SOLO_SUBJECT_KEYS = ["foreground", "backgroundExtras"] as const;
const PARTNER_SUBJECT_KEYS = ["foreground", "partnerRole", "backgroundExtras"] as const;

export function isOfficialForegroundCast(value: unknown): value is OfficialForegroundCast {
  return typeof value === "string" && (OFFICIAL_FOREGROUND_CASTS as readonly string[]).includes(value);
}

export function isOfficialBackgroundExtras(value: unknown): value is OfficialBackgroundExtras {
  return typeof value === "string" && (OFFICIAL_BACKGROUND_EXTRAS as readonly string[]).includes(value);
}

export function isOfficialPartnerRole(value: unknown): value is OfficialPartnerRole {
  return typeof value === "string" && (OFFICIAL_PARTNER_ROLES as readonly string[]).includes(value);
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function isOfficialImageSubjects(value: unknown): value is OfficialImageSubjects {
  if (!value || typeof value !== "object") return false;
  const row = value as {
    foreground?: unknown;
    backgroundExtras?: unknown;
    partnerRole?: unknown;
  };
  if (!isOfficialForegroundCast(row.foreground) || !isOfficialBackgroundExtras(row.backgroundExtras)) {
    return false;
  }
  switch (row.foreground) {
    case "solo_character":
      return hasExactKeys(row, SOLO_SUBJECT_KEYS);
    case "character_plus_required_partner":
      return hasExactKeys(row, PARTNER_SUBJECT_KEYS) && isOfficialPartnerRole(row.partnerRole);
    default: {
      const exhaustive: never = row.foreground;
      throw new Error(`Unknown official foreground cast ${String(exhaustive)}`);
    }
  }
}

export function resolveOfficialImageSubjects(
  slot: Pick<OfficialAssetSlotPlan, "slotKey" | "imageSubjects">
): OfficialImageSubjects {
  if (!isOfficialImageSubjects(slot.imageSubjects)) {
    throw new Error(
      `${slot.slotKey || "slot"}: imageSubjects must be an explicit foreground/backgroundExtras/partner contract`
    );
  }
  return slot.imageSubjects;
}

function renderRequiredPartnerForeground(
  subjects: Extract<OfficialImageSubjects, { foreground: "character_plus_required_partner" }>
): string {
  switch (subjects.partnerRole) {
    case "user":
      return OFFICIAL_USER_PARTNER_PARTIAL_CLAUSE;
    default: {
      const exhaustive: never = subjects.partnerRole;
      throw new Error(`Unknown official partner role ${String(exhaustive)}`);
    }
  }
}

export function renderOfficialImageSubjectRule(subjects: OfficialImageSubjects): string {
  let foreground: string;
  switch (subjects.foreground) {
    case "solo_character":
      foreground = OFFICIAL_SOLO_FOREGROUND_CLAUSE;
      break;
    case "character_plus_required_partner":
      foreground = renderRequiredPartnerForeground(subjects);
      break;
    default: {
      const exhaustive: never = subjects;
      throw new Error(`Unknown official image subjects ${JSON.stringify(exhaustive)}`);
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
  slot: Pick<OfficialAssetSlotPlan, "slotKey" | "imageSubjects">
): string {
  return renderOfficialImageSubjectRule(resolveOfficialImageSubjects(slot));
}
