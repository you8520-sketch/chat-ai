import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
import { TRPG_SCENARIO_PLAN_SCHEMA_VERSION } from "./scenarioPlan";
import type { TrpgWorldSnapshot } from "./campaignContext";

/**
 * Bump when sandbox Blueprint prompt contract, output schema expectations, or
 * generation semantics change (#741-like). Not for model-only swaps — those are
 * tracked via generatorModel on the validity record.
 */
export const TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION = 1;

export type BlueprintGenerationValidity = {
  sourceFingerprint: string;
  derivationVersion: number;
  generatorModel: string;
  schemaVersion: string;
};

export function currentBlueprintGenerationValidity(
  snapshot: Pick<TrpgWorldSnapshot, "sourceFingerprint">
): BlueprintGenerationValidity {
  return {
    sourceFingerprint: snapshot.sourceFingerprint,
    derivationVersion: TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION,
    generatorModel: TRPG_SCENARIO_DRAFT_MODEL,
    schemaVersion: TRPG_SCENARIO_PLAN_SCHEMA_VERSION,
  };
}

export function blueprintGenerationValidityFromRow(row: {
  source_fingerprint: string;
  derivation_version: number;
  generator_model: string;
  schema_version: string;
}): BlueprintGenerationValidity {
  return {
    sourceFingerprint: row.source_fingerprint,
    derivationVersion: row.derivation_version,
    generatorModel: row.generator_model,
    schemaVersion: row.schema_version,
  };
}

/** Single canonical validity predicate for stored world Blueprint artifacts. */
export function isStoredBlueprintValidForCurrentGeneration(
  stored: BlueprintGenerationValidity,
  snapshot: Pick<TrpgWorldSnapshot, "sourceFingerprint">
): boolean {
  const current = currentBlueprintGenerationValidity(snapshot);
  return (
    stored.sourceFingerprint === current.sourceFingerprint &&
    stored.derivationVersion === current.derivationVersion &&
    stored.generatorModel === current.generatorModel &&
    stored.schemaVersion === current.schemaVersion
  );
}
