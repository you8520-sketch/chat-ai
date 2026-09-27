import type { OfficialSupplyBatchConfig } from "@/lib/officialSupply/store";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";
import { PILOT_STYLE_PROOF_CANDIDATE_ID, PILOT_STYLE_PROOF_SOURCE_DRAFT_KEYS, PILOT_STYLE_PROOF_SOURCE_STYLE_KEY } from "@/lib/officialSupply/pilotStyleProof";
import {
  buildClusterBRofanStyleSeed,
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";

export {
  buildClusterBRofanStyleSeed,
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
};

/**
 * Hydrate the full canonical 10-character pilot batch so portfolio QA keeps the
 * same meaning as v2/v3. Paid style proof generation remains bounded separately
 * by PILOT_CLUSTER_B_PROOF_DRAFT_KEYS (01/02/09 only).
 */
export const PILOT_CLUSTER_B_PROOF_SOURCE_DRAFT_KEYS =
  PILOT_STYLE_PROOF_SOURCE_DRAFT_KEYS;

export function pilotClusterBStyleProofDraftKey(sourceDraftKey: string): string {
  const match = /^pilot-rf-(\d{2})$/.exec(sourceDraftKey);
  if (!match) throw new Error(`unexpected pilot source draft key ${sourceDraftKey}`);
  return `pilot-rf-v4-${match[1]}`;
}

export const PILOT_CLUSTER_B_PROOF_DRAFT_KEYS = [
  pilotClusterBStyleProofDraftKey("pilot-rf-01"),
  pilotClusterBStyleProofDraftKey("pilot-rf-02"),
  pilotClusterBStyleProofDraftKey("pilot-rf-09"),
] as const;

export const PILOT_CLUSTER_B_PROOF_SLOT_KEY = "rep";
export const PILOT_CLUSTER_B_PROOF_ASSET_LIMIT = PILOT_CLUSTER_B_PROOF_DRAFT_KEYS.length;
export const PILOT_CLUSTER_B_PROOF_LIVE_ENV = "OFFICIAL_STYLE_PROOF_LIVE";
export const PILOT_CLUSTER_B_PROOF_CANDIDATE_ENV = "OFFICIAL_STYLE_PROOF_CANDIDATE";

export function buildPilotClusterBStyleProofDraft(
  source: OfficialCharacterDraft
): OfficialCharacterDraft {
  if (source.styleKey !== PILOT_STYLE_PROOF_SOURCE_STYLE_KEY) {
    throw new Error(
      `source draft ${source.draftKey} style=${source.styleKey}; expected ${PILOT_STYLE_PROOF_SOURCE_STYLE_KEY}`
    );
  }
  return {
    ...source,
    draftKey: pilotClusterBStyleProofDraftKey(source.draftKey),
    styleKey: PILOT_STYLE_PROOF_V4_STYLE_KEY,
  };
}

export const PILOT_CLUSTER_B_PROOF_BATCH_CONFIG: OfficialSupplyBatchConfig = {
  rollout: { maxWorlds: 1, maxCharacters: 10 },
  budgetUsd: {
    batch: 3,
    perGenre: 3,
    perWorld: 3,
    perCharacter: 1,
  },
  reservePerImageUsd: 1,
  maxAttemptsPerSlot: 1,
  leaseMs: 20 * 60 * 1000,
  quality: "medium",
  portfolio: {
    adultShareMin: 0.3,
    adultShareMax: 0.5,
    maxGenreShare: 1,
    minDistinctGenres: 1,
  },
};

export function pilotClusterBStyleProofOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[PILOT_CLUSTER_B_PROOF_LIVE_ENV] === "1" &&
    env[PILOT_CLUSTER_B_PROOF_CANDIDATE_ENV] === PILOT_STYLE_PROOF_CANDIDATE_ID
  );
}
