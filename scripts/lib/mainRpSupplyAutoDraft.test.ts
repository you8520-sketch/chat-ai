import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  autoDraftMarker,
  patchMainRpOpenRouterProvider,
  safeBranchComponent,
  validateProviderSlug,
} from "./mainRpSupplyAutoDraft";

const SOURCE = \`
export const MAIN_RP_OPENROUTER_ROUTE_POLICY_SOURCE = {
  "google/gemini-3.7-flash": {
    providerSlug: "google-ai-studio",
    serviceTier: "flex",
  },
};
\`;

describe("Main RP supply auto Draft patcher", () => {
  it("changes exactly one provider pin while preserving Flex service tier", () => {
    const result = patchMainRpOpenRouterProvider({
      source: SOURCE,
      openRouterModelId: "google/gemini-3.7-flash",
      expectedCurrentProviderSlug: "google-ai-studio",
      candidateProviderSlug: "wafer",
    });
    assert.equal(result.changed, true);
    assert.equal(result.previousProviderSlug, "google-ai-studio");
    assert.match(result.source, /providerSlug: "wafer"/);
    assert.match(result.source, /serviceTier: "flex"/);
    assert.doesNotMatch(result.source, /providerSlug: "google-ai-studio"/);
  });

  it("is a no-op when the candidate is already current", () => {
    const result = patchMainRpOpenRouterProvider({
      source: SOURCE,
      openRouterModelId: "google/gemini-3.7-flash",
      expectedCurrentProviderSlug: "google-ai-studio",
      candidateProviderSlug: "google-ai-studio",
    });
    assert.equal(result.changed, false);
    assert.equal(result.source, SOURCE);
  });

  it("fails closed on current-route drift", () => {
    assert.throws(
      () =>
        patchMainRpOpenRouterProvider({
          source: SOURCE,
          openRouterModelId: "google/gemini-3.7-flash",
          expectedCurrentProviderSlug: "other-current",
          candidateProviderSlug: "wafer",
        }),
      /Route provider drift/
    );
  });

  it("fails closed when the canonical model row is missing or duplicated", () => {
    assert.throws(
      () =>
        patchMainRpOpenRouterProvider({
          source: SOURCE,
          openRouterModelId: "google/gemini-3.8-flash",
          expectedCurrentProviderSlug: "google-ai-studio",
          candidateProviderSlug: "wafer",
        }),
      /found 0/
    );
    assert.throws(
      () =>
        patchMainRpOpenRouterProvider({
          source: SOURCE + SOURCE,
          openRouterModelId: "google/gemini-3.7-flash",
          expectedCurrentProviderSlug: "google-ai-studio",
          candidateProviderSlug: "wafer",
        }),
      /found 2/
    );
  });

  it("rejects unsafe provider slugs", () => {
    assert.equal(validateProviderSlug("google-ai-studio"), "google-ai-studio");
    assert.throws(() => validateProviderSlug("bad slug"), /Unsafe/);
    assert.throws(() => validateProviderSlug(";rm -rf"), /Unsafe/);
  });

  it("creates stable branch components and duplicate-PR markers", () => {
    assert.equal(
      safeBranchComponent("Gemini 3.7 Flash / Wafer"),
      "gemini-3.7-flash-wafer"
    );
    assert.equal(
      autoDraftMarker("gemini-3.7-flash", "wafer"),
      "<!-- main-rp-supply-auto:gemini-3.7-flash:wafer -->"
    );
  });
});
