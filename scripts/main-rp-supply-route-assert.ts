import assert from "node:assert/strict";

import { resolveMainRpOpenRouterRoutePolicy } from "@/lib/openRouterConfig";

const modelId = process.env.MAIN_RP_SUPPLY_ASSERT_MODEL_ID?.trim();
const providerSlug = process.env.MAIN_RP_SUPPLY_ASSERT_PROVIDER_SLUG?.trim();

if (!modelId || !providerSlug) {
  throw new Error("Missing MAIN_RP_SUPPLY_ASSERT_MODEL_ID / MAIN_RP_SUPPLY_ASSERT_PROVIDER_SLUG");
}

const policy = resolveMainRpOpenRouterRoutePolicy(modelId);
assert.ok(policy, `Missing Main RP OpenRouter route policy for ${modelId}`);
assert.equal(policy.provider.only.length, 1);
assert.equal(policy.provider.only[0], providerSlug);
assert.equal(policy.serviceTier, "flex");
assert.equal(policy.provider.allow_fallbacks, false);
assert.equal(policy.provider.require_parameters, true);

console.log(
  JSON.stringify({
    modelId,
    providerSlug,
    serviceTier: policy.serviceTier,
    allowFallbacks: policy.provider.allow_fallbacks,
    requireParameters: policy.provider.require_parameters,
    status: "PASS",
  })
);
