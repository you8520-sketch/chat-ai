import type { OfficialReferenceRoleLayout } from "@/lib/officialSupply/imagePrompt";
import {
  isClusterBGraphicStyleSeed,
  isGenerationSafeReference,
  resolveOfficialStyleGenerationReferences,
  validateClusterBStyleSeedForApproval,
} from "@/lib/officialSupply/style";
import type {
  OfficialAssetSlotKind,
  OfficialGenerationReferencePolicy,
  StyleReference,
} from "@/lib/officialSupply/types";
import { isOfficialClusterBPrimaryStyleRef } from "@/lib/officialSupply/userOwnedRofanStyleRefs";

const APPROVED_ASSET_SCHEME = "official-approved-asset:";
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ASSET_STORAGE_URL = /^(\/uploads\/|https:\/\/)/i;

/**
 * Approved representative read through normal asset storage. Preparation
 * reads `url` and refuses bytes whose SHA-256 differs from the approved file.
 */
export function officialApprovedAssetReference(url: string, sha256: string): string {
  const digest = sha256.trim().toLowerCase();
  const source = url.trim();
  if (!SHA256_HEX.test(digest)) throw new Error("approved asset sha256 must be 64 lowercase hex characters");
  if (!ASSET_STORAGE_URL.test(source)) throw new Error("approved asset must be an asset storage url");
  return `${APPROVED_ASSET_SCHEME}${digest}:${source}`;
}

export function parseOfficialApprovedAssetReference(source: string): { sha256: string; url: string } | null {
  if (!source.startsWith(APPROVED_ASSET_SCHEME)) return null;
  const rest = source.slice(APPROVED_ASSET_SCHEME.length);
  const sha256 = rest.slice(0, 64);
  const url = rest.slice(65);
  if (rest[64] !== ":" || !SHA256_HEX.test(sha256) || !ASSET_STORAGE_URL.test(url)) {
    throw new Error("invalid approved asset reference");
  }
  return { sha256, url };
}

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
    }
  | {
      mode: "variation_identity_and_style";
      references: readonly [string];
      referenceRoleLayout: "identity_and_style";
    };

export type OfficialGenerationReferencePlanFailure = {
  ok: false;
  reason: string;
  code:
    | "missing_identity"
    | "missing_style_root"
    | "unsafe_style_root"
    | "invalid_cluster_b_seed"
    | "missing_style_seed"
    | "role_conflict"
    | "reference_policy_stale";
};

export type OfficialGenerationReferencePlanResult =
  | { ok: true; plan: OfficialGenerationReferencePlan }
  | OfficialGenerationReferencePlanFailure;

export type OfficialGenerationReferenceInput = {
  kind: OfficialAssetSlotKind;
  styleSeed: StyleReference | null | undefined;
  representativeUrl: string | null | undefined;
  /**
   * One image that owns both identity and style for this request.
   * A review candidate is `officialReviewCandidateReference(path, sha256)`.
   * Production callers omit it. Representative STYLE ONLY rejects it.
   */
  samePersonIdentityStyleUrl?: string | null;
  /**
   * Stored per-character policy: the approved representative alone owns
   * identity and style for variations. Characters without it keep the
   * default path (Cluster B identity-then-style).
   */
  representativeIdentityStyle?: OfficialGenerationReferencePolicy | null;
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

function samePersonIdentityStylePlan(
  input: OfficialGenerationReferenceInput,
  url: string
): OfficialGenerationReferencePlanResult {
  switch (input.kind) {
    case "representative":
      return fail(
        "role_conflict",
        "a same-person identity and style image is not part of representative STYLE ONLY generation"
      );
    case "signature":
    case "emotion":
    case "scene": {
      const styleUrls = input.styleSeed ? resolveOfficialStyleGenerationReferences(input.styleSeed) : [];
      if (styleUrls.includes(url) || isOfficialClusterBPrimaryStyleRef(url)) {
        return fail("role_conflict", "the same-person image must not be a STYLE reference");
      }
      const representative = input.representativeUrl?.trim() ?? "";
      if (representative && url === representative) {
        return fail("role_conflict", "the same-person image must not be the production representative");
      }
      return {
        ok: true,
        plan: {
          mode: "variation_identity_and_style",
          references: [url],
          referenceRoleLayout: "identity_and_style",
        },
      };
    }
    default: {
      const exhaustive: never = input.kind;
      throw new Error(`Unknown official asset slot kind ${String(exhaustive)}`);
    }
  }
}

function approvedRepresentativePlan(
  input: OfficialGenerationReferenceInput,
  policy: OfficialGenerationReferencePolicy
): OfficialGenerationReferencePlanResult {
  if (input.samePersonIdentityStyleUrl?.trim()) {
    return fail("role_conflict", "the approved representative already owns identity and style");
  }
  switch (input.kind) {
    case "representative":
      return fail(
        "role_conflict",
        "the representative is the approved identity and style reference and is not regenerated"
      );
    case "signature":
    case "emotion":
    case "scene": {
      const representative = input.representativeUrl?.trim() ?? "";
      if (!representative || representative !== policy.url) {
        return fail(
          "reference_policy_stale",
          "the stored reference policy does not name the current representative"
        );
      }
      let reference: string;
      try {
        reference = officialApprovedAssetReference(policy.url, policy.sha256);
      } catch (error) {
        return fail("reference_policy_stale", error instanceof Error ? error.message : String(error));
      }
      return {
        ok: true,
        plan: {
          mode: "variation_identity_and_style",
          references: [reference],
          referenceRoleLayout: "identity_and_style",
        },
      };
    }
    default: {
      const exhaustive: never = input.kind;
      throw new Error(`Unknown official asset slot kind ${String(exhaustive)}`);
    }
  }
}

/**
 * Canonical generation-reference plan: references, order, and prompt role together.
 */
export function resolveOfficialGenerationReferencePlan(
  input: OfficialGenerationReferenceInput
): OfficialGenerationReferencePlanResult {
  const policy = input.representativeIdentityStyle;
  if (policy) {
    switch (policy.mode) {
      case "representative_identity_and_style":
        return approvedRepresentativePlan(input, policy);
      default: {
        const exhaustive: never = policy.mode;
        return fail("reference_policy_stale", `unknown reference policy ${String(exhaustive)}`);
      }
    }
  }
  const samePerson = input.samePersonIdentityStyleUrl?.trim() ?? "";
  if (samePerson) return samePersonIdentityStylePlan(input, samePerson);
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
    case "variation_identity_and_style":
      return plan.referenceRoleLayout;
    default: {
      const exhaustive: never = plan;
      throw new Error(`Unknown official generation reference plan ${JSON.stringify(exhaustive)}`);
    }
  }
}
