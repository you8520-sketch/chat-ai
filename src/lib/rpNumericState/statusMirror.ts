/**
 * Phase B1-C — Mirror server-authoritative afterValues into status widget payloads.
 */
import type { ServerMeterNumericStateDefinitionV1 } from "@/lib/statusWidget/types";
import type { ParsedStatusWidgetTurnValues, StatusWidgetValues } from "@/lib/statusWidget/types";
import type { CanonicalEligibleNumericField } from "./canonicalPolicy";
import { parseStrictNumericProposal } from "./reducer";

/**
 * Deterministic string form for status widget storage.
 * Integers stay "45" (never "45.0"). Decimals use JS number stringification
 * which already drops trailing .0 for whole values.
 */
export function formatCanonicalNumericStatusValue(
  value: number,
  definition: ServerMeterNumericStateDefinitionV1
): string {
  if (!Number.isFinite(value)) {
    throw new Error("formatCanonicalNumericStatusValue: non-finite value");
  }
  if (definition.integer) {
    return String(Math.trunc(value));
  }
  // Avoid scientific notation drift for ordinary meter ranges.
  if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-6)) {
    return value.toPrecision(12).replace(/\.?0+$/, "");
  }
  return String(value);
}

function lookupRawProposal(
  values: StatusWidgetValues | null | undefined,
  valueKey: string,
  stateKey: string
): string | number | null {
  if (!values) return null;
  const direct = values[valueKey];
  if (direct != null && String(direct).trim() !== "") return direct;
  const byState = values[stateKey];
  if (byState != null && String(byState).trim() !== "") return byState;
  return null;
}

export function readNumericProposalFromStatusPayload(
  payload: ParsedStatusWidgetTurnValues | null | undefined,
  field: CanonicalEligibleNumericField
): string | number | null {
  return lookupRawProposal(payload?.character ?? null, field.valueKey, field.stateKey);
}

export function readLegacyNumericBaselineFromStatusPayload(
  payload: ParsedStatusWidgetTurnValues | null | undefined,
  field: CanonicalEligibleNumericField
): number | null {
  const raw = lookupRawProposal(
    payload?.character ?? null,
    field.valueKey,
    field.stateKey
  );
  if (raw == null) return null;
  return parseStrictNumericProposal(raw, field.definition);
}

/**
 * Write server afterValues onto character status keys using fieldPlaceholderKey
 * semantics (valueKey). Clears bare field.id duplicates when distinct from valueKey.
 */
export function mirrorCanonicalNumericValuesIntoStatusPayload(
  payload: ParsedStatusWidgetTurnValues | null | undefined,
  fields: CanonicalEligibleNumericField[],
  afterByStateKey: Record<string, number>
): ParsedStatusWidgetTurnValues {
  const base: ParsedStatusWidgetTurnValues = payload
    ? {
        character: payload.character ? { ...payload.character } : {},
        user: payload.user ?? null,
        ...(payload.extracted_facts?.length
          ? { extracted_facts: payload.extracted_facts }
          : {}),
      }
    : { character: {}, user: null };

  const character: StatusWidgetValues = { ...(base.character ?? {}) };

  for (const field of fields) {
    const after = afterByStateKey[field.stateKey];
    if (after == null || !Number.isFinite(after)) continue;
    const formatted = formatCanonicalNumericStatusValue(after, field.definition);
    const valueKey = field.valueKey;
    if (field.field.id && field.field.id !== valueKey) {
      delete character[field.field.id];
    }
    character[valueKey] = formatted;
  }

  return {
    ...base,
    character,
  };
}

/** True when incoming patch changes any canonical numeric field value. */
export function numericCanonicalFieldsChanged(
  existing: ParsedStatusWidgetTurnValues | null | undefined,
  incoming: ParsedStatusWidgetTurnValues | null | undefined,
  fields: CanonicalEligibleNumericField[]
): boolean {
  if (!fields.length) return false;
  for (const field of fields) {
    const before = lookupRawProposal(
      existing?.character ?? null,
      field.valueKey,
      field.stateKey
    );
    const after = lookupRawProposal(
      incoming?.character ?? null,
      field.valueKey,
      field.stateKey
    );
    const beforeNorm = before == null ? "" : String(before).trim();
    const afterNorm = after == null ? "" : String(after).trim();
    if (beforeNorm !== afterNorm) return true;
  }
  return false;
}
