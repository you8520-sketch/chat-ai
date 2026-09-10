import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildChatComicGenerationPlan,
  CHAT_COMIC_TEMPLATE_PREVIEW_URL,
} from "@/lib/chatComicGeneration";
import { buildComicProviderReferences } from "@/lib/chatComicReferenceIsolation";
import { buildStrictComicFallbackPrompt } from "@/lib/chatImageStrictSafetyFallbackPrompt";
import { buildPartyIllustrationReferencePlan } from "@/lib/chatImageVisualIdentity";
import {
  buildDeterministicScenePlan,
  buildSceneSourceMessages,
} from "@/lib/chatImageScenePlan";
import {
  CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS,
  CHAT_ROOM_IMAGE_GENERATION_POINTS,
  resolveImageGenerationRequiredPoints,
  resolveImageIdentityReferenceSurcharge,
} from "@/lib/chatImagePricing";
import {
  applyTrpgCastImagePicks,
  type TrpgIllustrationCastMember,
} from "./illustrationCast";

const ROUTE = "src/app/api/chat/comic-generation/route.ts";
const PANEL = "src/components/ChatImageGeneratorPanel.tsx";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

function member(
  participantId: number,
  name: string,
  role: "player" | "companion character",
  url: string,
  gallery: string[] = [url]
): TrpgIllustrationCastMember {
  return {
    participantId,
    characterId: participantId,
    kind: role === "player" ? "human" : "ai_character",
    name,
    aliases: [],
    gender: "male",
    role,
    imageUrl: url,
    images: gallery.map((galleryUrl) => ({ url: galleryUrl, tag: "선택" })),
    appearanceNote: "",
  };
}

/** Mirrors the route's indexed cast -> buildPartyIllustrationReferencePlan input. */
function partyPlan(count: number) {
  const names = ["렌", "라이크", "강이현", "권태현"].slice(0, count);
  const members = names.map((name, index) => ({
    name,
    gender: "male" as const,
    role: index === 0 ? "player" : "companion character",
    referenceIndex: index + 1,
    aliases: [],
    appearanceMode: "image_only" as const,
    imageUrl: `/uploads/party-${index + 1}.webp`,
    isPrimaryImage: true,
    appearanceNote: "",
  }));
  return buildPartyIllustrationReferencePlan(members);
}

function comicPlanFor(count: number) {
  const plan = buildDeterministicScenePlan(
    buildSceneSourceMessages([
      { id: 1, role: "assistant", content: "파티가 한자리에 모여 다음 행동을 의논했다." },
    ]),
    4,
    { personaName: "렌", characterName: "라이크" }
  );
  return buildChatComicGenerationPlan({
    characterName: "라이크",
    characterGender: "male",
    personaName: "렌",
    personaGender: "female",
    characterImageUrl: "/uploads/party-2.webp",
    characterSavedAppearance: "",
    characterAppearanceMode: "image_only",
    personaImageUrl: "/uploads/party-1.webp",
    personaSavedAppearance: "",
    personaAppearanceMode: "image_only",
    mood: "comic",
    plan,
    referencePack: partyPlan(count),
    contentKind: "character",
    compositionMode: "full_provider_rendered",
    fullSourceDirectText: "파티가 한자리에 모여 다음 행동을 의논했다.",
  });
}

function identityRefs(plan: ReturnType<typeof comicPlanFor>) {
  return buildComicProviderReferences({
    referenceUrls: plan.referenceUrls,
    subjects: plan.subjects,
  }).filter((reference) => reference.role !== "template");
}

describe("TRPG canonical 4-panel comic (PR-B)", () => {
  it("TRPG-COMIC-1: 1 participant -> template + 1 identity reference", () => {
    const plan = comicPlanFor(1);
    assert.equal(plan.referenceUrls[0], CHAT_COMIC_TEMPLATE_PREVIEW_URL);
    assert.equal(plan.referenceUrls.length, 2);
    assert.equal(identityRefs(plan).length, 1);
    assert.match(plan.prompt, /렌/);
    assert.match(plan.prompt, /Exactly 1 recurring human identity/);
  });

  it("TRPG-COMIC-2/3: 2 and 3 participants -> exact identity references", () => {
    const two = comicPlanFor(2);
    assert.equal(two.referenceUrls.length, 3);
    assert.equal(identityRefs(two).length, 2);
    assert.match(two.prompt, /Exactly 2 recurring human identities/);
    const three = comicPlanFor(3);
    assert.equal(three.referenceUrls.length, 4);
    assert.equal(identityRefs(three).length, 3);
    assert.match(three.prompt, /Exactly 3 recurring human identities/);
  });

  it("TRPG-COMIC-4: 4 participants -> template + 4 exact identity refs, order preserved", () => {
    const plan = comicPlanFor(4);
    assert.deepEqual(plan.referenceUrls, [
      CHAT_COMIC_TEMPLATE_PREVIEW_URL,
      "/uploads/party-1.webp",
      "/uploads/party-2.webp",
      "/uploads/party-3.webp",
      "/uploads/party-4.webp",
    ]);
    assert.equal(identityRefs(plan).length, 4);
    assert.match(plan.prompt, /Exactly 4 recurring human identities/);
    for (const name of ["렌", "라이크", "강이현", "권태현"]) {
      assert.match(plan.prompt, new RegExp(name));
    }
  });

  it("MANUAL-ASSET-PRESERVATION: distinct selected participant assets survive in order", () => {
    const members = [
      member(1, "렌", "player", "/uploads/a2.webp", ["/uploads/a1.webp", "/uploads/a2.webp"]),
      member(2, "라이크", "companion character", "/uploads/b4.webp", [
        "/uploads/b2.webp",
        "/uploads/b4.webp",
      ]),
      member(3, "강이현", "companion character", "/uploads/c1.webp"),
      member(4, "권태현", "companion character", "/uploads/d3.webp", [
        "/uploads/d1.webp",
        "/uploads/d3.webp",
      ]),
    ];
    const picked = applyTrpgCastImagePicks(members, [
      { participantId: 1, imageUrl: "/uploads/a2.webp" },
      { participantId: 2, imageUrl: "/uploads/b4.webp" },
      { participantId: 3, imageUrl: "/uploads/c1.webp" },
      { participantId: 4, imageUrl: "/uploads/d3.webp" },
    ]);
    assert.deepEqual(
      picked.map((row) => row.imageUrl),
      ["/uploads/a2.webp", "/uploads/b4.webp", "/uploads/c1.webp", "/uploads/d3.webp"]
    );
  });

  it("TRPG-COMIC-SECURITY: wrong-owner / hidden / stale asset is rejected", () => {
    const members = [
      member(1, "렌", "player", "/uploads/a.webp", ["/uploads/a.webp"]),
      member(2, "라이크", "companion character", "/uploads/b.webp", ["/uploads/b.webp"]),
    ];
    // wrong-owner: participant 1 requesting participant 2's asset
    const wrongOwner = applyTrpgCastImagePicks(members, [
      { participantId: 1, imageUrl: "/uploads/b.webp" },
    ]);
    assert.equal(wrongOwner[0]?.imageUrl, "/uploads/a.webp");
    // hidden/unavailable + stale client asset not in the server gallery
    const stale = applyTrpgCastImagePicks(members, [
      { participantId: 2, imageUrl: "/uploads/secret.webp" },
    ]);
    assert.equal(stale[1]?.imageUrl, "/uploads/b.webp");
  });

  it("SHARED-PRICING: 4 grounded refs -> base + 40P, surcharge once (not x panelCount)", () => {
    const plan = comicPlanFor(4);
    const count = identityRefs(plan).length;
    assert.equal(count, 4);
    assert.equal(resolveImageIdentityReferenceSurcharge(count), 40);
    assert.equal(resolveImageGenerationRequiredPoints(count), 220);
    assert.equal(
      resolveImageGenerationRequiredPoints(count),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
    // The comic panel count never multiplies the surcharge.
    assert.match(read(ROUTE), /const identityReferenceCount = providerReferences\.filter\(/);
    assert.doesNotMatch(
      read(ROUTE),
      /resolveImageGenerationRequiredPoints\(\s*identityReferenceCount\s*\*\s*panelCount/
    );
  });

  it("TIER2 CONTINUITY: strict fallback keeps 4 participant refs/names without a TRPG owner", () => {
    const plan = comicPlanFor(4);
    const strict = buildStrictComicFallbackPrompt({
      panelCount: 4,
      mood: "comic",
      characterName: "라이크",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      subjects: plan.subjects,
      castManifest: null,
      castSelected: undefined,
      castCount: 4,
      contentKind: "character",
      compositionMode: "full_provider_rendered",
    });
    for (const name of ["렌", "라이크", "강이현", "권태현"]) {
      assert.match(strict, new RegExp(name));
    }
    assert.match(strict, /Exactly 4 recurring identities/);
    assert.match(strict, /Image 5 belongs ONLY to 권태현/);
  });

  it("CANONICAL-OWNER-REUSE: route feeds the TRPG pack into the general comic owner", () => {
    const route = read(ROUTE);
    // WHO: TRPG participant grounding owner (server validation).
    assert.match(route, /applyTrpgCastImagePicks\(trpgScene\.members, body\.castImagePicks\)/);
    assert.match(route, /buildPartyIllustrationReferencePlan\(partyCast\)/);
    // WHAT/HOW: the SAME general comic owner + provider-reference owner.
    assert.match(route, /referencePack: trpgPartyPack/);
    assert.match(route, /buildChatComicGenerationPlan\(/);
    assert.match(route, /buildComicProviderReferences\(\{/);
    // No new TRPG-specific prompt / Scene Planner / provider caller.
    assert.doesNotMatch(route, /planChatImageScene\(/);
    assert.doesNotMatch(route, /trpgComicPlanner|buildTrpgComicPrompt/);
  });

  it("NO-EXTRA-AI-CALL: TRPG production paths use the shared round source with no focus planner", () => {
    const route = read(ROUTE);
    // No TRPG AI focus / generic Scene Planner call remains anywhere.
    assert.doesNotMatch(route, /resolveTrpgIllustrationSceneFocus|planChatImageScene/);
    const focusCalls = [...route.matchAll(/resolveTrpgIllustrationSceneFocus\(/g)].length;
    assert.equal(focusCalls, 0);
    // Illustration + comic both consume the single canonical round-source owner.
    assert.match(route, /buildTrpgRoundSourceText\(trpgScene!?\)/);
  });

  it("PERSISTENCE: TRPG comic persists campaign association + cohort fields", () => {
    const route = read(ROUTE);
    assert.match(
      route,
      /identityReferenceCount,\s*\n\s*referenceSurchargePoints: resolveImageIdentityReferenceSurcharge\(identityReferenceCount\),/
    );
    assert.match(route, /campaignId,\s*\n\s*campaignTitle: trpgCampaignTitle/);
    assert.match(route, /roundNumber: roundNumber \?\? undefined/);
    assert.match(route, /album: campaignId\s*\n?\s*\? \{ mode: "comic", campaignId, campaignTitle: trpgCampaignTitle \}/);
  });

  it("MODE-LIFECYCLE: panel keeps the user's comic choice and exposes a campaign mode toggle", () => {
    const panel = read(PANEL);
    // No blanket illustration override keyed on trpgCampaignMode.
    assert.doesNotMatch(
      panel,
      /if \(!trpgCampaignMode\) return;\s*\n\s*setSceneOutputMode\("illustration"\);/
    );
    // Default reset is tied to the campaign identity, not the selected mode.
    assert.match(panel, /if \(campaignId == null\) return;\s*\n\s*setSceneOutputMode\("illustration"\);/);
    // Campaign mode selector present.
    assert.match(panel, /onClick=\{\(\) => setSceneOutputMode\("comic"\)\}/);
    assert.match(panel, /onClick=\{\(\) => setSceneOutputMode\("illustration"\)\}/);
    // Campaign mode no longer forces illustration in the render decision.
    assert.match(panel, /const sceneIsIllustration = sceneOutputMode === "illustration";/);
    // Campaign requests send campaignId for both modes.
    assert.match(panel, /campaignId: campaignId \? campaignId : undefined/);
  });

  it("ILLUSTRATION-PRESERVE: the TRPG illustration path is untouched", () => {
    const route = read(ROUTE);
    // Participant manual picker + party reference plan remain; the focus
    // selector/planner is gone and the canonical round source feeds the
    // existing important-moment illustration owner.
    assert.match(route, /applyTrpgCastImagePicks\(trpgScene\.members, body\.castImagePicks\)/);
    assert.match(route, /buildPartyIllustrationReferencePlan\(cast\)/);
    assert.match(route, /buildChatLdIllustrationPrompt\(/);
    assert.match(route, /buildTrpgRoundSourceText\(trpgScene!\)/);
    assert.doesNotMatch(route, /resolveTrpgIllustrationSceneFocus|planChatImageScene/);
  });
});