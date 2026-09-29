import assert from "node:assert/strict";
import test from "node:test";
import MAIN_RP_OPENROUTER_ROUTES from "../../config/main-rp-openrouter-routes.json";
import {
  MAIN_RP_USER_SELECTABLE_OPTIONS,
} from "./chatModels";
import {
  buildOpenRouterHeaders,
  resolveMainRpOpenRouterRoutePolicy,
  resolveRpOpenRouterModelId,
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


test("Main RP OpenRouter route resolver is a pure consumer of the canonical JSON owner", () => {
  for (const option of MAIN_RP_USER_SELECTABLE_OPTIONS) {
    const route = resolveMainRpOpenRouterRoutePolicy(option.id);
    if (option.provider !== "openrouter") {
      assert.equal(route, null);
      continue;
    }
    const wireModel = resolveRpOpenRouterModelId(option.id);
    const entry = (
      MAIN_RP_OPENROUTER_ROUTES as Record<
        string,
        { providerSlug: string; serviceTier: "flex" | null }
      >
    )[wireModel];
    assert.ok(entry, `missing canonical route entry for ${wireModel}`);
    assert.deepEqual(route, {
      provider: {
        only: [entry.providerSlug],
        allow_fallbacks: false,
        require_parameters: true,
      },
      serviceTier: entry.serviceTier,
    });
  }
});

test("canonical route JSON has no orphan entry outside active OpenRouter Main RP models", () => {
  const expected = MAIN_RP_USER_SELECTABLE_OPTIONS
    .filter((option) => option.provider === "openrouter")
    .map((option) => resolveRpOpenRouterModelId(option.id))
    .sort();
  assert.deepEqual(Object.keys(MAIN_RP_OPENROUTER_ROUTES).sort(), expected);
});
