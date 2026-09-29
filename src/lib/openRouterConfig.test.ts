import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenRouterHeaders,
  resolveMainRpOpenRouterRoutePolicy,
} from "./openRouterConfig";

test("OpenRouter headers use configured referer and canonical title by default", () => {
  const previous = {
    referer: process.env.OPENROUTER_HTTP_REFERER,
    title: process.env.OPENROUTER_APP_TITLE,
  };
  process.env.OPENROUTER_HTTP_REFERER = "https://hav.chat";
  delete process.env.OPENROUTER_APP_TITLE;

  try {
    const headers = buildOpenRouterHeaders("test-key");
    assert.equal(headers["HTTP-Referer"], "https://hav.chat");
    assert.equal(headers["X-Title"], "하브");
  } finally {
    if (previous.referer === undefined) delete process.env.OPENROUTER_HTTP_REFERER;
    else process.env.OPENROUTER_HTTP_REFERER = previous.referer;
    if (previous.title === undefined) delete process.env.OPENROUTER_APP_TITLE;
    else process.env.OPENROUTER_APP_TITLE = previous.title;
  }
});

test("OpenRouter title environment override remains authoritative", () => {
  const previous = process.env.OPENROUTER_APP_TITLE;
  process.env.OPENROUTER_APP_TITLE = "Custom app title";
  try {
    assert.equal(buildOpenRouterHeaders("test-key")["X-Title"], "Custom app title");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_APP_TITLE;
    else process.env.OPENROUTER_APP_TITLE = previous;
  }
});


test("Main RP OpenRouter route data preserves current Google AI Studio flex routes", () => {
  for (const model of [
    "gemini-3.1-pro-preview",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
  ]) {
    const route = resolveMainRpOpenRouterRoutePolicy(model);
    assert.deepEqual(route, {
      provider: {
        only: ["google-ai-studio"],
        allow_fallbacks: false,
        require_parameters: true,
      },
      serviceTier: "flex",
    });
  }
});

test("Main RP OpenRouter route owner returns null for non-OpenRouter Main RP models", () => {
  assert.equal(resolveMainRpOpenRouterRoutePolicy("deepseek-v4.1-flash"), null);
  assert.equal(resolveMainRpOpenRouterRoutePolicy("gpt-5.6-terra"), null);
});
