import type Database from "better-sqlite3";

import {
  buildCanonPlanForSave,
  resolveStoredCanonPlan,
} from "@/lib/canonPlan/compileForSave";
import { hashCanonSource } from "@/lib/canonPlan/hash";
import { parseCanonPlanV1, serializeCanonPlanV1 } from "@/lib/canonPlan/serialize";
import type { CanonPlanV1 } from "@/lib/canonPlan/types";

export type CanonCompileSource = "existing" | "save" | "lazy" | "fallback";

export type SourceHashStatus = "match" | "mismatch" | "missing_raw" | "missing_plan";

export type LazyCompileResult = {
  plan: CanonPlanV1 | null;
  compileSource: CanonCompileSource;
  sourceHash: string;
  sourceHashStatus: SourceHashStatus;
  reusedExisting: boolean;
  compiled: boolean;
  persisted: boolean;
  technicalFallbackEligible: boolean;
  error?: string;
};

export type CharacterCanonPlanRow = {
  creator_raw_description?: string | null;
  creator_canon_plan_json?: string | null;
  world?: string | null;
  system_prompt?: string | null;
};

/** In-process guard — prevents duplicate compile work within one Node process turn. */
const compileInFlight = new Set<number>();

export function buildLazyCompileInputs(row: CharacterCanonPlanRow): {
  creatorRawDescription: string;
  compilerDescription: string;
} {
  const creatorRawDescription = row.creator_raw_description?.trim() ?? "";
  const compilerDescription = [row.world, row.system_prompt]
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
  return { creatorRawDescription, compilerDescription };
}

function resolveSourceHashStatus(
  row: CharacterCanonPlanRow,
  sourceHash: string,
  storedPlan: CanonPlanV1 | null,
  parsedPlan: CanonPlanV1 | null
): SourceHashStatus {
  const raw = row.creator_raw_description?.trim();
  if (!raw) return "missing_raw";
  if (storedPlan && storedPlan.sourceHash === sourceHash) return "match";
  if (parsedPlan) return "mismatch";
  return "missing_plan";
}

function readStoredPlanJson(
  db: Database.Database,
  characterId: number
): string | null {
  const row = db
    .prepare("SELECT creator_canon_plan_json FROM characters WHERE id = ?")
    .get(characterId) as { creator_canon_plan_json?: string | null } | undefined;
  const json = row?.creator_canon_plan_json?.trim();
  return json || null;
}

function tryPersistPlanJson(
  db: Database.Database,
  characterId: number,
  planJson: string,
  expectedPreviousJson: string | null
): boolean {
  const parsed = parseCanonPlanV1(planJson);
  if (!parsed) return false;

  if (expectedPreviousJson === null) {
    const result = db
      .prepare(
        `UPDATE characters
         SET creator_canon_plan_json = ?
         WHERE id = ?
           AND (creator_canon_plan_json IS NULL OR TRIM(creator_canon_plan_json) = '')`
      )
      .run(planJson, characterId);
    return result.changes > 0;
  }

  const result = db
    .prepare(
      `UPDATE characters
       SET creator_canon_plan_json = ?
       WHERE id = ?
         AND (creator_canon_plan_json IS NULL OR TRIM(creator_canon_plan_json) = '' OR creator_canon_plan_json = ?)`
    )
    .run(planJson, characterId, expectedPreviousJson);
  return result.changes > 0;
}

function resultFromStoredRow(
  row: CharacterCanonPlanRow,
  sourceHash: string,
  compileSource: CanonCompileSource
): LazyCompileResult {
  const parsedPlan = parseCanonPlanV1(row.creator_canon_plan_json);
  const plan = resolveStoredCanonPlan(row);
  const sourceHashStatus = resolveSourceHashStatus(row, sourceHash, plan, parsedPlan);
  return {
    plan,
    compileSource,
    sourceHash,
    sourceHashStatus,
    reusedExisting: true,
    compiled: false,
    persisted: false,
    technicalFallbackEligible: !plan,
  };
}

/**
 * First chat access lazy compile — persists once when plan is NULL or source hash stale.
 * Does not modify creator_raw_description or compiled description columns.
 */
export function ensureCanonPlanOnAccess(
  db: Database.Database,
  characterId: number,
  row: CharacterCanonPlanRow
): LazyCompileResult {
  if (compileInFlight.has(characterId)) {
    const freshJson = readStoredPlanJson(db, characterId);
    const freshRow = { ...row, creator_canon_plan_json: freshJson };
    const { creatorRawDescription } = buildLazyCompileInputs(freshRow);
    const sourceHash = hashCanonSource(creatorRawDescription);
    return resultFromStoredRow(freshRow, sourceHash, "lazy");
  }

  compileInFlight.add(characterId);
  try {
    const { creatorRawDescription, compilerDescription } = buildLazyCompileInputs(row);
    const sourceHash = hashCanonSource(creatorRawDescription);
    const parsedPlan = parseCanonPlanV1(row.creator_canon_plan_json);
    const storedPlan = resolveStoredCanonPlan(row);
    const sourceHashStatus = resolveSourceHashStatus(row, sourceHash, storedPlan, parsedPlan);

    if (storedPlan && storedPlan.sourceHash === sourceHash) {
      return {
        plan: storedPlan,
        compileSource: "existing",
        sourceHash,
        sourceHashStatus: "match",
        reusedExisting: true,
        compiled: false,
        persisted: false,
        technicalFallbackEligible: false,
      };
    }

    if (!creatorRawDescription.trim()) {
      return {
        plan: storedPlan,
        compileSource: storedPlan ? "existing" : "fallback",
        sourceHash,
        sourceHashStatus: "missing_raw",
        reusedExisting: !!storedPlan,
        compiled: false,
        persisted: false,
        technicalFallbackEligible: !storedPlan,
        error: storedPlan ? undefined : "creator_raw_description empty",
      };
    }

    const previousJson = row.creator_canon_plan_json?.trim() || null;
    const saveResult = buildCanonPlanForSave({
      creatorRawDescription,
      compilerDescription,
      existingPlanJson: previousJson,
    });

    if (!saveResult.planJson) {
      return {
        plan: saveResult.plan ?? storedPlan,
        compileSource: saveResult.plan || storedPlan ? "existing" : "fallback",
        sourceHash,
        sourceHashStatus,
        reusedExisting: saveResult.reusedExisting,
        compiled: false,
        persisted: false,
        technicalFallbackEligible: !(saveResult.plan ?? storedPlan),
        error: saveResult.error,
      };
    }

    const persisted = tryPersistPlanJson(
      db,
      characterId,
      saveResult.planJson,
      previousJson
    );

    if (!persisted) {
      const racedJson = readStoredPlanJson(db, characterId);
      if (racedJson) {
        const racedRow = { ...row, creator_canon_plan_json: racedJson };
        const racedPlan = resolveStoredCanonPlan(racedRow);
        if (racedPlan && racedPlan.sourceHash === sourceHash) {
          return resultFromStoredRow(racedRow, sourceHash, "lazy");
        }
      }
    }

    const finalPlan = saveResult.plan ?? parseCanonPlanV1(saveResult.planJson);
    return {
      plan: finalPlan,
      compileSource: "lazy",
      sourceHash,
      sourceHashStatus: storedPlan || parsedPlan ? "mismatch" : "missing_plan",
      reusedExisting: false,
      compiled: saveResult.compiled,
      persisted,
      technicalFallbackEligible: !finalPlan,
      error: saveResult.error,
    };
  } finally {
    compileInFlight.delete(characterId);
  }
}

/** Test helper — reset in-process compile guard between isolated cases. */
export function resetLazyCompileInFlightForTests(): void {
  compileInFlight.clear();
}
