import type { OfficialReferenceRoleLayout } from "@/lib/officialSupply/imagePrompt";
import {
  isClusterBGraphicStyleSeed,
  isGenerationSafeReference,
  resolveOfficialStyleGenerationReferences,
  validateClusterBStyleSeedForApproval,
} from "@/lib/officialSupply/style";
import type { OfficialAssetSlotKind, StyleReference } from "@/lib/officialSupply/types";
import { isOfficialClusterBPrimaryStyleRef } from "@/lib/officialSupply/userOwnedRofanStyleRefs";

export type OfficialGenerationReferencePlan =
  | {
      mode: "representative_style_only";
      references: string[];
      referenceRoleLayout: "slot_default";
    }
  | {
      mode: "variation_identity_anchor";
      references: readonly [string];
      referenceRoleLayout: "slot_default";
    }
  | {
      mode: "variation_identity_then_style";
      references: readonly [string, string];
      referenceRoleLayout: "identity_then_style";
    };

export type OfficialGenerationReferencePlanFailure = {
  ok: false;
  reason: string;
  code:
    | "missing_identity"
    | "missing_style_root"
    | "unsafe_style_root"
    | "invalid_cluster_b_seed"
    | "missing_style_seed";
};

export type OfficialGenerationReferencePlanResult =
  | { ok: true; plan: OfficialGenerationReferencePlan }
  | OfficialGenerationReferencePlanFailure;

export type OfficialGenerationReferenceInput = {
  kind: OfficialAssetSlotKind;
  styleSeed: StyleReference | null | undefined;
  representativeUrl: string | null | undefined;
};

/**
 * The one STYLE URL a Cluster B non-representative slot may send.
 * Companions stay on the representative path only.
 */
export function resolveOfficialClusterBVariationStyleUrl(
  seed: StyleReference | null | undefined
): { ok: true; url: string } | { ok: false; reason: string; code: OfficialGenerationReferencePlanFailure["code"] } {
  if (!seed) {
    return { ok: false, reason: "Cluster B variation requires an approved style seed", code: "missing_style_seed" };
  }
  if (!isClusterBGraphicStyleSeed(seed)) {
    return { ok: false, reason: "style seed is not Cluster B graphic", code: "invalid_cluster_b_seed" };
  }
  const url = seed.url.trim();
  if (!url) {
    return { ok: false, reason: "Cluster B styleSeed.url is required as the primary STYLE root", code: "missing_style_root" };
  }
  if (!isGenerationSafeReference(seed)) {
    return { ok: false, reason: "Cluster B styleSeed.url must be platform-owned or licensed", code: "unsafe_style_root" };
  }
  const clusterError = validateClusterBStyleSeedForApproval(seed);
  if (clusterError) {
    return { ok: false, reason: clusterError, code: "invalid_cluster_b_seed" };
  }
  if (!isOfficialClusterBPrimaryStyleRef(url)) {
    return {
      ok: false,
      reason: "Cluster B styleSeed.url must be the approved primary STYLE root",
      code: "invalid_cluster_b_seed",
    };
  }
  return { ok: true, url };
}

/** Shared identity-then-style pair owner for production and QA adapters. */
export function officialClusterBVariationReferencePair(
  identityRef: string,
  styleRootRef: string
):
  | { ok: true; references: readonly [string, string]; referenceRoleLayout: "identity_then_style" }
  | { ok: false; reason: string; code: OfficialGenerationReferencePlanFailure["code"] } {
  const identity = identityRef.trim();
  const styleRoot = styleRootRef.trim();
  if (!identity) {
    return { ok: false, reason: "Cluster B variation requires the approved representative identity", code: "missing_identity" };
  }
  if (!styleRoot) {
    return { ok: false, reason: "Cluster B variation requires the approved primary STYLE root", code: "missing_style_root" };
  }
  if (!isOfficialClusterBPrimaryStyleRef(styleRoot)) {
    return {
      ok: false,
      reason: "Cluster B variation STYLE reference must be the approved primary root",
      code: "invalid_cluster_b_seed",
    };
  }
  if (identity === styleRoot) {
    return { ok: false, reason: "identity and STYLE root must be distinct references", code: "invalid_cluster_b_seed" };
  }
  return {
    ok: true,
    references: [identity, styleRoot],
    referenceRoleLayout: "identity_then_style",
  };
}

function fail(
  code: OfficialGenerationReferencePlanFailure["code"],
  reason: string
): OfficialGenerationReferencePlanFailure {
  return { ok: false, code, reason };
}

/**
 * Canonical generation-reference plan: references, order, and prompt role together.
 */
export function resolveOfficialGenerationReferencePlan(
  input: OfficialGenerationReferenceInput
): OfficialGenerationReferencePlanResult {
  switch (input.kind) {
    case "representative": {
      if (!input.styleSeed) {
        return fail("missing_style_seed", "representative generation requires an approved style seed");
      }
      const references = resolveOfficialStyleGenerationReferences(input.styleSeed);
      if (references.length === 0 || references.some((ref) => !ref)) {
        return fail("missing_style_root", "representative generation requires style-only seed URLs");
      }
      return {
        ok: true,
        plan: {
          mode: "representative_style_only",
          references,
          referenceRoleLayout: "slot_default",
        },
      };
    }
    case "signature":
    case "emotion":
    case "scene": {
      const identity = input.representativeUrl?.trim() ?? "";
      if (isClusterBGraphicStyleSeed(input.styleSeed)) {
        const styleRoot = resolveOfficialClusterBVariationStyleUrl(input.styleSeed);
        if (!styleRoot.ok) return styleRoot;
        const pair = officialClusterBVariationReferencePair(identity, styleRoot.url);
        if (!pair.ok) return pair;
        return {
          ok: true,
          plan: {
            mode: "variation_identity_then_style",
            references: pair.references,
            referenceRoleLayout: pair.referenceRoleLayout,
          },
        };
      }
      if (!identity) {
        return fail("missing_identity", "variation generation requires the approved representative identity");
      }
      return {
        ok: true,
        plan: {
          mode: "variation_identity_anchor",
          references: [identity],
          referenceRoleLayout: "slot_default",
        },
      };
    }
    default: {
      const exhaustive: never = input.kind;
      throw new Error(`Unknown official asset slot kind ${String(exhaustive)}`);
    }
  }
}

export function officialGenerationReferenceRoleLayout(
  plan: OfficialGenerationReferencePlan
): OfficialReferenceRoleLayout {
  switch (plan.mode) {
    case "representative_style_only":
    case "variation_identity_anchor":
      return plan.referenceRoleLayout;
    case "variation_identity_then_style":
      return plan.referenceRoleLayout;
    default: {
      const exhaustive: never = plan;
      throw new Error(`Unknown official generation reference plan ${JSON.stringify(exhaustive)}`);
    }
  }
}
