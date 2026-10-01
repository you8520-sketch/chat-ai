import type {
  PublicScreenResult,
  PublicScreenStatus,
  SupplierCandidateStatus,
  SupplierPublicProfile,
} from "./types";

function missingPublicGates(profile: SupplierPublicProfile): string[] {
  const reasons: string[] = [];
  if (profile.companyIdentityEvidence == null) reasons.push("company_identity_unverified");
  if (profile.priceUnit !== "usd_per_million_tokens") {
    reasons.push("canonical_token_pricing_absent");
  } else if (profile.inputUsdPerMillion == null || profile.outputUsdPerMillion == null) {
    reasons.push("canonical_token_pricing_incomplete");
  }
  if (profile.modelProvenanceEvidence == null || profile.supportedActiveModelIds.length === 0) {
    reasons.push("active_model_identity_not_public");
  }
  if (profile.openaiCompatible !== "yes") reasons.push("hosted_openai_compatibility_unproven");
  if (profile.chatCompletionsAdvertised !== true) {
    reasons.push("chat_completions_not_advertised");
  }
  if (profile.streamingAdvertised !== true) reasons.push("streaming_not_advertised");
  if (profile.usageReportingAdvertised !== "token_usage") {
    reasons.push("token_usage_reporting_not_advertised");
  }
  if (profile.privacyPolicyUrl == null) reasons.push("privacy_policy_url_unverified");
  if (profile.termsUrl == null) reasons.push("terms_url_unverified");
  if (profile.retentionZdr !== "advertised") reasons.push("zdr_unverified");
  if (profile.publicStabilityEvidence == null) reasons.push("public_stability_unverified");
  if (profile.contextLimitTokens == null) reasons.push("context_limit_unverified");
  if (profile.longContextTierPricing === "unknown") {
    reasons.push("long_context_tier_pricing_unverified");
  }
  if (profile.cachePricing === "unknown") reasons.push("cache_pricing_unverified");
  if (profile.betaLimitation) reasons.push("known_beta_limitation");
  if (profile.waitlist == null) reasons.push("waitlist_state_unverified");
  return reasons;
}

/**
 * Public screening only. A published price never becomes READY by itself.
 * Missing evidence stays HOLD. Waitlist is recorded as WAITLIST even when other gates fail.
 */
export function screenSupplierPublicProfile(
  profile: SupplierPublicProfile
): PublicScreenResult {
  const reasons = missingPublicGates(profile);
  if (profile.waitlist === true) {
    return {
      status: "WAITLIST",
      reasons: ["waitlist", ...reasons.filter((reason) => reason !== "waitlist_state_unverified")],
    };
  }
  if (reasons.length > 0) {
    return { status: "PUBLIC_SCREEN_HOLD", reasons };
  }
  return { status: "PUBLIC_SCREEN_PASS", reasons: ["public_gates_passed"] };
}

export function pipelineStatusAfterPublicScreen(input: {
  screen: PublicScreenStatus;
  credentialConfigured: boolean;
}): SupplierCandidateStatus {
  switch (input.screen) {
    case "WAITLIST":
      return "WAITLIST";
    case "REJECTED":
      return "REJECTED";
    case "PUBLIC_SCREEN_HOLD":
      return "PUBLIC_SCREEN_HOLD";
    case "PUBLIC_SCREEN_PASS":
      return input.credentialConfigured
        ? "READY_FOR_LIVE_QUALIFICATION"
        : "CREDENTIAL_REQUIRED";
    default: {
      const _exhaustive: never = input.screen;
      return _exhaustive;
    }
  }
}
