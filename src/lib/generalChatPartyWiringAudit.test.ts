/**
 * General Chat party mode production wiring audit (NOT TRPG).
 * Zero provider calls — documents whether party state reaches runtime.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  applyProductionServerControlsToMessages,
  countPacingOwners,
} from "@/lib/scenePacingController";
import {
  buildSceneDirective,
  renderSceneDirectiveForPrompt,
} from "@/lib/sceneDirective";
import { buildContext } from "@/services/contextBuilder";
import { SCENE_FLOW_BLOCK } from "@/lib/generationProcessBeatFlow";

const PRIMARY = "테스트주인공";
const SUPPORT = "테스트조연";
const ROUTE_SOURCE = readFileSync(
  new URL("../app/api/chat/route.ts", import.meta.url),
  "utf8"
);

function wireStandard(input: {
  party?: boolean;
  skipMotionCue?: boolean;
  fullBlock?: string;
  contentKind?: "character" | "simulation";
}) {
  const directive = buildSceneDirective({
    mode: "interactive",
    contentKind: input.contentKind ?? "character",
    primaryCharacterName: PRIMARY,
    party: input.party ?? false,
    establishedActiveCastNames: input.party ? [SUPPORT] : undefined,
    currentUserMessage: "조용히 있다.",
    chatId: 2001,
    currentTurn: 2,
  });
  const block = input.fullBlock ?? (input.party ? renderSceneDirectiveForPrompt(directive) : "");
  return applyProductionServerControlsToMessages({
    messages: [
      {
        role: "system",
        content: `[CORE]\n${SCENE_FLOW_BLOCK}${block ? `\n${block}` : ""}\n[IMMERSIVE PROSE]\nok`,
      },
      { role: "user", content: "조용히 있다." },
    ],
    mode: "interactive",
    contentKind: input.contentKind ?? "character",
    primaryCharacterName: PRIMARY,
    currentUserMessage: "조용히 있다.",
    party: input.party ?? false,
    establishedActiveCastNames: input.party ? [SUPPORT] : undefined,
    canonicalSceneDirective: directive,
    skipMotionCue: input.skipMotionCue ?? !!input.party,
  });
}

describe("general chat party wiring audit W1-W15", () => {
  it("W1 canonical party source — no production General Chat party config exists", () => {
    assert.match(ROUTE_SOURCE, /party:\s*false/);
    assert.doesNotMatch(ROUTE_SOURCE, /party:\s*true/);
    assert.doesNotMatch(ROUTE_SOURCE, /input\.party|chat\.party|party_mode/);
    assert.doesNotMatch(ROUTE_SOURCE, /knownSupportingCastNames:\s*\[/);
    const dbSource = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
    assert.doesNotMatch(dbSource, /addColumn\("chats", "party"/);
    assert.match(dbSource, /CREATE TABLE IF NOT EXISTS party_rooms/);
    assert.doesNotMatch(
      readFileSync(new URL("../app/chat/[id]/ChatClient.tsx", import.meta.url), "utf8"),
      /party/i
    );
  });

  it("W2 normal single chat — party=false, compact Standard only", () => {
    const applied = wireStandard({ party: false, skipMotionCue: false });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 1);
    assert.equal(owners.scene_flow, 0);
    assert.doesNotMatch(system, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.equal(applied.decision.castMode, "single_primary");
  });

  it("W3 valid party harness — party=true, full directive only (skipMotionCue)", () => {
    const applied = wireStandard({ party: true, skipMotionCue: true });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 0);
    assert.match(system, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.equal(applied.decision.castMode, "ensemble");
    assert.equal(applied.decision.pacingMode, "ENSEMBLE");
  });

  it("W4 request/API — route has no party request parsing (hardcoded false)", () => {
    assert.match(ROUTE_SOURCE, /sceneServerControls:\s*\{[\s\S]*party:\s*false/);
    assert.doesNotMatch(ROUTE_SOURCE, /body\.party|req\.party|partyMode/);
  });

  it("W5 route → buildSceneDirective omits party flag today", () => {
    const buildIdx = ROUTE_SOURCE.indexOf("buildSceneDirective({");
    assert.ok(buildIdx >= 0);
    const snippet = ROUTE_SOURCE.slice(buildIdx, buildIdx + 900);
    assert.doesNotMatch(snippet, /party:/);
  });

  it("W6 runtime harness — SceneDirectiveInput.party=true resolves ensemble cast", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      party: true,
      establishedActiveCastNames: [SUPPORT],
      currentUserMessage: "모두 조용히 있다.",
      chatId: 2002,
      currentTurn: 2,
    });
    assert.equal(d.castFocus.sceneCastMode, "ensemble");
  });

  it("W7 final prompt owner count = 1 per path", () => {
    const single = wireStandard({ party: false });
    const party = wireStandard({ party: true, skipMotionCue: true });
    const singleOwners = countPacingOwners(
      single.messages.find((m) => m.role === "system")?.content ?? ""
    );
    const partyOwners = countPacingOwners(
      party.messages.find((m) => m.role === "system")?.content ?? ""
    );
    assert.equal(singleOwners.pacing_sot_count, 1);
    assert.equal(partyOwners.pacing_sot_count, 1);
  });

  it("W8 party regen path — buildContext omits party (defaults safe single)", () => {
    const built = buildContext({
      charName: PRIMARY,
      contentKind: "character",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "[SYSTEM: REGENERATE — rewrite ONLY the last assistant message]",
      nsfw: false,
      provider: "openrouter",
      regenerate: true,
      rejectedAssistantDraft: "테스트 초안.",
    });
    assert.doesNotMatch(built.systemPrompt, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.doesNotMatch(built.systemPrompt, /\[3d\] Private scene directive/);
  });

  it("W9 reload/reconnect — buildContext without party stays non-ensemble", () => {
    const built = buildContext({
      charName: PRIMARY,
      contentKind: "character",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [{ role: "assistant", content: "..." }],
      currentUserMessage: "이어서.",
      nsfw: false,
      provider: "openrouter",
    });
    assert.doesNotMatch(built.systemPrompt, /\[SIMULATION MODE — ENSEMBLE CAST\]/);
  });

  it("W10 missing party field — defaults to single_primary cast", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      currentUserMessage: "안녕.",
      chatId: 2003,
      currentTurn: 1,
    });
    assert.equal(d.castFocus.sceneCastMode, "single_primary");
  });

  it("W11 known supporting cast alone does not set party=true", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      knownSupportingCastNames: [SUPPORT],
      currentUserMessage: `${SUPPORT}을 바라본다.`,
      chatId: 2004,
      currentTurn: 2,
    });
    assert.equal(d.castFocus.sceneCastMode, "single_primary");
    assert.notEqual(d.castFocus.sceneCastMode, "ensemble");
  });

  it("W12 party=true without grounded support — no ungrounded npc_action", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      party: true,
      establishedActiveCastNames: [],
      currentUserMessage: "회의를 계속하자.",
      chatId: 2005,
      currentTurn: 2,
    });
    assert.equal(d.npcGrounding.existingNpcEligible, false);
    assert.ok(!d.progressionTypes.includes("npc_action"));
  });

  it("W13 off-scene party member — roster mention does not add non-roster actor", () => {
    const d = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      party: true,
      establishedActiveCastNames: [],
      knownSupportingCastNames: [SUPPORT],
      recentMessages: [{ role: "assistant", content: `${SUPPORT}은 이미 퇴장했다.` }],
      currentUserMessage: `${PRIMARY}을 바라본다.`,
      chatId: 2006,
      currentTurn: 4,
    });
    assert.ok(!d.castFocus.activeSpeakingCast.includes(SUPPORT));
    assert.equal(d.npcGrounding.existingNpcEligible, false);
  });

  it("W14 simulation path uses contentKind not party flag", () => {
    const sim = buildSceneDirective({
      mode: "interactive",
      contentKind: "simulation",
      primaryCharacterName: PRIMARY,
      establishedActiveCastNames: [SUPPORT, "테스트NPC"],
      currentUserMessage: "주변을 본다.",
      chatId: 2007,
      currentTurn: 1,
    });
    assert.equal(sim.castFocus.sceneCastMode, "simulation");
    const partyChar = buildSceneDirective({
      mode: "interactive",
      contentKind: "character",
      primaryCharacterName: PRIMARY,
      party: true,
      establishedActiveCastNames: [SUPPORT],
      currentUserMessage: "주변을 본다.",
      chatId: 2008,
      currentTurn: 1,
    });
    assert.equal(partyChar.castFocus.sceneCastMode, "ensemble");
    assert.notEqual(sim.castFocus.sceneCastMode, partyChar.castFocus.sceneCastMode);
    const built = buildContext({
      charName: PRIMARY,
      contentKind: "simulation",
      chunks: [],
      systemPrompt: "[SIMULATION CAST]\n[서윤]",
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "주변을 본다.",
      nsfw: false,
      provider: "openrouter",
    });
    assert.match(built.systemPrompt, /\[SIMULATION MODE — ENSEMBLE CAST\]/);
    const withBlock = buildContext({
      charName: PRIMARY,
      contentKind: "simulation",
      chunks: [],
      userNickname: "유저",
      shortTermHistory: [],
      currentUserMessage: "주변을 본다.",
      nsfw: false,
      provider: "openrouter",
      sceneDirectiveBlock: renderSceneDirectiveForPrompt(sim),
    });
    assert.match(withBlock.systemPrompt, /\[PRIVATE SCENE ENGINE RULE\]/);
  });

  it("W15 TRPG party code is separate from General Chat route", () => {
    assert.doesNotMatch(ROUTE_SOURCE, /trpg_party|TrpgParty|party-chat/);
    assert.doesNotMatch(ROUTE_SOURCE, /from "@\/lib\/trpg\/party/);
    const trpgRoute = readFileSync(
      new URL("../app/api/trpg/campaigns/[id]/party-chat/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(trpgRoute, /postTrpgPartyChat/);
    assert.doesNotMatch(trpgRoute, /buildSceneDirective/);
  });
});

describe("general chat party wiring — dual motion owner guard (harness)", () => {
  it("party=true without skipMotionCue would duplicate motion (must not ship)", () => {
    const applied = wireStandard({ party: true, skipMotionCue: false });
    const system = applied.messages.find((m) => m.role === "system")?.content ?? "";
    const owners = countPacingOwners(system);
    assert.equal(owners.scene_pacing, 1);
    assert.match(system, /\[PRIVATE SCENE ENGINE RULE\]/);
    assert.ok(
      (system.match(/\[PRIVATE SCENE ENGINE RULE\]/g) ?? []).length >= 1 &&
        (system.match(/\[SCENE PACING\]/g) ?? []).length >= 1
    );
  });
});
