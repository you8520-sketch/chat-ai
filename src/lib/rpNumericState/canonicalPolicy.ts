/**
 * Phase B1-C/D1 — Canonical numeric state eligibility (fail-closed, default OFF).
 *
 * B1-D1: no user/character allowlist. When ENABLED=1 and KILL_SWITCH!=1,
 * all authenticated users are eligible. Field eligibility (explicit numericState
 * + pilot keys) is unchanged and independent of user rollout.
 *
 * Independent from RP_NUMERIC_STATE_SHADOW_* flags (shadow keep its own allowlists).
 * Pilot state-key allowlist lives HERE (and shadowPolicy) — never in the reducer.
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
import { RP_NUMERIC_SHADOW_PILOT_STATE_KEYS } from "./shadowPolicy";

export const RP_NUMERIC_STATE_ENABLED_ENV = "RP_NUMERIC_STATE_ENABLED";
export const RP_NUMERIC_STATE_KILL_SWITCH_ENV = "RP_NUMERIC_STATE_KILL_SWITCH";

/** B1-C/D1 pilot keys (eligibility layer only — not reducer). */
export const RP_NUMERIC_CANONICAL_PILOT_STATE_KEYS =
  RP_NUMERIC_SHADOW_PILOT_STATE_KEYS;

const PILOT_KEY_SET = new Set<string>(RP_NUMERIC_CANONICAL_PILOT_STATE_KEYS);

function isTruthyEnvFlag(raw: string | undefined): boolean {
  const enabled = raw?.trim();
  return enabled === "1" || enabled?.toLowerCase() === "true";
}

export type NumericCanonicalEligibilityResult = {
  eligible: boolean;
  reason:
    | "flag_off"
    | "kill_switch"
    | "unauthenticated"
    | "eligible";
};

/**
 * Central canonical gate. Fail-closed:
 * KILL_SWITCH=1 → OFF
 * ENABLED!=1 → OFF
 * ENABLED=1 + authenticated userId → ON
 *
 * User/character allowlists are intentionally not consulted (B1-D1).
 * characterId remains accepted for call-site compatibility but unused.
 */
export function resolveNumericCanonicalEligibility(input: {
  userId?: number | null;
  characterId?: number | null;
  env?: NodeJS.ProcessEnv;
}): NumericCanonicalEligibilityResult {
  const env = input.env ?? process.env;
  if (isTruthyEnvFlag(env[RP_NUMERIC_STATE_KILL_SWITCH_ENV])) {
    return { eligible: false, reason: "kill_switch" };
  }
  if (!isTruthyEnvFlag(env[RP_NUMERIC_STATE_ENABLED_ENV])) {
    return { eligible: false, reason: "flag_off" };
  }
  const userId = input.userId;
  if (userId == null || !Number.isSafeInteger(userId) || userId <= 0) {
    return { eligible: false, reason: "unauthenticated" };
  }
  return { eligible: true, reason: "eligible" };
}

export type CanonicalEligibleNumericField = {
  stateKey: string;
  valueKey: string;
  definition: ServerMeterNumericStateDefinitionV1;
  field: StatusWidgetField;
};

/**
 * Explicit opt-in fields only: valid numericState + pilot state key.
 * Does not invent meters from affection/trust/corruption names alone.
 */
export function listCanonicalEligibleNumericFields(
  characterWidget: StatusWidget | null | undefined
): CanonicalEligibleNumericField[] {
  if (!characterWidget?.fields?.length) return [];
  const out: CanonicalEligibleNumericField[] = [];
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

export function isPilotNumericCanonicalStateKey(stateKey: string): boolean {
  return PILOT_KEY_SET.has(String(stateKey ?? "").trim().toLowerCase());
}

/** Shared generation mutation id — one per assistant generation, all fields. */
export function buildNumericGenerationMutationId(input: {
  assistantMessageId: number;
  generationSequence: number;
  requestId?: string | null;
}): string {
  const req = String(input.requestId ?? "").trim() || "none";
  return `gen:${input.assistantMessageId}:${input.generationSequence}:${req}`;
}

export function buildNumericBootstrapMutationId(input: {
  chatId: number;
  stateKey: string;
  sourceKind: "definition_initial" | "legacy_bootstrap";
}): string {
  return `bootstrap:${input.chatId}:${input.stateKey}:${input.sourceKind}`;
}
