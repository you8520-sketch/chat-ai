/**
 * Phase B1-A — Server-meter numeric state definition (opt-in only).
 *
 * Invalid definitions normalize to null so legacy characters stay unchanged.
 * No runtime RP wiring in B1-A.
 */
import { createHash } from "node:crypto";
import type { ServerMeterNumericStateDefinitionV1 } from "./types";

export const NUMERIC_STATE_POLICY_VERSION = 1 as const;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isSafeIntegerNumber(v: number): boolean {
  return Number.isSafeInteger(v);
}

/**
 * Normalize a raw `numericState` blob into a validated V1 server_meter definition.
 * Returns null for absent / invalid input (never throws for bad creator JSON).
 */
export function normalizeNumericStateDefinition(
  raw: unknown
): ServerMeterNumericStateDefinitionV1 | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (o.version !== 1) return null;
  if (o.mode !== "server_meter") return null;
  if (typeof o.integer !== "boolean") return null;

  if (!isFiniteNumber(o.min) || !isFiniteNumber(o.max) || !isFiniteNumber(o.initial)) {
    return null;
  }
  if (o.min > o.max) return null;
  if (o.initial < o.min || o.initial > o.max) return null;

  let maxIncreasePerTurn: number | undefined;
  if ("maxIncreasePerTurn" in o && o.maxIncreasePerTurn !== undefined) {
    if (!isFiniteNumber(o.maxIncreasePerTurn) || o.maxIncreasePerTurn < 0) return null;
    maxIncreasePerTurn = o.maxIncreasePerTurn;
  }

  let maxDecreasePerTurn: number | undefined;
  if ("maxDecreasePerTurn" in o && o.maxDecreasePerTurn !== undefined) {
    if (!isFiniteNumber(o.maxDecreasePerTurn) || o.maxDecreasePerTurn < 0) return null;
    maxDecreasePerTurn = o.maxDecreasePerTurn;
  }

  let manualEditable: boolean | undefined;
  if ("manualEditable" in o && o.manualEditable !== undefined) {
    if (typeof o.manualEditable !== "boolean") return null;
    manualEditable = o.manualEditable;
  }

  if (o.integer) {
    if (
      !isSafeIntegerNumber(o.min) ||
      !isSafeIntegerNumber(o.max) ||
      !isSafeIntegerNumber(o.initial)
    ) {
      return null;
    }
    if (maxIncreasePerTurn != null && !isSafeIntegerNumber(maxIncreasePerTurn)) {
      return null;
    }
    if (maxDecreasePerTurn != null && !isSafeIntegerNumber(maxDecreasePerTurn)) {
      return null;
    }
  }

  const out: ServerMeterNumericStateDefinitionV1 = {
    version: 1,
    mode: "server_meter",
    min: o.min,
    max: o.max,
    initial: o.initial,
    integer: o.integer,
  };
  if (maxIncreasePerTurn != null) out.maxIncreasePerTurn = maxIncreasePerTurn;
  if (maxDecreasePerTurn != null) out.maxDecreasePerTurn = maxDecreasePerTurn;
  if (manualEditable != null) out.manualEditable = manualEditable;
  return out;
}

/** Stable fingerprint for event audit (compact — not full definition JSON). */
export function fingerprintNumericStateDefinition(
  definition: ServerMeterNumericStateDefinitionV1
): string {
  const stable = {
    version: definition.version,
    mode: definition.mode,
    min: definition.min,
    max: definition.max,
    initial: definition.initial,
    integer: definition.integer,
    maxIncreasePerTurn: definition.maxIncreasePerTurn ?? null,
    maxDecreasePerTurn: definition.maxDecreasePerTurn ?? null,
    manualEditable: definition.manualEditable ?? null,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
