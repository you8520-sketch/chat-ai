import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONFIRMED_CROSS_BORDER_TRANSFERS,
  CROSS_BORDER_ARTICLE_28_8_DISCLOSURE_COMPLETE,
  CROSS_BORDER_FINAL_COUNTRY_UNRESOLVABLE_PROVIDER_IDS,
  CROSS_BORDER_TRANSFERS,
  EXCLUDED_FROM_CROSS_BORDER_TABLE,
  PRODUCTION_CROSS_BORDER_PROVIDER_IDS,
  formatCrossBorderPrivacyParagraphs,
  isCrossBorderRowComplete,
} from "./privacyCrossBorder";

test("cross-border table lists only live production personal-data paths", () => {
  assert.deepEqual(
    [...PRODUCTION_CROSS_BORDER_PROVIDER_IDS],
    CROSS_BORDER_TRANSFERS.map((row) => row.id),
  );
  assert.deepEqual(
    [...PRODUCTION_CROSS_BORDER_PROVIDER_IDS],
    ["openrouter", "cheaper-inference", "openai", "google", "resend"],
  );
  for (const excluded of EXCLUDED_FROM_CROSS_BORDER_TABLE) {
    assert.equal(
      CROSS_BORDER_TRANSFERS.some((row) => row.id === excluded),
      false,
    );
  }
});

test("public privacy table lists every live row and does not guess unknown cells", () => {
  assert.equal(CROSS_BORDER_ARTICLE_28_8_DISCLOSURE_COMPLETE, false);
  assert.deepEqual(
    CONFIRMED_CROSS_BORDER_TRANSFERS.map((row) => row.id),
    ["resend"],
  );
  const publicText = formatCrossBorderPrivacyParagraphs().join("\n");
  assert.match(publicText, /Plus Five Five, Inc\.\(Resend\)/);
  assert.match(publicText, /support@resend\.com/);
  assert.match(publicText, /미국/);
  assert.match(publicText, /OpenRouter, Inc\./);
  assert.match(publicText, /Keak AI, Inc\./);
  assert.match(publicText, /확인되지 않음/);
  assert.doesNotMatch(publicText, /미확정/);
  assert.doesNotMatch(publicText, /코리아포트원/);
  assert.doesNotMatch(publicText, /Vercel Inc\./);
  assert.doesNotMatch(publicText, /그 고지가 완료되었다고 쓰지 않습니다/);
  for (const row of CROSS_BORDER_TRANSFERS) {
    assert.match(publicText, new RegExp(row.recipient.publicValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("OpenRouter and Cheaper Inference countries stay unresolvable without architecture change", () => {
  assert.deepEqual(
    [...CROSS_BORDER_FINAL_COUNTRY_UNRESOLVABLE_PROVIDER_IDS],
    ["openrouter", "cheaper-inference"],
  );
  for (const id of CROSS_BORDER_FINAL_COUNTRY_UNRESOLVABLE_PROVIDER_IDS) {
    const row = CROSS_BORDER_TRANSFERS.find((candidate) => candidate.id === id);
    assert.ok(row);
    assert.equal(row.countries.status, "unconfirmed");
    assert.equal(isCrossBorderRowComplete(row), false);
  }
  const routePolicy = readFileSync(new URL("./openRouterConfig.ts", import.meta.url), "utf8");
  const cheaper = readFileSync(new URL("./cheaperInferenceConfig.ts", import.meta.url), "utf8");
  assert.match(routePolicy, /only: \[source\.providerSlug\]/);
  assert.match(routePolicy, /allow_fallbacks: false/);
  assert.doesNotMatch(cheaper, /only:|region:|country:/);
});
