import { createHash } from "node:crypto";
import type { ServerMeterNumericStateDefinitionV1 } from "./types";

/** Stable server-only fingerprint for event audit (compact — not full definition JSON). */
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
