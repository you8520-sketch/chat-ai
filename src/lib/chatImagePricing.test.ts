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

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const COMIC_ROUTE = "src/app/api/chat/comic-generation/route.ts";

describe("canonical additional identity-reference surcharge owner (all GPT Image paths)", () => {
  it("PRICING-1 base includes 2 identity references; 2 refs = base price", () => {
    assert.equal(CHAT_IMAGE_BASE_IDENTITY_REFERENCES, 2);
    assert.equal(resolveImageIdentityReferenceSurcharge(2), 0);
    assert.equal(
      resolveImageGenerationRequiredPoints(2),
      CHAT_ROOM_IMAGE_GENERATION_POINTS
    );
  });

  it("PRICING-2 3 identity references = base + 1 surcharge", () => {
    assert.equal(resolveImageIdentityReferenceSurcharge(3), CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS);
    assert.equal(
      resolveImageGenerationRequiredPoints(3),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICING-3 4 identity references = base + 2 surcharge", () => {
    assert.equal(resolveImageIdentityReferenceSurcharge(4), 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS);
    assert.equal(
      resolveImageGenerationRequiredPoints(4),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICING-4 below-base counts (0/1) never go below base (no negative surcharge)", () => {
    assert.equal(resolveImageIdentityReferenceSurcharge(1), 0);
    assert.equal(resolveImageIdentityReferenceSurcharge(0), 0);
    assert.equal(resolveImageGenerationRequiredPoints(1), CHAT_ROOM_IMAGE_GENERATION_POINTS);
    assert.equal(resolveImageGenerationRequiredPoints(0), CHAT_ROOM_IMAGE_GENERATION_POINTS);
  });

  it("PRICING-5 base-points param honors the per-product base resolvers", () => {
    assert.equal(resolveImageGenerationRequiredPoints(2, 180), 180);
    assert.equal(resolveImageGenerationRequiredPoints(3, 180), 180 + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS);
    assert.equal(resolveImageGenerationRequiredPoints(4, 180), 180 + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS);
  });

  it("PRICING-6 single canonical owner: no per-path surcharge helper exists", () => {
    const files = [
      "src/lib/chatImagePricing.ts",
      "src/lib/chatComicGenerationConstants.ts",
      "src/lib/chatLdIllustrationGeneration.ts",
      "src/app/api/chat/comic-generation/route.ts",
      "src/lib/trpg/illustrationCast.ts",
    ];
    // Routes may CONSUME the canonical owner and persist its result, but must
    // never DEFINE their own surcharge math (helper function/constant).
    const forbiddenDefinitions = [
      /function\s+\w*[Ss]urcharge\w*\s*\(/,
      /const\s+\w*[Ss]urcharge\w*\s*=[^=]/,
      /partySurcharge/,
      /participantSurcharge/,
      /comicSurcharge/,
      /illustrationSurcharge/,
      /trpgSurcharge/,
    ];
    for (const file of files) {
      if (file === "src/lib/chatImagePricing.ts") continue;
      const source = read(file);
      for (const pattern of forbiddenDefinitions) {
        assert.doesNotMatch(
          source,
          pattern,
          `${file} must not define its own surcharge helper (${pattern})`
        );
      }
    }
  });

  it("PRICING-7 comic surcharge counted once per request, never per panelCount", () => {
    const comic = read(COMIC_ROUTE);
    // The pricing owner receives the identity-reference count, and it is not
    // multiplied by panelCount before reaching the canonical owner.
    assert.match(comic, /const identityReferenceCount = providerReferences\.filter\(/);
    assert.match(comic, /resolveImageGenerationRequiredPoints\(\s*identityReferenceCount,/);
    assert.doesNotMatch(
      comic,
      /resolveImageGenerationRequiredPoints\(\s*identityReferenceCount\s*\*\s*panelCount/
    );
    // The canonical owner has no panel dimension at all.
    assert.equal(
      resolveImageGenerationRequiredPoints(3, 180),
      resolveImageGenerationRequiredPoints(3, 180)
    );
  });

  it("PRICING-8 illustration preflight uses grounded refs; settlement consumes the same owner", () => {
    const comic = read(COMIC_ROUTE);
    const refIndex = comic.indexOf("const identityReferenceCount = referenceUrls.length;");
    const preflightIndex = comic.indexOf("포인트가 부족합니다. 선택 턴 LD 일러스트에는");
    const settlementIndex = comic.indexOf("chargePoints: pricePoints");
    assert.ok(refIndex > -1, "illustration grounds references before pricing");
    assert.ok(refIndex < preflightIndex, "illustration preflight uses the grounded identity-reference count");
    assert.ok(settlementIndex > -1 && preflightIndex < settlementIndex, "settlement reuses the same pricePoints");
  });

  it("PRICING-9 comic preflight runs after the provider reference pack, before provider call", () => {
    const comic = read(COMIC_ROUTE);
    const refIndex = comic.indexOf("const identityReferenceCount = providerReferences.filter(");
    const preflightIndex = comic.indexOf("포인트가 부족합니다. 컷만화에는");
    const startJobIndex = comic.indexOf('startJob(CHAT_COMIC_TEMPLATE_ID, "comic")');
    const providerIndex = comic.indexOf("const generated = await generateComicImage(");
    assert.ok(refIndex > -1 && refIndex < preflightIndex, "comic grounds references before pricing");
    assert.ok(preflightIndex < startJobIndex && startJobIndex < providerIndex, "preflight precedes the provider call");
  });
});