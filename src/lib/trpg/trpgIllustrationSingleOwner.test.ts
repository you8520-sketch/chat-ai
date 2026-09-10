import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ILLUSTRATION_IMPORTANT_MOMENT_CONTRACT,
  buildChatLdIllustrationPrompt,
} from "@/lib/chatLdIllustrationGeneration";
import {
  CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS,
  CHAT_ROOM_IMAGE_GENERATION_POINTS,
  resolveImageGenerationRequiredPoints,
} from "@/lib/chatImagePricing";
import { buildTrpgRoundSourceText } from "@/lib/trpg/roundSource";

const ROUTE = "src/app/api/chat/comic-generation/route.ts";
const PANEL = "src/components/ChatImageGeneratorPanel.tsx";

function read(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

const ONE_CAST = [
  {
    name: "렌",
    gender: "female" as const,
    role: "player",
    referenceIndex: 1,
    aliases: [],
  },
];

describe("TRPG illustration single canonical owner (focus removal)", () => {
  it("TRPG-ILLUSTRATION-SINGLE-OWNER: no focus/Scene Planner; canonical round source -> important-moment owner", () => {
    const route = read(ROUTE);
    // Focus selection + Scene Planner removed from every production path.
    assert.doesNotMatch(route, /resolveTrpgIllustrationSceneFocus/);
    assert.doesNotMatch(route, /planChatImageScene/);
    assert.doesNotMatch(route, /trpgAiFocus|TrpgImageSceneMode|trpgImageSceneMode/);
    // Canonical round source feeds the existing important-moment illustration owner.
    assert.match(route, /buildTrpgRoundSourceText\(trpgScene!\)/);
    assert.match(route, /buildChatLdIllustrationPrompt\(/);
    // No new TRPG-specific prompt owner.
    assert.doesNotMatch(route, /buildTrpgIllustrationPrompt|trpgIllustrationContract/);
  });

  it("SOURCE-PRESERVATION: location + actions + GM narration reach the final illustration prompt", () => {
    const source = buildTrpgRoundSourceText({
      location: "UNIQUE_LOCATION_ALPHA",
      actions: [{ name: "렌", body: "UNIQUE_ACTION_BETA" }],
      narration: "UNIQUE_NARRATION_GAMMA",
    });
    const prompt = buildChatLdIllustrationPrompt({
      characterName: "라이크",
      characterGender: "male",
      personaName: "렌",
      personaGender: "female",
      currentTurn: source,
      cast: ONE_CAST,
      fullSource: source,
    });
    assert.match(prompt, /UNIQUE_LOCATION_ALPHA/, "location preserved");
    assert.match(prompt, /UNIQUE_ACTION_BETA/, "locked action preserved");
    assert.match(prompt, /UNIQUE_NARRATION_GAMMA/, "GM narration preserved");
    // Uses the existing canonical important-moment contract, not a TRPG owner.
    assert.match(prompt, /SELECTED TURN — SINGLE IMPORTANT VISUAL MOMENT/);
    assert.ok(prompt.includes(ILLUSTRATION_IMPORTANT_MOMENT_CONTRACT));
  });

  it("UI-FOCUS-REMOVAL: no focus selector/state/request field; campaign mode toggle retained", () => {
    const panel = read(PANEL);
    assert.doesNotMatch(panel, /장면 초점/);
    assert.doesNotMatch(panel, /CURRENT_RAW/);
    assert.doesNotMatch(panel, /AI_FOCUS/);
    assert.doesNotMatch(panel, /trpgImageSceneMode|TrpgImageSceneMode/);
    assert.doesNotMatch(panel, /trpgImageSceneDiagnostics|TrpgImageSceneDiagnosticsPanel/);
    // Campaign [일러스트][4컷 만화] selector remains.
    assert.match(panel, /onClick=\{\(\) => setSceneOutputMode\("illustration"\)\}/);
    assert.match(panel, /onClick=\{\(\) => setSceneOutputMode\("comic"\)\}/);
  });

  it("PRICE-PARITY: 2/3/4 grounded refs -> 180/200/220 via the shared canonical owner", () => {
    assert.equal(CHAT_ROOM_IMAGE_GENERATION_POINTS, 180);
    assert.equal(resolveImageGenerationRequiredPoints(2), 180);
    assert.equal(resolveImageGenerationRequiredPoints(3), 200);
    assert.equal(resolveImageGenerationRequiredPoints(4), 220);
    assert.equal(
      resolveImageGenerationRequiredPoints(4),
      CHAT_ROOM_IMAGE_GENERATION_POINTS + 2 * CHAT_IMAGE_REFERENCE_SURCHARGE_POINTS
    );
    // The panel quotes the shared owner (estimate only; server is authority).
    assert.match(read(PANEL), /resolveImageGenerationRequiredPoints/);
  });

  it("BALANCE: preflight runs before startJob/provider; no planner call in the path", () => {
    const route = read(ROUTE);
    const preflightIndex = route.indexOf("포인트가 부족합니다. 선택 턴 LD 일러스트에는");
    const startJobIndex = route.indexOf('startJob(CHAT_LD_ILLUSTRATION_TEMPLATE_ID, "illustration")');
    const providerIndex = route.indexOf("await generateLdIllustrationImage({");
    assert.ok(preflightIndex > -1 && preflightIndex < startJobIndex);
    assert.ok(startJobIndex > -1 && providerIndex > -1 && startJobIndex < providerIndex);
    assert.doesNotMatch(route, /resolveTrpgIllustrationSceneFocus|planChatImageScene/);
  });

  it("MODE-LIFECYCLE: panel preserves participant cast/picks and does not reset user mode", () => {
    const panel = read(PANEL);
    // Campaign mode toggle does not clear the picks.
    const toggleBlock = panel.slice(
      panel.indexOf("onClick={() => setSceneOutputMode(\"illustration\")}"),
      panel.indexOf("onClick={() => setSceneOutputMode(\"comic\")}") + 50
    );
    assert.doesNotMatch(toggleBlock, /setPartyPicks|setPartyCast/);
    // Default reset is tied to the campaign identity, not the selected mode.
    assert.match(panel, /if \(campaignId == null\) return;\s*\n\s*setSceneOutputMode\("illustration"\);/);
    assert.doesNotMatch(
      panel,
      /if \(!trpgCampaignMode\) return;\s*\n\s*setSceneOutputMode\("illustration"\);/
    );
  });

  it("TIER2/SETTLEMENT: party strict fallback + settlement unchanged; no focus owner", () => {
    const route = read(ROUTE);
    assert.match(route, /buildStrictLdPartyFallbackPrompt\(/);
    assert.match(route, /settleChatImageGenerationResult\(/);
    assert.match(route, /identityReferenceCount,\s*\n\s*referenceSurchargePoints:/);
    assert.doesNotMatch(route, /trpgImageSceneMode|trpgAiFocusDiagnostics/);
  });

  it("GENERAL-ILLUSTRATION-PRESERVE: the shared important-moment contract is unchanged", () => {
    assert.match(
      ILLUSTRATION_IMPORTANT_MOMENT_CONTRACT,
      /select the single most important and visually expressive moment/
    );
    const source = read("src/lib/chatLdIllustrationGeneration.ts");
    // The duo (non-party) branch still uses the same canonical contract.
    assert.match(source, /ILLUSTRATION_IMPORTANT_MOMENT_CONTRACT/);
    assert.match(source, /export const ILLUSTRATION_IMPORTANT_MOMENT_CONTRACT/);
  });
});