import type { OfficialSupplyBatchConfig } from "@/lib/officialSupply/store";
import type { OfficialCharacterDraft, StyleReference } from "@/lib/officialSupply/types";

export const PILOT_STYLE_PROOF_BATCH_KEY = "pilot-romance-fantasy-02-style-proof";
export const PILOT_STYLE_PROOF_SOURCE_STYLE_KEY = "romance_fantasy_v1";
export const PILOT_STYLE_PROOF_STYLE_KEY = "romance_fantasy_v2";
export const PILOT_STYLE_PROOF_CANDIDATE_ID = "rf-02";

export const PILOT_STYLE_PROOF_SOURCE_DRAFT_KEYS = Array.from(
  { length: 10 },
  (_, index) => `pilot-rf-${String(index + 1).padStart(2, "0")}`
) as readonly string[];

export function pilotStyleProofDraftKey(sourceDraftKey: string): string {
  const match = /^pilot-rf-(\d{2})$/.exec(sourceDraftKey);
  if (!match) throw new Error(`unexpected pilot source draft key ${sourceDraftKey}`);
  return `pilot-rf-v2-${match[1]}`;
}

export const PILOT_STYLE_PROOF_DRAFT_KEYS = [
  pilotStyleProofDraftKey("pilot-rf-01"),
  pilotStyleProofDraftKey("pilot-rf-02"),
  pilotStyleProofDraftKey("pilot-rf-09"),
] as const;

export const PILOT_STYLE_PROOF_SLOT_KEY = "rep";
export const PILOT_STYLE_PROOF_ASSET_LIMIT = PILOT_STYLE_PROOF_DRAFT_KEYS.length;
export const PILOT_STYLE_PROOF_LIVE_ENV = "OFFICIAL_STYLE_PROOF_LIVE";
export const PILOT_STYLE_PROOF_CANDIDATE_ENV = "OFFICIAL_STYLE_PROOF_CANDIDATE";
export const PILOT_STYLE_SEED_PATH =
  "/official-supply/style-seeds/romance-fantasy-rf-02-v2.svg";

/**
 * Version the execution identity without cloning the committed character content.
 * The source bible/appearance/asset plan remain canonical in the existing pilot files;
 * only the supply-pipeline draft/style identifiers change for the v2 proof run.
 */
export function buildPilotStyleProofDraft(
  source: OfficialCharacterDraft
): OfficialCharacterDraft {
  if (source.styleKey !== PILOT_STYLE_PROOF_SOURCE_STYLE_KEY) {
    throw new Error(
      `source draft ${source.draftKey} style=${source.styleKey}; expected ${PILOT_STYLE_PROOF_SOURCE_STYLE_KEY}`
    );
  }
  return {
    ...source,
    draftKey: pilotStyleProofDraftKey(source.draftKey),
    styleKey: PILOT_STYLE_PROOF_STYLE_KEY,
  };
}

export const PILOT_STYLE_PROOF_BATCH_CONFIG: OfficialSupplyBatchConfig = {
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

export function pilotStyleProofOptedIn(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[PILOT_STYLE_PROOF_LIVE_ENV] === "1" &&
    env[PILOT_STYLE_PROOF_CANDIDATE_ENV] === PILOT_STYLE_PROOF_CANDIDATE_ID
  );
}

export function resolvePilotStyleSeedUrl(env: NodeJS.ProcessEnv = process.env): string {
  const rawBase =
    env.NEXTAUTH_URL?.trim() ||
    env.RAILWAY_STATIC_URL?.trim() ||
    (env.RAILWAY_PUBLIC_DOMAIN?.trim()
      ? `https://${env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : "");
  if (!rawBase) {
    throw new Error(
      "official style proof requires NEXTAUTH_URL, RAILWAY_STATIC_URL, or RAILWAY_PUBLIC_DOMAIN"
    );
  }
  const base = rawBase.startsWith("http://") || rawBase.startsWith("https://")
    ? rawBase
    : `https://${rawBase}`;
  const url = new URL(PILOT_STYLE_SEED_PATH, base);
  if (url.protocol !== "https:") {
    throw new Error("official style seed must be served over https");
  }
  return url.toString();
}

export function buildPilotStyleSeed(
  env: NodeJS.ProcessEnv = process.env
): StyleReference {
  return {
    url: resolvePilotStyleSeedUrl(env),
    provenance: "platform_owned",
    note:
      "Original platform-authored abstract v2 court-lighting/palette seed. It contains no external artwork, artist imitation target, character identity, logo, or watermark.",
  };
}
