import assert from "node:assert/strict";
import test from "node:test";

import routeConfig from "../../config/main-rp-openrouter-routes.json";
import { resolveMainRpOpenRouterRoutePolicy } from "./openRouterConfig";

const EXPECTED = [
  "google/gemini-3.1-pro-preview",
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
] as const;

test("Main RP OpenRouter route JSON is the canonical provider/tier owner", () => {
  assert.deepEqual(Object.keys(routeConfig).sort(), [...EXPECTED].sort());

  for (const modelId of EXPECTED) {
    const raw = routeConfig[modelId];
    assert.ok(raw.providerSlug);
    assert.equal(raw.serviceTier, "flex");

    const resolved = resolveMainRpOpenRouterRoutePolicy(modelId);
    assert.ok(resolved);
    assert.deepEqual(resolved.provider.only, [raw.providerSlug]);
    assert.equal(resolved.provider.allow_fallbacks, false);
    assert.equal(resolved.provider.require_parameters, true);
    assert.equal(resolved.serviceTier, raw.serviceTier);
  }
});

test("non-routed Main RP models do not acquire an OpenRouter route implicitly", () => {
  assert.equal(resolveMainRpOpenRouterRoutePolicy("deepseek-v4.1-flash"), null);
  assert.equal(resolveMainRpOpenRouterRoutePolicy("gpt-5.6-terra"), null);
});
