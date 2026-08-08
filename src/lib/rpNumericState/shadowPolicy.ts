/**
 * Phase B1-B — Numeric shadow eligibility (fail-closed, default OFF).
 *
 * Pilot allowlist of state keys lives HERE only — never hardcode inside reducer.
 */
import {
  normalizeNumericStateDefinition,
} from "@/lib/statusWidget/numericStateDefinition";
import type {
  ServerMeterNumericStateDefinitionV1,
  StatusWidget,
  StatusWidgetField,
} from "@/lib/statusWidget/types";
import { fieldPlaceholderKey } from "@/lib/statusWidget/fieldKeys";

export const RP_NUMERIC_STATE_SHADOW_ENABLED_ENV =
  "RP_NUMERIC_STATE_SHADOW_ENABLED";
export const RP_NUMERIC_STATE_SHADOW_USER_IDS_ENV =
  "RP_NUMERIC_STATE_SHADOW_USER_IDS";
export const RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS_ENV =
  "RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS";

/** B1-B live-shadow pilot keys only (eligibility layer — not reducer). */
export const RP_NUMERIC_SHADOW_PILOT_STATE_KEYS = [
  "affection",
  "trust",
  "corruption",
] as const;

export type RpNumericShadowPilotStateKey =
  (typeof RP_NUMERIC_SHADOW_PILOT_STATE_KEYS)[number];

const PILOT_KEY_SET = new Set<string>(RP_NUMERIC_SHADOW_PILOT_STATE_KEYS);

const CANONICAL_POSITIVE_INT_RE = /^[1-9]\d*$/;

export function parsePositiveIntAllowlist(raw: string | undefined): number[] {
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!CANONICAL_POSITIVE_INT_RE.test(t)) continue;
    const n = Number(t);
    if (Number.isSafeInteger(n) && n > 0) out.push(n);
  }
  return out;
}

function isTruthyEnvFlag(raw: string | undefined): boolean {
  const enabled = raw?.trim();
  return enabled === "1" || enabled?.toLowerCase() === "true";
}

export type NumericShadowEligibilityResult = {
  eligible: boolean;
  reason:
    | "flag_off"
    | "empty_user_allowlist"
    | "user_not_allowlisted"
    | "character_not_allowlisted"
    | "eligible";
};

/**
 * Central shadow gate. Fail-closed:
 * ENABLED must be true AND non-empty valid user allowlist AND user match.
 * Optional character allowlist: when non-empty, characterId must match.
 */
export function resolveNumericShadowEligibility(input: {
  userId?: number | null;
  characterId?: number | null;
  env?: NodeJS.ProcessEnv;
}): NumericShadowEligibilityResult {
  const env = input.env ?? process.env;
  if (!isTruthyEnvFlag(env[RP_NUMERIC_STATE_SHADOW_ENABLED_ENV])) {
    return { eligible: false, reason: "flag_off" };
  }
  const users = parsePositiveIntAllowlist(
    env[RP_NUMERIC_STATE_SHADOW_USER_IDS_ENV]
  );
  if (users.length === 0) {
    return { eligible: false, reason: "empty_user_allowlist" };
  }
  const userId = input.userId;
  if (
    userId == null ||
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !users.includes(userId)
  ) {
    return { eligible: false, reason: "user_not_allowlisted" };
  }
  const characters = parsePositiveIntAllowlist(
    env[RP_NUMERIC_STATE_SHADOW_CHARACTER_IDS_ENV]
  );
  if (characters.length > 0) {
    const characterId = input.characterId;
    if (
      characterId == null ||
      !Number.isSafeInteger(characterId) ||
      characterId <= 0 ||
      !characters.includes(characterId)
    ) {
      return { eligible: false, reason: "character_not_allowlisted" };
    }
  }
  return { eligible: true, reason: "eligible" };
}

export type ShadowEligibleNumericField = {
  stateKey: string;
  valueKey: string;
  definition: ServerMeterNumericStateDefinitionV1;
  field: StatusWidgetField;
};

/**
 * Explicit opt-in fields only: valid numericState + pilot state key.
 * Does not invent meters from affection/trust/corruption names alone.
 */
export function listShadowEligibleNumericFields(
  characterWidget: StatusWidget | null | undefined
): ShadowEligibleNumericField[] {
  if (!characterWidget?.fields?.length) return [];
  const out: ShadowEligibleNumericField[] = [];
  for (const field of characterWidget.fields) {
    const stateKey = String(field.id ?? "").trim().toLowerCase();
    if (!stateKey || !PILOT_KEY_SET.has(stateKey)) continue;
    const definition = normalizeNumericStateDefinition(field.numericState);
    if (!definition) continue;
    const valueKey = fieldPlaceholderKey(field) || stateKey;
    out.push({ stateKey, valueKey, definition, field });
  }
  return out;
}

export function isPilotNumericShadowStateKey(stateKey: string): boolean {
  return PILOT_KEY_SET.has(String(stateKey ?? "").trim().toLowerCase());
}
