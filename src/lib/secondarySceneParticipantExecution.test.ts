import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  resolveAdultEligibility,
  type AdultRoutingConfig,
  type ModelRouteState,
  type SceneClassification,
  type SceneMode,
} from "@/lib/adultSceneRouting";
import { incrementCharacterTotalTurns } from "@/lib/characterEngagementStats";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { ensureObserverSchema } from "@/lib/observerSchema";
import {
  buildProspectiveSecondarySceneSafetySnapshot,
  computeSecondarySceneSafetySnapshot,
  evaluateCurrentTurnSecondarySceneSafetyShadow,
  markSecondarySafetyReconciliationFailure,
  persistAssistantTurnSecondarySceneSafety,
  reconcileSecondarySafetyAfterCanonicalMutation,
} from "@/lib/secondarySceneParticipantSafety";
import {
  bootstrapAndCommitSecondarySafetyAtomic,
  resolveSecondarySceneParticipantExecutionPlan,
} from "@/lib/secondarySceneParticipantExecution";
import { ensureSecondarySceneParticipantSafetySchema } from "@/lib/secondarySceneParticipantSafetySchema";
import { getSecondarySafetyCoverage } from "@/lib/secondarySceneParticipantSafetyStore";
import {
  bootstrapStreamingTurn,
  finalizeAssistantMessage,
} from "@/lib/streamingPersistence";

const GEMINI = CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL;
const DEEPSEEK = CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL;

const ELIGIBLE = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  characterAdultContentEnabled: true,
  participants: [
    { adultStatus: "confirmed", age: 25, description: "main character" },
    { description: "persona", isVerifiedAdultUserPersona: true },
  ],
  actualNonConsent: false,
});

const STATE: ModelRouteState = {
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

const ROUTING_CONFIG: AdultRoutingConfig = {
  enabled: true,
  adultModelId: DEEPSEEK,
  providerOrder: [],
  providerOnly: [],
  allowProviderFallbacks: false,
  requireParameters: true,
  quantizations: [],
  baseRawExchanges: 4,
  handoffTargetRawExchanges: 6,
  handoffExtraRawTokens: 4_000,
  handoffRawTurns: 6,
  handoffMaxTokens: 4_000,
  minimumRouteTurns: 3,
  returnSafeTurns: 2,
  silentRefusalFallback: true,
  initialStreamBufferChars: 400,
  providerCapabilities: PROVIDER_CAPABILITIES,
};

function scene(
  sceneMode: SceneMode,
  overrides: Partial<SceneClassification> = {}
): SceneClassification {
  const adult = !["normal", "romantic"].includes(sceneMode);
  return {
    sceneMode,
    sexualContextActive: adult,
    currentInputExplicitIntent: adult,
    requiresAdultCapableModel: adult,
    transientAdultCapableRoute: false,
    actualNonConsent: false,
    oocIntent: "none",
    sceneReset: false,
    hardStop: false,
    oocStop: false,
    clearSceneTransition: false,
    reason: adult ? "explicit_action" : "none",
    ...overrides,
  };
}

function testDb(): Database.Database {
  const db = new Database(":memory:");
  ensureObserverSchema(db);
  ensureSecondarySceneParticipantSafetySchema(db);
  db.exec(`
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      total_turns INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO characters (id, total_turns) VALUES (1, 0);
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      generation_status TEXT NOT NULL DEFAULT 'completed',
      user_message_id INTEGER,
      alternates TEXT NOT NULL DEFAULT '[]',
      active_variant INTEGER NOT NULL DEFAULT 0,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      deduction_slices TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      usage TEXT,
      status_meta TEXT,
      status_widget_values_json TEXT NOT NULL DEFAULT '',
      status_widget_turn_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function counts(db: Database.Database, chatId: number) {
  const messages = db
    .prepare(
      `SELECT
         SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS users,
         SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) AS assistants
       FROM messages WHERE chat_id=?`
    )
    .get(chatId) as { users: number | null; assistants: number | null };
  const events = db
    .prepare(
      "SELECT COUNT(*) AS n FROM scene_secondary_participant_safety_events WHERE chat_id=?"
    )
    .get(chatId) as { n: number };
  const projections = db
    .prepare(
      "SELECT COUNT(*) AS n FROM scene_secondary_participant_safety WHERE chat_id=?"
    )
    .get(chatId) as { n: number };
  const character = db
    .prepare("SELECT total_turns FROM characters WHERE id=1")
    .get() as { total_turns: number };
  return {
    users: messages.users ?? 0,
    assistants: messages.assistants ?? 0,
    events: events.n,
    projections: projections.n,
    engagement: character.total_turns,
  };
}

function atomicInput(
  chatId: number,
  requestId: string,
  failurePoint?: "AFTER_EVENT_INSERT" | "AFTER_PROJECTION_WRITE"
) {
  return {
    bootstrap: {
      chatId,
      requestId,
      userContent: "17살 동생이 들어왔다.",
      skipUserInsert: false,
      onUserInserted: () => undefined,
    },
    safety: {
      chatId,
      userMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      currentTurn: 1,
      __testFailurePoint: failurePoint,
    },
  };
}

describe("S2.1 atomic bootstrap + current-user safety commit", () => {
  it("rolls back user, placeholder, engagement, event and projection on event failure", () => {
    const db = testDb();
    const input = atomicInput(1, "cr_atomic_event", "AFTER_EVENT_INSERT");
    input.bootstrap.onUserInserted = () =>
      incrementCharacterTotalTurns(db, 1);
    assert.throws(
      () => bootstrapAndCommitSecondarySafetyAtomic(db, input),
      /AFTER_EVENT_INSERT/
    );
    assert.deepEqual(counts(db, 1), {
      users: 0,
      assistants: 0,
      events: 0,
      projections: 0,
      engagement: 0,
    });
    assert.equal(db.inTransaction, false);
  });

  it("rolls back every durable mutation on projection failure", () => {
    const db = testDb();
    const input = atomicInput(
      2,
      "cr_atomic_projection",
      "AFTER_PROJECTION_WRITE"
    );
    input.bootstrap.onUserInserted = () =>
      incrementCharacterTotalTurns(db, 1);
    assert.throws(
      () => bootstrapAndCommitSecondarySafetyAtomic(db, input),
      /AFTER_PROJECTION_WRITE/
    );
    assert.deepEqual(counts(db, 2), {
      users: 0,
      assistants: 0,
      events: 0,
      projections: 0,
      engagement: 0,
    });
  });

  it("regen safety failure preserves old content, status, alternates and request ownership", () => {
    const db = testDb();
    const original = bootstrapStreamingTurn(db, {
      chatId: 3,
      requestId: "cr_regen_original",
      userContent: "original user",
      skipUserInsert: false,
    });
    const alternates = JSON.stringify([
      {
        content: "old canonical reply",
        model: GEMINI,
        usage: null,
        created_at: "",
      },
    ]);
    finalizeAssistantMessage(db, {
      assistantMessageId: original.assistantMessageId,
      chatId: 3,
      content: "old canonical reply",
      model: GEMINI,
      usageJson: "{}",
      alternatesJson: alternates,
      activeVariant: 0,
    });
    const before = db
      .prepare(
        `SELECT content, generation_status, alternates, request_id
         FROM messages WHERE id=?`
      )
      .get(original.assistantMessageId);
    const userRequestBefore = db
      .prepare("SELECT request_id FROM messages WHERE id=?")
      .get(original.userMessageId!);

    assert.throws(
      () =>
        bootstrapAndCommitSecondarySafetyAtomic(db, {
          bootstrap: {
            chatId: 3,
            requestId: "cr_regen_failed",
            userContent: "original user",
            skipUserInsert: true,
            existingUserMessageId: original.userMessageId,
            regenerateAssistantId: original.assistantMessageId,
          },
          safety: {
            chatId: 3,
            userMessage: "17살 동생이 들어왔다.",
            sceneReset: false,
            currentTurn: 1,
            skipSceneBoundary: true,
            __testFailurePoint: "AFTER_EVENT_INSERT",
          },
        }),
      /AFTER_EVENT_INSERT/
    );
    const after = db
      .prepare(
        `SELECT content, generation_status, alternates, request_id
         FROM messages WHERE id=?`
      )
      .get(original.assistantMessageId) as Record<string, unknown>;
    for (const key of [
      "content",
      "generation_status",
      "alternates",
      "request_id",
    ]) {
      assert.equal(after[key], (before as Record<string, unknown>)[key]);
    }
    const userRequestAfter = db
      .prepare("SELECT request_id FROM messages WHERE id=?")
      .get(original.userMessageId!) as { request_id: string | null };
    assert.equal(
      userRequestAfter.request_id,
      (userRequestBefore as { request_id: string | null }).request_id
    );
  });

  it("completed request replay creates no message or safety duplicate", () => {
    const db = testDb();
    const input = atomicInput(4, "cr_atomic_replay");
    const first = bootstrapAndCommitSecondarySafetyAtomic(db, input);
    finalizeAssistantMessage(db, {
      assistantMessageId: first.assistantMessageId,
      chatId: 4,
      content: "completed",
      model: GEMINI,
      usageJson: "{}",
      alternatesJson: "[]",
      activeVariant: 0,
    });
    const before = counts(db, 4);
    const replay = bootstrapAndCommitSecondarySafetyAtomic(db, input);
    assert.equal(replay.reusedExisting, true);
    assert.equal(replay.assistantMessageId, first.assistantMessageId);
    assert.deepEqual(counts(db, 4), before);
  });

  it("rejects nested transaction ownership", () => {
    const db = testDb();
    assert.throws(
      () =>
        db.transaction(() =>
          bootstrapAndCommitSecondarySafetyAtomic(
            db,
            atomicInput(5, "cr_nested")
          )
        ).immediate(),
      /REQUIRES_OUTER_OWNER/
    );
  });
});

describe("S2.1 production execution plan seam", () => {
  function plan(input: {
    snapshot: ReturnType<typeof computeSecondarySceneSafetySnapshot> | null;
    classification: SceneClassification;
    guardEnabled?: boolean;
    safetyFailed?: boolean;
  }) {
    return resolveSecondarySceneParticipantExecutionPlan({
      guardEnabled: input.guardEnabled ?? true,
      sceneClassification: input.classification,
      baseAdultEligibility: ELIGIBLE,
      prospectiveSecondarySafety: input.snapshot,
      safetyEvaluationFailed: input.safetyFailed ?? false,
      adultRoutingConfig: ROUTING_CONFIG,
      adultDialogueProfile: "auto",
      priorModelRouteState: STATE,
      selectedModelId: GEMINI,
      adultTargetModelId: DEEPSEEK,
    });
  }

  it("R1 clean explicit allows Gemini primary without pre-provider block", () => {
    const result = plan({
      snapshot: computeSecondarySceneSafetySnapshot([], {
        coverage: "COMPLETE",
      }),
      classification: scene("explicit"),
    });
    assert.equal(result.guardResult?.action, "ALLOW");
    assert.equal(result.adultRouteDecision.shouldBlock, false);
    assert.equal(result.adultDeliveryPlan.primaryModelId, GEMINI);
  });

  it("R2 minor explicit hard-blocks before bootstrap/provider/billing", () => {
    const db = testDb();
    const snapshot = buildProspectiveSecondarySceneSafetySnapshot({
      chatId: 10,
      currentTurn: 1,
      currentUserMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      db,
    });
    const result = plan({
      snapshot,
      classification: scene("explicit"),
    });
    let bootstrapExecutions = 0;
    let providerExecutions = 0;
    let deductions = 0;
    if (result.guardResult?.action !== "HARD_BLOCK_TURN") {
      bootstrapExecutions += 1;
      providerExecutions += 1;
      deductions += 1;
    }
    assert.equal(result.guardResult?.action, "HARD_BLOCK_TURN");
    assert.deepEqual(
      { bootstrapExecutions, providerExecutions, deductions },
      { bootstrapExecutions: 0, providerExecutions: 0, deductions: 0 }
    );
    assert.deepEqual(counts(db, 10), {
      users: 0,
      assistants: 0,
      events: 0,
      projections: 0,
      engagement: 0,
    });
  });

  it("R3 minor normal disables routing for this request and keeps Gemini primary", () => {
    const db = testDb();
    const snapshot = buildProspectiveSecondarySceneSafetySnapshot({
      chatId: 11,
      currentTurn: 1,
      currentUserMessage: "17살 동생이 들어왔다.",
      sceneReset: false,
      db,
    });
    const result = plan({
      snapshot,
      classification: scene("normal"),
    });
    assert.equal(
      result.guardResult?.action,
      "DISABLE_ADULT_HANDOFF_ONLY"
    );
    assert.equal(result.effectiveAdultRoutingEnabled, false);
    assert.equal(result.adultDeliveryPlan.primaryModelId, GEMINI);
    assert.equal(result.adultDeliveryPlan.fallbackPrepared, false);
    assert.equal(ROUTING_CONFIG.enabled, true);
  });

  it("R4 unavailable explicit safety hard-blocks without bootstrap", () => {
    const result = plan({
      snapshot: null,
      classification: scene("explicit"),
      safetyFailed: true,
    });
    assert.equal(result.guardResult?.action, "HARD_BLOCK_TURN");
  });

  it("R5 allowed safety-commit failure rolls back bootstrap", () => {
    const db = testDb();
    const clean = plan({
      snapshot: computeSecondarySceneSafetySnapshot([], {
        coverage: "COMPLETE",
      }),
      classification: scene("explicit"),
    });
    assert.equal(clean.guardResult?.action, "ALLOW");
    assert.throws(
      () =>
        bootstrapAndCommitSecondarySafetyAtomic(
          db,
          atomicInput(12, "cr_r5_failure", "AFTER_EVENT_INSERT")
        ),
      /AFTER_EVENT_INSERT/
    );
    assert.equal(counts(db, 12).assistants, 0);
  });

  it("flag OFF preserves pre-S2 adult routing and delivery behavior", () => {
    const minorSnapshot = computeSecondarySceneSafetySnapshot([], {
      coverage: "INCOMPLETE",
    });
    const result = plan({
      snapshot: minorSnapshot,
      classification: scene("explicit"),
      guardEnabled: false,
    });
    assert.equal(result.guardResult, null);
    assert.equal(result.effectiveAdultRoutingEnabled, true);
    assert.equal(result.adultDeliveryPlan.primaryModelId, GEMINI);
    assert.equal(result.adultDeliveryPlan.fallbackPrepared, true);
  });
});

describe("S2.1 post-canonical reconciliation continuity", () => {
  it("assistant post-turn failure keeps canonical output, degrades coverage, and blocks next explicit turn", () => {
    const db = testDb();
    const chatId = 20;
    evaluateCurrentTurnSecondarySceneSafetyShadow({
      chatId,
      userMessage: "문을 열었다.",
      sceneReset: false,
      currentTurn: 1,
      sourceMessageId: 1,
      db,
    });
    db.prepare(
      `INSERT INTO messages (
         chat_id, role, content, model, request_id, generation_status
       ) VALUES (?, 'assistant', ?, ?, ?, 'completed')`
    ).run(
      chatId,
      "17살 동생이 들어왔다.",
      GEMINI,
      "cr_assistant_canonical"
    );
    const assistantId = Number(
      (
        db
          .prepare("SELECT MAX(id) AS id FROM messages WHERE chat_id=?")
          .get(chatId) as { id: number }
      ).id
    );
    const reconciled = reconcileSecondarySafetyAfterCanonicalMutation({
      chatId,
      reason: "assistant_postturn_safety_failed",
      db,
      reconcile: () =>
        persistAssistantTurnSecondarySceneSafety({
          chatId,
          assistantText: "17살 동생이 들어왔다.",
          currentTurn: 1,
          sourceMessageId: assistantId,
          db,
          __testFailurePoint: "AFTER_EVENT_INSERT",
        }),
    });
    assert.equal(reconciled, false);
    assert.equal(
      (
        db
          .prepare("SELECT content FROM messages WHERE id=?")
          .get(assistantId) as { content: string }
      ).content,
      "17살 동생이 들어왔다."
    );
    assert.equal(getSecondarySafetyCoverage(chatId, db), "INCOMPLETE");

    const next = buildProspectiveSecondarySceneSafetySnapshot({
      chatId,
      currentTurn: 2,
      currentUserMessage: "둘이 성인 장면을 이어간다.",
      sceneReset: false,
      db,
    });
    const result = resolveSecondarySceneParticipantExecutionPlan({
      guardEnabled: true,
      sceneClassification: scene("explicit"),
      baseAdultEligibility: ELIGIBLE,
      prospectiveSecondarySafety: next,
      safetyEvaluationFailed: false,
      adultRoutingConfig: ROUTING_CONFIG,
      adultDialogueProfile: "auto",
      priorModelRouteState: STATE,
      selectedModelId: GEMINI,
      adultTargetModelId: DEEPSEEK,
    });
    assert.equal(result.guardResult?.action, "HARD_BLOCK_TURN");
  });

  for (const reason of [
    "user_edit_safety_failed",
    "assistant_edit_safety_failed",
    "variant_switch_safety_failed",
    "assistant_replacement_safety_failed",
  ] as const) {
    it(`${reason} marks coverage INCOMPLETE`, () => {
      const db = testDb();
      evaluateCurrentTurnSecondarySceneSafetyShadow({
        chatId: 30,
        userMessage: "tracked",
        sceneReset: false,
        currentTurn: 1,
        db,
      });
      const result = reconcileSecondarySafetyAfterCanonicalMutation({
        chatId: 30,
        reason,
        db,
        reconcile: () => {
          throw new Error("injected reconciliation failure");
        },
      });
      assert.equal(result, false);
      assert.equal(getSecondarySafetyCoverage(30, db), "INCOMPLETE");
    });
  }

  it("coverage-mark failure emits critical diagnostic and propagates", () => {
    const errors: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      assert.throws(
        () =>
          markSecondarySafetyReconciliationFailure({
            chatId: 40,
            reason: "assistant_postturn_safety_failed",
            __testMarkIncomplete: () => {
              throw new Error("injected coverage mark failure");
            },
          }),
        /injected coverage mark failure/
      );
      assert.equal(
        errors.some((args) =>
          String(args[0]).includes("coverage degradation failed")
        ),
        true
      );
    } finally {
      console.error = originalError;
    }
  });
});
