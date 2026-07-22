import { compileCanonPlanV1 } from "@/lib/canonPlan/compiler";
import { hashCanonSource } from "@/lib/canonPlan/hash";
import { parseCanonPlanV1, serializeCanonPlanV1 } from "@/lib/canonPlan/serialize";
import type { CanonPlanV1 } from "@/lib/canonPlan/types";

export type CanonPlanSaveResult = {
  planJson: string | null;
  plan: CanonPlanV1 | null;
  reusedExisting: boolean;
  compiled: boolean;
  error?: string;
};

export function buildCanonPlanForSave(opts: {
  creatorRawDescription: string;
  compilerDescription?: string;
  existingPlanJson?: string | null;
  now?: string;
}): CanonPlanSaveResult {
  const existing = parseCanonPlanV1(opts.existingPlanJson);
  const sourceHash = hashCanonSource(opts.creatorRawDescription);

  if (existing && existing.sourceHash === sourceHash) {
    return {
      planJson: serializeCanonPlanV1(existing),
      plan: existing,
      reusedExisting: true,
      compiled: false,
    };
  }

  const compiled = compileCanonPlanV1({
    creatorRawDescription: opts.creatorRawDescription,
    compilerDescription: opts.compilerDescription,
    now: opts.now,
  });

  if (!compiled.ok) {
    if (existing) {
      return {
        planJson: serializeCanonPlanV1(existing),
        plan: existing,
        reusedExisting: true,
        compiled: false,
        error: compiled.error,
      };
    }
    return {
      planJson: null,
      plan: null,
      reusedExisting: false,
      compiled: false,
      error: compiled.error,
    };
  }

  return {
    planJson: serializeCanonPlanV1(compiled.plan),
    plan: compiled.plan,
    reusedExisting: false,
    compiled: true,
  };
}

export function resolveStoredCanonPlan(row: {
  creator_canon_plan_json?: string | null;
  creator_raw_description?: string | null;
}): CanonPlanV1 | null {
  const parsed = parseCanonPlanV1(row.creator_canon_plan_json);
  if (!parsed) return null;
  const raw = row.creator_raw_description?.trim();
  if (!raw) return parsed;
  if (hashCanonSource(raw) !== parsed.sourceHash) return null;
  return parsed;
}
