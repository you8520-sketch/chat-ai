import "server-only";

import {
  recordBackgroundProviderCost,
  type ProviderCostCenter,
} from "@/lib/providerCostLedger";
import type { VisionCostEvidence } from "@/lib/vision";

/**
 * Server-side persistence owner for asset-vision spend. vision.ts stays a
 * pure invocation/parsing module; this module bridges its usage witnesses
 * into the canonical provider ledger (called from the assets/tag route).
 */
export function recordVisionCostAttempts(attempts: VisionCostEvidence[]): void {
  for (const attempt of attempts) {
    try {
      recordBackgroundProviderCost({
        provider: "openrouter",
        model: attempt.model,
        requestKind: "background-asset-vision",
        costCenter: "asset" satisfies ProviderCostCenter,
        inputTokens: attempt.inputTokens,
        outputTokens: attempt.outputTokens,
        cheaperInferenceBilledCostUsd: attempt.cheaperInferenceBilledCostUsd,
        upstreamCostUsd: attempt.upstreamCostUsd,
        usageEstimated: attempt.usageEstimated,
        providerRequestId: attempt.providerRequestId,
        outcome: attempt.outcome,
      });
    } catch (error) {
      console.warn("[vision-cost] record skipped:", (error as Error).message);
    }
  }
}
