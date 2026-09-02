import type { TrpgCampaignSnapshot, TrpgPublicAction, TrpgPublicLog, TrpgPublicRoll } from "./snapshot";
import type { RoundPresentationState } from "./roundPresentation";
import { DEFAULT_TRPG_STAT_DEFS, pointPoolFor } from "./stats";
import { DEFAULT_TRPG_BILLING_MODE, DEFAULT_TRPG_DICE_RULES, TRPG_GM_GROSS_MARGIN } from "./types";

export const SCROLL_FOLLOW_LAB_HUMAN_ID = 47;
export const SCROLL_FOLLOW_LAB_BOT1_ID = 49;
export const SCROLL_FOLLOW_LAB_BOT2_ID = 48;

/** Deterministic prose lengths exercised in browser regression F1. */
export const SCROLL_FOLLOW_LAB_PROSE_LENGTHS = [20, 80, 180, 350, 600] as const;

export function scrollFollowLabLongProse(charCount: number): string {
  const unit =
    "뷰포트가 새 선언 텍스트를 따라 내려가야 한다. 결정적 고정 문장. ";
  let out = "";
  while (out.length < charCount) out += unit;
  return out.slice(0, charCount);
}

export const SCROLL_FOLLOW_LAB_BOT1_PROSE = scrollFollowLabLongProse(120);
export const SCROLL_FOLLOW_LAB_BOT2_PROSE = scrollFollowLabLongProse(120);

function action(
  participantId: number,
  kind: TrpgPublicAction["kind"],
  name: string,
  body: string,
  revealed = true
): TrpgPublicAction {
  return { participantId, name, body, revealed, kind, actionType: "investigate" };
}

function roll(
  participantId: number,
  name: string,
  d20: number,
  tier: "SUCCESS" | "FAILURE"
): TrpgPublicRoll {
  return {
    participantId,
    name,
    d20,
    statKey: "wis",
    finalScore: d20,
    dc: 11,
    tier,
    success: tier === "SUCCESS",
    actionBody: `${name} acts`,
    actionType: "investigate",
    kind: participantId === SCROLL_FOLLOW_LAB_HUMAN_ID ? "human" : "ai_character",
  };
}

function roundLog(roundNumber: number, bot1Body: string, bot2Body: string): TrpgPublicLog {
  return {
    roundNumber,
    actions: [
      action(SCROLL_FOLLOW_LAB_HUMAN_ID, "human", "Human", `Human round ${roundNumber} action`),
      action(SCROLL_FOLLOW_LAB_BOT1_ID, "ai_character", "Bot1", bot1Body),
      action(SCROLL_FOLLOW_LAB_BOT2_ID, "ai_character", "Bot2", bot2Body),
    ],
    rolls: [
      roll(SCROLL_FOLLOW_LAB_HUMAN_ID, "Human", 12, "SUCCESS"),
      roll(SCROLL_FOLLOW_LAB_BOT1_ID, "Bot1", 9, "FAILURE"),
      roll(SCROLL_FOLLOW_LAB_BOT2_ID, "Bot2", 6, "FAILURE"),
    ],
    narration: scrollFollowLabLongProse(180),
    billedPoints: null,
    viewerSharePoints: null,
  };
}

export type ScrollFollowLabScenario = "bot1" | "bot2" | "round2-bot1";

export function scrollFollowLabPresentationSeed(
  scenario: ScrollFollowLabScenario
): RoundPresentationState {
  if (scenario === "bot2") {
    return { mode: "cinematic", phase: "actor-action", presentationIndex: 2 };
  }
  return { mode: "cinematic", phase: "actor-action", presentationIndex: 1 };
}

/** Seen keys for mount: round 1 complete + round 2 human only (bots stay fresh). */
export function scrollFollowLabSeenLogKeys(
  roundNumber: number,
  scenario: ScrollFollowLabScenario = "bot1"
): string[] {
  const round1 = roundLog(1, scrollFollowLabLongProse(120), scrollFollowLabLongProse(120));
  const keys: string[] = [];
  for (const row of [round1]) {
    for (const item of row.actions) {
      if (item.revealed && item.body.trim()) keys.push(`a:${row.roundNumber}:${item.participantId}`);
    }
    if (row.narration?.trim()) keys.push(`n:${row.roundNumber}`);
  }
  keys.push(`a:${roundNumber}:${SCROLL_FOLLOW_LAB_HUMAN_ID}`);
  if (scenario === "bot2") {
    keys.push(`a:${roundNumber}:${SCROLL_FOLLOW_LAB_BOT1_ID}`);
  }
  return keys;
}

export function buildScrollFollowLabSnapshot(opts?: {
  roundNumber?: number;
  bot1Body?: string;
  bot2Body?: string;
}): TrpgCampaignSnapshot {
  const roundNumber = opts?.roundNumber ?? 2;
  const bot1Body = opts?.bot1Body ?? SCROLL_FOLLOW_LAB_BOT1_PROSE;
  const bot2Body = opts?.bot2Body ?? SCROLL_FOLLOW_LAB_BOT2_PROSE;
  const round1 = roundLog(1, scrollFollowLabLongProse(180), scrollFollowLabLongProse(180));
  const current = roundLog(roundNumber, bot1Body, bot2Body);
  const resolutionOrder = [
    {
      participantId: SCROLL_FOLLOW_LAB_HUMAN_ID,
      name: "Human",
      slotIndex: 0,
      statKey: "dex" as const,
      statLabel: "민첩",
      statValue: 5,
    },
    {
      participantId: SCROLL_FOLLOW_LAB_BOT1_ID,
      name: "Bot1",
      slotIndex: 1,
      statKey: "dex" as const,
      statLabel: "민첩",
      statValue: 5,
    },
    {
      participantId: SCROLL_FOLLOW_LAB_BOT2_ID,
      name: "Bot2",
      slotIndex: 2,
      statKey: "dex" as const,
      statLabel: "민첩",
      statValue: 5,
    },
  ];
  const adjudicatedParticipantIds = [
    SCROLL_FOLLOW_LAB_HUMAN_ID,
    SCROLL_FOLLOW_LAB_BOT1_ID,
    SCROLL_FOLLOW_LAB_BOT2_ID,
  ];

  return {
    id: 99001,
    title: "Scroll Follow Lab",
    inviteCode: "SCROLL-LAB",
    invitePath: "/trpg/join/SCROLL-LAB",
    hostUserId: 1,
    sourceCharacterId: null,
    worldBrief: "Scroll-follow browser lab fixture.",
    relationshipBrief: "Lab party.",
    billingMode: DEFAULT_TRPG_BILLING_MODE,
    billingModeLocked: false,
    campaignStatus: "ACTIVE",
    maxSlots: 4,
    pointPool: pointPoolFor(DEFAULT_TRPG_STAT_DEFS),
    statDefs: DEFAULT_TRPG_STAT_DEFS,
    diceRules: DEFAULT_TRPG_DICE_RULES,
    suggestedPcStats: null,
    viewerParticipantId: SCROLL_FOLLOW_LAB_HUMAN_ID,
    viewerPersonaId: 1,
    viewerUserId: 1,
    viewerIsHost: true,
    botRetryRequired: false,
    needsHostFill: false,
    hostFillBotIds: [],
    round: {
      id: roundNumber,
      number: roundNumber,
      phase: "GENERATING_NARRATION",
      expectedPresentationActorIds: adjudicatedParticipantIds,
    },
    participants: [
      {
        id: SCROLL_FOLLOW_LAB_HUMAN_ID,
        slotIndex: 0,
        kind: "human",
        userId: 1,
        characterId: null,
        displayName: "Human",
        canAct: true,
        status: "active",
        ready: "submitted",
        hasSheet: true,
        sheetConfirmed: true,
      },
      {
        id: SCROLL_FOLLOW_LAB_BOT1_ID,
        slotIndex: 1,
        kind: "ai_character",
        userId: null,
        characterId: 18,
        displayName: "Bot1",
        canAct: true,
        status: "active",
        ready: "submitted",
        hasSheet: true,
        sheetConfirmed: true,
      },
      {
        id: SCROLL_FOLLOW_LAB_BOT2_ID,
        slotIndex: 2,
        kind: "ai_character",
        userId: null,
        characterId: 17,
        displayName: "Bot2",
        canAct: true,
        status: "active",
        ready: "submitted",
        hasSheet: true,
        sheetConfirmed: true,
      },
    ],
    sheets: [
      {
        participantId: SCROLL_FOLLOW_LAB_HUMAN_ID,
        isSelf: true,
        html: "<p>Human sheet</p>",
        sheet: {
          participantId: SCROLL_FOLLOW_LAB_HUMAN_ID,
          name: "Human",
          playerName: "Human",
          level: 1,
          hp: 25,
          maxHp: 25,
          stats: { str: 5, dex: 5, int: 5, wis: 5, cha: 5, con: 5 },
          conditions: [],
          inventory: [],
          location: "Lab",
          modifiersNote: "",
        },
      },
    ],
    myDraft: { body: "", actionType: "free", selectedStat: null, locked: true },
    currentRolls: current.rolls,
    resolutionOrder,
    adjudicatedParticipantIds,
    participantAdjudicationOutcomes: {
      [SCROLL_FOLLOW_LAB_HUMAN_ID]: "roll",
      [SCROLL_FOLLOW_LAB_BOT1_ID]: "roll",
      [SCROLL_FOLLOW_LAB_BOT2_ID]: "roll",
    },
    currentNarration: null,
    gmNarrationDraft: null,
    log: [round1, current],
    workType: "idle",
    shouldKickAdvance: false,
    botGenerationInFlight: false,
    gmGenerationInFlight: false,
    processStartedAtMs: Date.now() - 4000,
    processStage: null,
    lastBilledPoints: null,
    partyHumanCount: 1,
    partyBotCount: 2,
    gmGrossMargin: TRPG_GM_GROSS_MARGIN,
    botGrossMargin: TRPG_GM_GROSS_MARGIN,
    partyChat: [],
    canRerollRoundNumber: null,
    narrationRerolling: false,
    scenarioAssets: [],
    aiCharacterAssets: [],
    scenarioNpcImages: [],
  };
}
