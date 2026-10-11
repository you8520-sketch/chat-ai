/**
 * Main RP OpenRouter credential owner + Gemini route invariants.
 * Provider generation POST 0. GET /models is not key auth.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GEMINI_38_FLASH_MODEL,
  MAIN_RP_USER_SELECTABLE_OPTIONS,
  selectedAIProvider,
} from "@/lib/chatModels";
import {
  OPENROUTER_CHAT_COMPLETIONS_URL,
  OPENROUTER_KEY_AUTH_URL,
  OPENROUTER_MODELS_CATALOG_URL,
  OPENROUTER_NON_PRODUCTION_KEY_ENVS,
  OPENROUTER_PRODUCTION_API_KEY_ENV,
  buildOpenRouterHeaders,
  classifyOpenRouterReadOnlyProbe,
  resolveMainRpOpenRouterRoutePolicy,
  resolveMainRpPrimaryWireModelId,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterConfig";

describe("OpenRouter Main RP auth owner", () => {
  it("treats GET /key as auth and GET /models as a public catalog", () => {
    assert.equal(OPENROUTER_KEY_AUTH_URL, "https://openrouter.ai/api/v1/key");
    assert.equal(OPENROUTER_MODELS_CATALOG_URL, "https://openrouter.ai/api/v1/models");
    assert.equal(OPENROUTER_CHAT_COMPLETIONS_URL, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(classifyOpenRouterReadOnlyProbe(OPENROUTER_KEY_AUTH_URL), "key-auth");
    assert.equal(classifyOpenRouterReadOnlyProbe(OPENROUTER_MODELS_CATALOG_URL), "models-catalog");
    assert.equal(classifyOpenRouterReadOnlyProbe(OPENROUTER_CHAT_COMPLETIONS_URL), "other");
    assert.notEqual(
      classifyOpenRouterReadOnlyProbe(OPENROUTER_MODELS_CATALOG_URL),
      "key-auth"
    );
  });

  it("resolves Main RP keys only from OPENROUTER_API_KEY", () => {
    assert.equal(OPENROUTER_PRODUCTION_API_KEY_ENV, "OPENROUTER_API_KEY");
    assert.deepEqual([...OPENROUTER_NON_PRODUCTION_KEY_ENVS], [
      "OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY",
      "OPENROUTER_JEV_BENCHMARK_API_KEY",
    ]);
    const previous = {
      production: process.env[OPENROUTER_PRODUCTION_API_KEY_ENV],
      extras: OPENROUTER_NON_PRODUCTION_KEY_ENVS.map((name) => [
        name,
        process.env[name],
      ] as const),
    };
    try {
      delete process.env[OPENROUTER_PRODUCTION_API_KEY_ENV];
      for (const name of OPENROUTER_NON_PRODUCTION_KEY_ENVS) {
        process.env[name] = "benchmark-key-must-not-resolve";
      }
      assert.throws(() => resolveOpenRouterApiKey(), /NO_OPENROUTER_KEY/);
      process.env[OPENROUTER_PRODUCTION_API_KEY_ENV] = "  production-owner-key  ";
      assert.equal(resolveOpenRouterApiKey(), "production-owner-key");
      const headers = buildOpenRouterHeaders();
      assert.equal(headers.Authorization, "Bearer production-owner-key");
      assert.equal(headers["Content-Type"], "application/json");
      assert.ok(headers["HTTP-Referer"]);
      assert.ok(headers["X-Title"]);
      assert.equal(headers.Authorization.includes("benchmark-key-must-not-resolve"), false);
    } finally {
      if (previous.production === undefined) delete process.env[OPENROUTER_PRODUCTION_API_KEY_ENV];
      else process.env[OPENROUTER_PRODUCTION_API_KEY_ENV] = previous.production;
      for (const [name, value] of previous.extras) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("keeps Main RP Gemini on OpenRouter Flex google-ai-studio with no fallback", () => {
    const gemini = MAIN_RP_USER_SELECTABLE_OPTIONS.find((option) => option.id === GEMINI_38_FLASH_MODEL);
    assert.ok(gemini);
    assert.equal(gemini.provider, "openrouter");
    assert.equal(selectedAIProvider(GEMINI_38_FLASH_MODEL), "openrouter");
    assert.equal(resolveMainRpPrimaryWireModelId(GEMINI_38_FLASH_MODEL), "google/gemini-3.8-flash");
    const policy = resolveMainRpOpenRouterRoutePolicy(GEMINI_38_FLASH_MODEL);
    assert.ok(policy);
    assert.deepEqual(policy.provider.only, ["google-ai-studio"]);
    assert.equal(policy.provider.allow_fallbacks, false);
    assert.equal(policy.provider.require_parameters, true);
    assert.equal(policy.serviceTier, "flex");
    for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
      if (option.id === GEMINI_38_FLASH_MODEL) continue;
      assert.equal(selectedAIProvider(option.id), "cheaperinference");
    }
  });
});
