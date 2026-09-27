/**
 * User-owned STYLE-ONLY visual references for romance_fantasy (v3 proof identity).
 * Does not mutate romance_fantasy_v1 board DNA or romance_fantasy_v2 abstract seed history.
 */
import type { StyleReference } from "@/lib/officialSupply/types";
import { OFFICIAL_STYLE_GENERATION_REF_MAX } from "@/lib/officialSupply/style";

export const USER_OWNED_ROFAN_STYLE_BUNDLE_ID = "romance-fantasy-user-owned-v1";
export const USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT =
  `/official-supply/style-seeds/${USER_OWNED_ROFAN_STYLE_BUNDLE_ID}`;

/** New versioned style key for user-owned visual-ref proofs — leaves v1/v2 history intact. */
export const PILOT_STYLE_PROOF_V3_STYLE_KEY = "romance_fantasy_v3";
export const PILOT_STYLE_PROOF_V3_BATCH_KEY = "pilot-romance-fantasy-03-style-refs";

export const USER_OWNED_ROFAN_PRIMARY_GENERATION_PATHS = [
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/primary/p1-face-rendering.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/primary/p2-costume-material-female.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/primary/p3-lighting-composition.webp`,
] as const;

export const USER_OWNED_ROFAN_HOLDOUT_PATHS = [
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/holdout/h1-overhead-pov.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/holdout/h2-side-profile.webp`,
  `${USER_OWNED_ROFAN_STYLE_PUBLIC_ROOT}/holdout/h3-event-situation.webp`,
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

/**
 * Canonical style seed for v3: primary face anchor + up to 2 companion style-only refs.
 * Holdouts are intentionally omitted from generation input.
 */
export function buildUserOwnedRofanStyleSeed(env: NodeJS.ProcessEnv = process.env): StyleReference {
  const paths = USER_OWNED_ROFAN_PRIMARY_GENERATION_PATHS.slice(0, OFFICIAL_STYLE_GENERATION_REF_MAX);
  const [primaryPath, ...companionPaths] = paths;
  return {
    url: resolveHttpsPublicUrl(primaryPath, env),
    provenance: "platform_owned",
    note:
      "STYLE ONLY — user-authored original artwork contributed as rendering-language references. Do not copy face/hair/outfit/marks/pose/background identity from these images. Appearance Lock owns character identity.",
    styleOnlyVisualReferences: companionPaths.map((path, index) => ({
      url: resolveHttpsPublicUrl(path, env),
      provenance: "platform_owned" as const,
      note: `STYLE ONLY companion ${index + 1} (${USER_OWNED_ROFAN_STYLE_BUNDLE_ID}). Identity copy forbidden.`,
    })),
  };
}
