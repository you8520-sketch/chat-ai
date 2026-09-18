import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CHAT_COMIC_BASE_POINTS,
  CHAT_ILLUSTRATION_BASE_POINTS,
  CHAT_IMAGE_BASE_IDENTITY_REFERENCES,
  CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS,
  CHAT_ROOM_IMAGE_GENERATION_POINTS,
  resolveImageGenerationRequiredPoints,
  resolveImageIdentityReferenceSurcharge,
} from "@/lib/chatImagePricing";
import { resolveChatLdIllustrationPrice } from "@/lib/chatLdIllustrationGeneration";
import { resolveChatComicPrice } from "@/lib/chatComicGenerationConstants";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const COMIC_ROUTE = "src/app/api/chat/comic-generation/route.ts";
const ILLUSTRATION_BASE = resolveChatLdIllustrationPrice();
const COMIC_BASE = resolveChatComicPrice(4);

describe("canonical image product pricing (single owner)", () => {
  it("PRICE-LD-1 regular illustration 2 refs = 150", () => {
    assert.equal(
      resolveImageGenerationRequiredPoints(2, ILLUSTRATION_BASE),
      CHAT_ILLUSTRATION_BASE_POINTS
    );
    assert.equal(CHAT_ILLUSTRATION_BASE_POINTS, 150);
  });

  it("PRICE-LD-2 regular illustration 3 refs = 170", () => {
    assert.equal(
      resolveImageGenerationRequiredPoints(3, ILLUSTRATION_BASE),
      CHAT_ILLUSTRATION_BASE_POINTS + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICE-LD-3 regular illustration 4 refs = 190", () => {
    assert.equal(
      resolveImageGenerationRequiredPoints(4, ILLUSTRATION_BASE),
      CHAT_ILLUSTRATION_BASE_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICE-TRPG-1 TRPG illustration 2 refs = 150 (same illustration base resolver)", () => {
    assert.equal(resolveImageGenerationRequiredPoints(2, ILLUSTRATION_BASE), 150);
  });

  it("PRICE-TRPG-2 TRPG illustration 3 refs = 170", () => {
    assert.equal(resolveImageGenerationRequiredPoints(3, ILLUSTRATION_BASE), 170);
  });

  it("PRICE-TRPG-3 TRPG illustration 4 refs = 190", () => {
    assert.equal(resolveImageGenerationRequiredPoints(4, ILLUSTRATION_BASE), 190);
  });

  it("PRICE-COMIC-1 comic 2 refs = existing comic base (180)", () => {
    assert.equal(
      resolveImageGenerationRequiredPoints(2, COMIC_BASE),
      CHAT_COMIC_BASE_POINTS
    );
    assert.equal(CHAT_COMIC_BASE_POINTS, 180);
    assert.equal(CHAT_ROOM_IMAGE_GENERATION_POINTS, CHAT_COMIC_BASE_POINTS);
  });

  it("PRICE-COMIC-2 comic 3 refs = comic base + 20", () => {
    assert.equal(
      resolveImageGenerationRequiredPoints(3, COMIC_BASE),
      CHAT_COMIC_BASE_POINTS + CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICE-COMIC-3 comic 4 refs = comic base + 40", () => {
    assert.equal(
      resolveImageGenerationRequiredPoints(4, COMIC_BASE),
      CHAT_COMIC_BASE_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
  });

  it("PRICE-BOUNDARY below-base counts never go below product base", () => {
    assert.equal(resolveImageIdentityReferenceSurcharge(0), 0);
    assert.equal(resolveImageIdentityReferenceSurcharge(1), 0);
    assert.equal(resolveImageGenerationRequiredPoints(0, ILLUSTRATION_BASE), 150);
    assert.equal(resolveImageGenerationRequiredPoints(1, ILLUSTRATION_BASE), 150);
    assert.equal(resolveImageGenerationRequiredPoints(0, COMIC_BASE), 180);
    assert.equal(resolveImageGenerationRequiredPoints(1, COMIC_BASE), 180);
  });

  it("PRICE-UI-SERVER product base resolvers match canonical constants", () => {
    assert.equal(ILLUSTRATION_BASE, CHAT_ILLUSTRATION_BASE_POINTS);
    assert.equal(COMIC_BASE, CHAT_COMIC_BASE_POINTS);
    assert.equal(CHAT_IMAGE_BASE_IDENTITY_REFERENCES, 2);
  });

  it("PRICING-6 single canonical owner: no per-path surcharge helper exists", () => {
    const files = [
      "src/lib/chatImagePricing.ts",
      "src/lib/chatComicGenerationConstants.ts",
      "src/lib/chatLdIllustrationGeneration.ts",
      "src/app/api/chat/comic-generation/route.ts",
      "src/lib/trpg/illustrationCast.ts",
    ];
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
    assert.match(comic, /const identityReferenceCount = providerReferences\.filter\(/);
    assert.match(comic, /resolveImageGenerationRequiredPoints\(\s*identityReferenceCount,/);
    assert.doesNotMatch(
      comic,
      /resolveImageGenerationRequiredPoints\(\s*identityReferenceCount\s*\*\s*panelCount/
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
