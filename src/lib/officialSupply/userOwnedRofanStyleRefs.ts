/**
 * User-owned STYLE-ONLY visual references for romance_fantasy proofs.
 * v3 bundle (legacy primary set) and v4 Cluster B bundle are separate — never mutate v1/v2 board history.
 */
import type { StyleReference } from "@/lib/officialSupply/types";
import {
  OFFICIAL_STYLE_GENERATION_REF_MAX,
  validateClusterBStyleSeedForApproval,
  validateStyleSeedForApproval,
} from "@/lib/officialSupply/style";

export const USER_OWNED_ROFAN_STYLE_BUNDLE_ID = "romance-fantasy-user-owned-v1";
export const USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT =
  `/official-supply/style-seeds/${USER_OWNED_ROFAN_STYLE_BUNDLE_ID}`;

/** v3 proof identity — Cluster A–leaning legacy primary set (immutable history). */
export const PILOT_STYLE_PROOF_V3_STYLE_KEY = "romance_fantasy_v3";
export const PILOT_STYLE_PROOF_V3_BATCH_KEY = "pilot-romance-fantasy-03-style-refs";

export const USER_OWNED_ROFAN_PRIMARY_STYLE_PATH =
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/primary/p1-face-rendering.webp`;
export const USER_OWNED_ROFAN_COMPANION_STYLE_PATHS = [
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/primary/p2-costume-material-female.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/primary/p3-lighting-composition.webp`,
] as const;

/** Representative generation list: explicit primary + companions. Not an ownership index. */
export const USER_OWNED_ROFAN_PRIMARY_GENERATION_PATHS = [
  USER_OWNED_ROFAN_PRIMARY_STYLE_PATH,
  ...USER_OWNED_ROFAN_COMPANION_STYLE_PATHS,
] as const;

export const USER_OWNED_ROFAN_HOLDOUT_PATHS = [
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/holdout/h1-overhead-pov.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/holdout/h2-side-profile.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/holdout/h3-event-situation.webp`,
] as const;

/** v4 proof identity — graphic Cluster B webtoon target. */
export const CLUSTER_B_ROFAN_STYLE_BUNDLE_ID = "romance-fantasy-cluster-b-v1";
export const CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT =
  `/official-supply/style-seeds/${CLUSTER_B_ROFAN_STYLE_BUNDLE_ID}`;

export const PILOT_STYLE_PROOF_V4_STYLE_KEY = "romance_fantasy_v4";
export const PILOT_STYLE_PROOF_V4_BATCH_KEY = "pilot-romance-fantasy-04-cluster-b";

/** Approved Cluster B primary STYLE root — Image 2 for non-representative slots. */
export const CLUSTER_B_PRIMARY_STYLE_PATH =
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/primary/b7-black-gold-uniform.webp`;
export const CLUSTER_B_PRIMARY_STYLE_FILE_MARKER =
  "romance-fantasy-cluster-b-v1/primary/b7-black-gold-uniform";

/** Additional STYLE companions for representative generation only. */
export const CLUSTER_B_COMPANION_STYLE_PATHS = [
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/primary/b13-black-red-fur.webp`,
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/primary/b5-red-dress-female.webp`,
] as const;

/**
 * Representative generation set: explicit primary + companions.
 * Do not select the primary by reading this list at `[0]`.
 */
export const CLUSTER_B_PRIMARY_GENERATION_PATHS = [
  CLUSTER_B_PRIMARY_STYLE_PATH,
  ...CLUSTER_B_COMPANION_STYLE_PATHS,
] as const;

export const CLUSTER_B_PRIMARY_CATALOG_PATHS = [
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/primary/b3-blue-window-full.webp`,
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/primary/b17-sword-flowers.webp`,
] as const;

export const CLUSTER_B_HOLDOUT_PATHS = [
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/holdout/b6-black-gold-smirk.webp`,
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/holdout/b10-moon-scene.webp`,
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/holdout/b11-purple-armor.webp`,
  `${CLUSTER_B_ROFAN_STYLE_PUBLIC_ROOT}/holdout/b14-red-eyes-profile.webp`,
] as const;

function resolveHttpsPublicUrl(path: string, env: NodeJS.ProcessEnv): string {
  const rawBase =
    env.NEXTAUTH_URL?.trim() ||
    env.RAILWAY_STATIC_URL?.trim() ||
    (env.RAILWAY_PUBLIC_DOMAIN?.trim() ? `https://${env.RAILWAY_PUBLIC_DOMAIN.trim()}` : "");
  if (!rawBase) {
    throw new Error(
      "user-owned style refs require NEXTAUTH_URL, RAILWAY_STATIC_URL, or RAILWAY_PUBLIC_DOMAIN"
    );
  }
  const base = rawBase.startsWith("http://") || rawBase.startsWith("https://") ? rawBase : `https://${rawBase}`;
  const url = new URL(path, base);
  if (url.protocol !== "https:") {
    throw new Error("official style references must be served over https");
  }
  return url.toString();
}

export function isOfficialClusterBPrimaryStyleRef(value: string): boolean {
  return value.includes(CLUSTER_B_PRIMARY_STYLE_FILE_MARKER);
}

function buildOfficialStyleSeed(input: {
  primaryPath: string;
  companionPaths: readonly string[];
  env: NodeJS.ProcessEnv;
  styleCluster?: StyleReference["styleCluster"];
  note: string;
  bundleId: string;
}): StyleReference {
  const primaryPath = input.primaryPath.trim();
  if (!primaryPath) {
    throw new Error("official style seed requires an explicit primary style path");
  }
  const companions = input.companionPaths
    .map((path) => path.trim())
    .filter(Boolean)
    .slice(0, OFFICIAL_STYLE_GENERATION_REF_MAX - 1);
  return {
    url: resolveHttpsPublicUrl(primaryPath, input.env),
    provenance: "platform_owned",
    styleCluster: input.styleCluster,
    note: input.note,
    styleOnlyVisualReferences: companions.map((path, index) => ({
      url: resolveHttpsPublicUrl(path, input.env),
      provenance: "platform_owned" as const,
      note: `STYLE ONLY companion ${index + 1} (${input.bundleId}). Identity copy forbidden.`,
    })),
  };
}

/** v3 seed (legacy bundle — do not use for new Cluster B proofs). */
export function buildUserOwnedRofanStyleSeed(env: NodeJS.ProcessEnv = process.env): StyleReference {
  return buildOfficialStyleSeed({
    primaryPath: USER_OWNED_ROFAN_PRIMARY_STYLE_PATH,
    companionPaths: USER_OWNED_ROFAN_COMPANION_STYLE_PATHS,
    env,
    note:
      "STYLE ONLY — user-authored original artwork (v3 bundle). Do not copy face/hair/outfit/marks/pose/background identity. Appearance Lock owns character identity.",
    bundleId: USER_OWNED_ROFAN_STYLE_BUNDLE_ID,
  });
}

/** v4 Cluster B graphic webtoon seed — canonical target for recalibrated proofs. */
export function buildClusterBRofanStyleSeed(env: NodeJS.ProcessEnv = process.env): StyleReference {
  const seed = buildOfficialStyleSeed({
    primaryPath: CLUSTER_B_PRIMARY_STYLE_PATH,
    companionPaths: CLUSTER_B_COMPANION_STYLE_PATHS,
    env,
    styleCluster: "cluster_b_graphic",
    note:
      "STYLE ONLY — Cluster B graphic domestic rofan webtoon references (v4 bundle). Crisp lines, high contrast, saturated accents. Never copy reference identity; Appearance Lock wins.",
    bundleId: CLUSTER_B_ROFAN_STYLE_BUNDLE_ID,
  });
  const err = validateClusterBStyleSeedForApproval(seed);
  if (err) throw new Error(err);
  return seed;
}

export { validateStyleSeedForApproval, validateClusterBStyleSeedForApproval };
