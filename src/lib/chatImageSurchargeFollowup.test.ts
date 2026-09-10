import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_IMAGE_BASE_IDENTITY_REFERENCES,
  CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS,
  CHAT_ROOM_IMAGE_GENERATION_POINTS,
  resolveImageGenerationRequiredPoints,
  resolveImageIdentityReferenceSurcharge,
} from "@/lib/chatImagePricing";

const COMIC_ROUTE = "src/app/api/chat/comic-generation/route.ts";
const PANEL = "src/components/ChatImageGeneratorPanel.tsx";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

describe("surcharge follow-up: TRPG dynamic preflight / price UI / cost-cohort persistence", () => {
  it("TRPG-DYNAMIC-PREFLIGHT: 402 balance preflight runs BEFORE the AI_FOCUS planner call", () => {
    const route = read(COMIC_ROUTE);
    const priceIndex = route.indexOf("const identityReferenceCount = referenceUrls.length;");
    const preflightIndex = route.indexOf("포인트가 부족합니다. 선택 턴 LD 일러스트에는");
    const focusIndex = route.indexOf("resolveTrpgIllustrationSceneFocus({");
    assert.ok(priceIndex > -1, "illustration grounds references before pricing");
    assert.ok(priceIndex < preflightIndex, "preflight uses the grounded identity-reference count");
    assert.ok(focusIndex > -1, "TRPG AI_FOCUS call exists");
    assert.ok(
      focusIndex > preflightIndex,
      "AI_FOCUS (billable planner) must run only AFTER the balance preflight passes"
    );
    // Final price is resolved exactly once per path — never recomputed after
    // the planner call; settlement reuses the same pricePoints.
    const priceOwnerCalls = [...route.matchAll(/resolveImageGenerationRequiredPoints\(/g)].length;
    assert.equal(priceOwnerCalls, 2, "one canonical price owner call per production path");
  });

  it("TRPG-DYNAMIC-PREFLIGHT: insufficient balance never starts a job or reaches the provider", () => {
    const route = read(COMIC_ROUTE);
    const preflightIndex = route.indexOf("포인트가 부족합니다. 선택 턴 LD 일러스트에는");
    const startJobIndex = route.indexOf('startJob(CHAT_LD_ILLUSTRATION_TEMPLATE_ID, "illustration")');
    const providerIndex = route.indexOf("await generateLdIllustrationImage({");
    assert.ok(preflightIndex > -1 && preflightIndex < startJobIndex);
    assert.ok(startJobIndex > -1 && providerIndex > -1 && startJobIndex < providerIndex);
  });

  it("PRICE-UI: generation button quotes the canonical expected price (shared owner, no client formula)", () => {
    const panel = read(PANEL);
    // Shared canonical owner — imported, not re-derived.
    assert.match(panel, /resolveImageGenerationRequiredPoints/);
    assert.match(
      panel,
      /from "@\/lib\/chatImagePricing"/,
      "panel must import the canonical pricing owner"
    );
    // No duplicate client surcharge formula.
    assert.doesNotMatch(panel, /\* CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS/);
    assert.doesNotMatch(panel, /CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS \*/);
    // Expected total shown on the generation button.
    assert.match(panel, /expectedPrice\.toLocaleString\(\)\}P/);
    // Short surcharge explanation using the canonical constants.
    assert.match(panel, /기본 \{CHAT_IMAGE_BASE_IDENTITY_REFERENCES\}명 포함/u);
    assert.match(
      panel,
      /추가 참조 인물 1명당[\s*]+\+\{CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS\}P/u
    );
  });

  it("PRICE-UI: stale 1:1 flat-price wording is gone", () => {
    const panel = read(PANEL);
    assert.doesNotMatch(panel, /포인트는 1:1 일러스트와 같습니다/u);
  });

  it("PRICE-UI: general-chat quote respects the current identity cap (4 selected -> 3-ref price)", () => {
    const panel = read(PANEL);
    // The expected-refs estimate must clamp to the production identity cap so a
    // 4th selected cast member never displays a 4-ref price today; raising the
    // cap later automatically surfaces the higher price.
    assert.match(panel, /CHAT_IMAGE_CAST_IDENTITY_REFERENCE_CAP/);
    assert.equal(CHAT_IMAGE_BASE_IDENTITY_REFERENCES, 2);
    // 2 expected refs -> base; 3 -> base+20; TRPG 4 grounded -> base+40.
    assert.equal(resolveImageGenerationRequiredPoints(2), CHAT_ROOM_IMAGE_GENERATION_POINTS);
    assert.equal(
      resolveImageGenerationRequiredPoints(3),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
    assert.equal(
      resolveImageGenerationRequiredPoints(4),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICE-UI: TRPG quote counts grounded selected participant images, not participantCount", () => {
    const panel = read(PANEL);
    // TRPG estimate derives from party picks with non-empty images.
    assert.match(panel, /partyPicks\[member\.participantId\] \|\| member\.imageUrl/);
    assert.match(panel, /partyCast\.filter\(/);
  });

  it("COST-COHORT-PERSISTENCE: illustration/trpg persist the pricing identity-reference count", () => {
    const route = read(COMIC_ROUTE);
    // The persisted count is the SAME variable used for pricing (shorthand property).
    assert.match(
      route,
      /identityReferenceCount,\s*\n\s*referenceSurchargePoints: resolveImageIdentityReferenceSurcharge\(identityReferenceCount\),/
    );
    // It appears in BOTH settle optionsJson blocks (illustration/TRPG + comic).
    const persistedCount = [...route.matchAll(/identityReferenceCount,\s*\n\s*referenceSurchargePoints:/g)]
      .length;
    assert.equal(persistedCount, 2, "both illustration and comic settlements persist the cohort fields");
  });

  it("COST-COHORT-PERSISTENCE: comic count excludes the template and matches pricing input", () => {
    const route = read(COMIC_ROUTE);
    const pricingIndex = route.indexOf("const identityReferenceCount = providerReferences.filter(");
    const persisted = [
      ...route.matchAll(/identityReferenceCount,\s*\n\s*referenceSurchargePoints:/g),
    ];
    assert.ok(pricingIndex > -1);
    assert.ok(persisted.length === 2);
    assert.ok(persisted[1].index! > pricingIndex);
    // The canonical surcharge for a comic count equals the persisted value.
    assert.equal(
      resolveImageIdentityReferenceSurcharge(3),
      CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("SURCHARGE-STATUS: 20P is the approved initial surcharge (not a cost-validated final)", () => {
    const pricing = read("src/lib/chatImagePricing.ts");
    assert.doesNotMatch(pricing, /covers the marginal provider upstream cost/u);
    assert.match(
      pricing,
      /initial test-phase surcharge|initial\/provisional[\s*]+product[\s*]+surcharge/u
    );
    assert.match(pricing, /cost cohort|cost cohorts|upstream_cost_usd/u);
  });
});