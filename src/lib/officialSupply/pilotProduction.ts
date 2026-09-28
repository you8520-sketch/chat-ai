import { PILOT_STYLE_PROOF_BATCH_CONFIG } from "@/lib/officialSupply/pilotStyleProof";
import type { OfficialSupplyBatchConfig } from "@/lib/officialSupply/store";

/**
 * Canonical post-STYLE_LOCK production limits for the approved romance-fantasy
 * pilot. These are internal safety ceilings, not provider pricing or user billing.
 */
export const ROFAN_V4_PRODUCTION_BATCH_CONFIG: OfficialSupplyBatchConfig = {
  ...PILOT_STYLE_PROOF_BATCH_CONFIG,
  budgetUsd: {
    batch: 20,
    perGenre: 20,
    perWorld: 20,
    perCharacter: 2.5,
  },
  reservePerImageUsd: 0.12,
  maxAttemptsPerSlot: 2,
};
