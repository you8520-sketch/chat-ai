import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  classifySceneMode,
  resolveAdultEligibility,
  decideAdultModelRoute,
  type SceneClassification,
  type ModelRouteState,
  type SceneMode,
} from "./adultSceneRouting";
import { resolveAdultDeliveryPlan } from "./adultDeliveryPlan";
import { ensureObserverSchema } from "./observerSchema";
import {
  buildProspectiveSecondarySceneSafetySnapshot,
  computeSecondarySceneSafetySnapshot,
  evaluateCurrentTurnSecondarySceneSafetyShadow,
  markSecondarySafetyCoverageIncomplete,
} from "./secondarySceneParticipantSafety";
import { ensureSecondarySceneParticipantSafetySchema } from "./secondarySceneParticipantSafetySchema";
import {
  evaluateSecondarySceneParticipantGuard,
  isSecondarySceneParticipantGuardEnabled,
  secondarySceneParticipantGuardUserMessage,
} from "./secondarySceneParticipantGuard";
import {
  getSecondarySafetyCoverage,
  resolveSecondarySafetyCoverage,
} from "./secondarySceneParticipantSafetyStore";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "./chatModels";

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const ELIGIBLE = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  characterAdultContentEnabled: true,
  participants: [
    { adultStatus: "confirmed", age: 25, description: "주인공 25세" },
    { description: "페르소나", isVerifiedAdultUserPersona: true },
  ],
  actualNonConsent: false,
});

const DEFAULT_STATE: ModelRouteState = {
  activeRoute: "general",
  currentSceneMode: "normal",
  adultRouteMinimumTurnsRemaining: 0,
  safeSceneStreak: 0,
  activeConsentMode: "standard",
  sexualContextActive: false,
};

const PROVIDER_CAPABILITIES: Record<string, SceneMode> = {
  anthropic: "tension",
  google: "tension",
  openai: "tension",
  deepseek: "explicit",
};

function memDb(): Database.Database {
  const db = new Database(":memory:");
  ensureObserverSchema(db);
  ensureSecondarySceneParticipantSafetySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function seedLegacyUserTurn(db: Database.Database, chatId: number): void {
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, created_at)
     VALUES (?, 1, 1, datetime('now'))`
  ).run(chatId);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, created_at)
     VALUES (?, ?, 'user', 'legacy', datetime('now'))`
  ).run(1, chatId);
}

function classification(
  overrides: Partial<SceneClassification> = {}
): SceneClassification {
  return {
    sceneMode: "explicit",
    sexualContextActive: true,
    currentInputExplicitIntent: true,
    requiresAdultCapableModel: true,
    transientAdultCapableRoute: false,
    actualNonConsent: false,
    oocIntent: "none",
    sceneReset: false,
    hardStop: false,
    oocStop: false,
    clearSceneTransition: false,
    reason: "explicit_action",
    ...overrides,
  };
}

function guard(input: {
  sceneMode?: SceneMode;
  message?: string;
  chatId?: number;
  currentTurn?: number;
  sceneReset?: boolean;
  clearSceneTransition?: boolean;
  sexualContextActive?: boolean;
  explicitIntent?: boolean;
  db?: Database.Database;
  safetyEvaluationFailed?: boolean;
}) {
  const db = input.db ?? memDb();
  const chatId = input.chatId ?? 920001;
  const currentTurn = input.currentTurn ?? 1;
  const sceneClassification = classifySceneMode({
    currentInput: input.message ?? "둘이서만 있다.",
    previousSceneMode:
      input.sceneMode === "tension" ? "tension" : "normal",
  });
  if (input.sceneMode) {
    sceneClassification.sceneMode = input.sceneMode;
  }
  if (input.sexualContextActive != null) {
    sceneClassification.sexualContextActive = input.sexualContextActive;
  }
  if (input.explicitIntent != null) {
    sceneClassification.currentInputExplicitIntent = input.explicitIntent;
    sceneClassification.requiresAdultCapableModel = input.explicitIntent;
  }
  if (input.sceneReset) sceneClassification.sceneReset = true;
  if (input.clearSceneTransition) {
    sceneClassification.clearSceneTransition = true;
  }

  const prospective = input.safetyEvaluationFailed
    ? null
    : buildProspectiveSecondarySceneSafetySnapshot({
        chatId,
        currentTurn,
        currentUserMessage: input.message ?? "",
        sceneReset: sceneClassification.sceneReset === true,
        clearSceneTransition: sceneClassification.clearSceneTransition === true,
        sexualContextActive: sceneClassification.sexualContextActive,
        db,
      });

  return {
    sceneClassification,
    prospective,
    result: evaluateSecondarySceneParticipantGuard({
      sceneClassification,
      baseAdultEligibility: ELIGIBLE,
      prospectiveSecondarySafety: prospective,
      adultRoutingEnabled: true,
      safetyEvaluationFailed: input.safetyEvaluationFailed,
    }),
    db,
    chatId,
  };
}

describe("S2-A legacy coverage resolver", () => {
  it("new chat turn1 coverage is COMPLETE / tracked_from_chat_start", () => {
    const db = memDb();
    const resolution = resolveSecondarySafetyCoverage({
      chatId: 1,
      priorPlayableTurns: 0,
      db,
    });
    assert.equal(resolution.coverage, "COMPLETE");
    assert.equal(resolution.reason, "tracked_from_chat_start");
  });

  it("new chat turn1 commit persists COMPLETE row", () => {
    const db = memDb();
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId: 920010,
      userMessage: "처음 대화를 시작한다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 1,
      db,
    });
    assert.equal(getSecondarySafetyCoverage(920010, db), "COMPLETE");
  });

  it("new chat turn2 stays COMPLETE after turn1 commit", () => {
    const db = memDb();
    const chatId = 920011;
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "turn1",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 1,
      db,
    });
    const turn2 = resolveSecondarySafetyCoverage({
      chatId,
      priorPlayableTurns: 1,
      db,
    });
    assert.equal(turn2.coverage, "COMPLETE");
  });

  it("legacy chat with prior turns and no row is INCOMPLETE", () => {
    const db = memDb();
    const chatId = 920012;
    seedLegacyUserTurn(db, chatId);
    const resolution = resolveSecondarySafetyCoverage({
      chatId,
      priorPlayableTurns: 1,
      db,
    });
    assert.equal(resolution.coverage, "INCOMPLETE");
    assert.equal(resolution.reason, "legacy_history_untracked");
  });

  it("legacy + explicit minor stays visible and INCOMPLETE coverage blocks explicit", () => {
    const db = memDb();
    const chatId = 920013;
    seedLegacyUserTurn(db, chatId);
    const { result, prospective } = guard({
      chatId,
      currentTurn: 2,
      message: "17살 동생이 들어왔다.",
      sceneMode: "explicit",
      db,
    });
    assert.equal(prospective?.minorParticipantIds.length, 1);
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_participant_minor");
  });

  it("legacy sceneReset yields COMPLETE coverage", () => {
    const db = memDb();
    const chatId = 920014;
    seedLegacyUserTurn(db, chatId);
    const resolution = resolveSecondarySafetyCoverage({
      chatId,
      priorPlayableTurns: 1,
      sceneReset: true,
      db,
    });
    assert.equal(resolution.coverage, "COMPLETE");
    assert.equal(resolution.reason, "scene_reset");
  });
});

describe("S2-B/C SecondarySceneParticipantGuard matrix", () => {
  const ENV_KEY = "SECONDARY_SCENE_PARTICIPANT_GUARD_ENABLED";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it("1 adult-only new tracked chat explicit -> ALLOW", () => {
    const { result } = guard({
      message: "둘이 침대에 누워 서로를 바라본다.",
      sceneMode: "explicit",
    });
    assert.equal(result.action, "ALLOW");
  });

  it("2 unrelated child world -> ALLOW", () => {
    const { result } = guard({
      message: "오늘은 둘만 있는 방이다.",
      sceneMode: "normal",
    });
    assert.equal(result.action, "ALLOW");
  });

  it("3 historical 17 mention -> ALLOW", () => {
    const { result } = guard({
      message: "17살 때 만났던 친구 이야기를 했다.",
      sceneMode: "explicit",
    });
    assert.equal(result.action, "ALLOW");
  });

  it("5 authoritative adult secondary explicit -> ALLOW", () => {
    const db = memDb();
    const snap = computeSecondarySceneSafetySnapshot([], { coverage: "COMPLETE" });
    const result = evaluateSecondarySceneParticipantGuard({
      sceneClassification: classification({ sceneMode: "explicit" }),
      baseAdultEligibility: ELIGIBLE,
      prospectiveSecondarySafety: snap,
      adultRoutingEnabled: true,
    });
    assert.equal(result.action, "ALLOW");
  });

  it("6 dynamic 17-year-old explicit -> HARD_BLOCK", () => {
    const { result } = guard({
      message: "17살 민수가 방으로 들어왔다.",
      sceneMode: "explicit",
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_participant_minor");
  });

  it("8 unknown secondary explicit -> HARD_BLOCK", () => {
    const { result } = guard({
      message: "민수가 방으로 들어왔다.",
      sceneMode: "explicit",
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_participant_unknown");
  });

  it("9 real-person secondary explicit -> HARD_BLOCK", () => {
    const { result } = guard({
      message: "실존 인물인 민수가 방으로 들어왔다.",
      sceneMode: "explicit",
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_real_person");
  });

  it("10 conflict explicit -> HARD_BLOCK", () => {
    const db = memDb();
    const chatId = 920020;
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "",
      sceneReset: false,
      currentTurn: 1,
      authoritativeActors: [
        {
          stableId: "auth-minsu",
          displayName: "민수",
          kind: "creator_npc",
          metadata: { age: 22, adultStatus: "confirmed" },
        },
      ],
      db,
    });
    const { result } = guard({
      chatId,
      currentTurn: 2,
      message: "17살 민수가 들어왔다.",
      sceneMode: "explicit",
      db,
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_participant_conflict");
  });

  it("11 normal family + minor -> DISABLE handoff only", () => {
    const { result } = guard({
      message: "17살 동생이 들어왔다.",
      sceneMode: "normal",
    });
    assert.equal(result.action, "DISABLE_ADULT_HANDOFF_ONLY");
    assert.equal(result.reason, "secondary_participant_minor");
  });

  it("12 romantic + unknown -> DISABLE handoff only", () => {
    const { result } = guard({
      message: "민수가 방으로 들어왔다.",
      sceneMode: "romantic",
    });
    assert.equal(result.action, "DISABLE_ADULT_HANDOFF_ONLY");
  });

  it("13 tension sexual + minor -> HARD_BLOCK", () => {
    const { result } = guard({
      message: "17살 동생이 들어왔다.",
      sceneMode: "tension",
      sexualContextActive: true,
      explicitIntent: true,
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
  });

  it("14 aftercare + minor -> HARD_BLOCK", () => {
    const { result } = guard({
      message: "17살 동생이 들어왔다.",
      sceneMode: "aftercare",
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
  });

  it("20 legacy incomplete normal -> DISABLE handoff", () => {
    const db = memDb();
    const chatId = 920021;
    seedLegacyUserTurn(db, chatId);
    const { result } = guard({
      chatId,
      currentTurn: 2,
      message: "오늘 날씨가 좋다.",
      sceneMode: "normal",
      db,
    });
    assert.equal(result.action, "DISABLE_ADULT_HANDOFF_ONLY");
    assert.equal(result.reason, "secondary_safety_coverage_incomplete");
  });

  it("21 legacy incomplete explicit -> HARD_BLOCK", () => {
    const db = memDb();
    const chatId = 920022;
    seedLegacyUserTurn(db, chatId);
    const { result } = guard({
      chatId,
      currentTurn: 2,
      message: "둘이 침대에 누웠다.",
      sceneMode: "explicit",
      db,
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_safety_coverage_incomplete");
  });

  it("25 safety error normal -> DISABLE handoff", () => {
    const { result } = guard({
      message: "오늘은 편안한 하루다.",
      sceneMode: "normal",
      safetyEvaluationFailed: true,
    });
    assert.equal(result.action, "DISABLE_ADULT_HANDOFF_ONLY");
    assert.equal(result.reason, "secondary_safety_unavailable");
  });

  it("26 safety error explicit -> HARD_BLOCK", () => {
    const { result } = guard({
      message: "둘이 격렬하게 얽혔다.",
      sceneMode: "explicit",
      safetyEvaluationFailed: true,
    });
    assert.equal(result.action, "HARD_BLOCK_TURN");
    assert.equal(result.reason, "secondary_safety_unavailable");
  });

  it("27 flag defaults OFF", () => {
    delete process.env[ENV_KEY];
    assert.equal(isSecondarySceneParticipantGuardEnabled(), false);
  });

  it("user-facing copy stays generic Korean", () => {
    assert.match(
      secondarySceneParticipantGuardUserMessage(),
      /성인 장면을 진행할 수 없습니다/
    );
    assert.doesNotMatch(
      secondarySceneParticipantGuardUserMessage(),
      /DeepSeek|Gemini|handoff/i
    );
  });
});

describe("S2-M route-level guard wiring seam", () => {
  function runGuardedDelivery(input: {
    message: string;
    sceneMode?: SceneMode;
    sexualContextActive?: boolean;
    guardEnabled?: boolean;
    safetyEvaluationFailed?: boolean;
    priorLegacyTurn?: boolean;
    db?: Database.Database;
  }) {
    const db = input.db ?? memDb();
    const chatId = 930001;
    if (input.priorLegacyTurn) {
      seedLegacyUserTurn(db, chatId);
    }
    const sceneClassification = classification({
      sceneMode: input.sceneMode ?? "explicit",
      sexualContextActive: input.sexualContextActive ?? true,
    });
    if (input.sceneMode === "normal") {
      sceneClassification.sceneMode = "normal";
      sceneClassification.sexualContextActive = false;
      sceneClassification.currentInputExplicitIntent = false;
      sceneClassification.requiresAdultCapableModel = false;
    }
    const prospective = input.safetyEvaluationFailed
      ? null
      : buildProspectiveSecondarySceneSafetySnapshot({
          chatId,
          currentTurn: input.priorLegacyTurn ? 2 : 1,
          currentUserMessage: input.message,
          sceneReset: false,
          db,
        });
    const guardResult = evaluateSecondarySceneParticipantGuard({
      sceneClassification,
      baseAdultEligibility: ELIGIBLE,
      prospectiveSecondarySafety: prospective,
      adultRoutingEnabled: true,
      safetyEvaluationFailed: input.safetyEvaluationFailed,
    });
    const effectiveRoutingEnabled =
      input.guardEnabled !== false &&
      guardResult.action === "DISABLE_ADULT_HANDOFF_ONLY"
        ? false
        : true;
    const route = decideAdultModelRoute({
      config: {
        enabled: effectiveRoutingEnabled,
        adultModelId: DEEPSEEK,
        providerOrder: [],
        providerOnly: [],
        allowProviderFallbacks: false,
        requireParameters: true,
        quantizations: [],
        baseRawExchanges: 4,
        handoffTargetRawExchanges: 6,
        handoffExtraRawTokens: 4000,
        handoffRawTurns: 6,
        handoffMaxTokens: 4000,
        minimumRouteTurns: 3,
        returnSafeTurns: 2,
        silentRefusalFallback: true,
        initialStreamBufferChars: 400,
        providerCapabilities: PROVIDER_CAPABILITIES,
      },
      state: DEFAULT_STATE,
      classification: sceneClassification,
      eligibility: ELIGIBLE,
      adultDialogueProfile: "auto",
      selectedModelId: GEMINI,
    });
    const plan = resolveAdultDeliveryPlan({
      routingEnabled: effectiveRoutingEnabled,
      eligibility: ELIGIBLE,
      silentRefusalFallback: true,
      selectedModelId: GEMINI,
      adultTargetModelId: DEEPSEEK,
      classification: sceneClassification,
      state: DEFAULT_STATE,
      adultDialogueProfile: "auto",
      providerCapabilities: PROVIDER_CAPABILITIES,
    });
    const providerCalls: string[] = [];
    if (guardResult.action !== "HARD_BLOCK_TURN") {
      providerCalls.push(plan.primaryModelId);
    }
    return {
      guardResult,
      route,
      plan,
      providerCalls,
      userRowsCreated: guardResult.action === "HARD_BLOCK_TURN" ? 0 : 1,
      assistantPlaceholders:
        guardResult.action === "HARD_BLOCK_TURN" ? 0 : 1,
    };
  }

  it("R1 adult clean -> ALLOW -> Gemini only", () => {
    const result = runGuardedDelivery({
      message: "둘이 서로를 바라본다.",
    });
    assert.equal(result.guardResult.action, "ALLOW");
    assert.deepEqual(result.providerCalls, [GEMINI]);
    assert.equal(result.plan.fallbackPrepared, true);
  });

  it("R2 minor explicit -> HARD_BLOCK -> zero side effects", () => {
    const result = runGuardedDelivery({
      message: "17살 동생이 들어왔다.",
    });
    assert.equal(result.guardResult.action, "HARD_BLOCK_TURN");
    assert.deepEqual(result.providerCalls, []);
    assert.equal(result.userRowsCreated, 0);
    assert.equal(result.assistantPlaceholders, 0);
  });

  it("R3 minor normal -> DISABLE -> Gemini primary, no DeepSeek handoff", () => {
    const result = runGuardedDelivery({
      message: "17살 동생이 들어왔다.",
      sceneMode: "normal",
    });
    assert.equal(result.guardResult.action, "DISABLE_ADULT_HANDOFF_ONLY");
    assert.deepEqual(result.providerCalls, [GEMINI]);
    assert.equal(result.plan.fallbackPrepared, false);
  });

  it("R4 coverage incomplete explicit -> no provider calls", () => {
    const result = runGuardedDelivery({
      message: "둘이 침대에 누웠다.",
      priorLegacyTurn: true,
    });
    assert.equal(result.guardResult.action, "HARD_BLOCK_TURN");
    assert.deepEqual(result.providerCalls, []);
  });

  it("R5 safety error explicit -> no provider calls", () => {
    const result = runGuardedDelivery({
      message: "둘이 격렬하게 얽혔다.",
      safetyEvaluationFailed: true,
    });
    assert.equal(result.guardResult.action, "HARD_BLOCK_TURN");
    assert.deepEqual(result.providerCalls, []);
  });

  it("route hard-block point is before atomic bootstrap execution", () => {
    const routeSource = readFileSync(
      new URL("../app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    const guardBlock = routeSource.indexOf(
      'secondarySceneParticipantGuardResult?.action === "HARD_BLOCK_TURN"'
    );
    const bootstrap = routeSource.indexOf(
      "bootstrapAndCommitSecondarySafetyAtomic(db"
    );
    assert.ok(guardBlock > 0);
    assert.ok(bootstrap > guardBlock);
  });
});
