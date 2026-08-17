import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { classifyChatOocIntent } from "@/lib/chatOocPriority";
import { sanitizeUsageForPublicReceipt, stripAdultRoutingForClient } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import { persistEpisodicMemoryFactsBestEffort, ensureEpisodicMemoryFactsTable } from "@/lib/episodicMemoryFacts";
import { isHtmlFlashOnlyTurn, isOocCreativeHtmlTurn, chatInputSuppressesStatusWidget } from "@/lib/htmlDisplayOnlyTurn";
import { isTurnEligibleForMemoryRecord } from "@/lib/memory/memory-ooc-filter";
import { countMemoryEligibleCompletedTurnsCore } from "@/lib/memory/memory-turn-loader";
import {
  bootstrapStreamingTurn,
  finalizeAssistantMessage,
} from "@/lib/streamingPersistence";
import {
  evaluateStatusWidgetTriggers,
  insertStatusWidgetTriggerForTest,
  loadQueuedStatusTriggerEventsForPrompt,
  markStatusTriggerEventsConsumed,
} from "@/lib/statusWidgetTriggers";
import {
  CANONICAL_GENERATION_SEMANTICS,
  OOC_SCENE_RENDER_SEMANTICS,
  filterCanonicalMessageRows,
  isCanonicalGeneration,
  mergeGenerationSemantics,
  mergeIncomingUsageWithStoredSemantics,
  nextPersistedModelRouteState,
  persistGenerationSemanticsOnMessages,
  readGenerationSemantics,
  resolveGenerationSemantics,
  resolveOocSceneRenderIntent,
  shouldCommitCanonicalTurnState,
} from "@/lib/oocSceneRender";

const classifyOoc = classifyChatOocIntent;

const TRUE_ISOLATED_RENDERS = [
  "OOC: 본편과 별개로 이 상황을 샘플 장면으로 한 번 보여줘.",
  "OOC: RP에는 반영하지 말고, 만약 둘이 호텔에서 만났다면 어떻게 됐을지 한 장면 써줘.",
  "OOC: 실제 진행은 아니야. 가정 상황으로 라이크의 반응을 장면으로 보여줘.",
] as const;

const FALSE_CONTROL_OR_WEAK = [
  "OOC: 지금 장면에서 라이크 반응을 자세히 보여줘.",
  "OOC: 이대로 계속 진행해.",
  "OOC: 기존 RP 종료. 새 에피소드 시작. 둘이 호텔에 있는 장면부터 시작해.",
  "OOC: 좀 더 능글맞게 진행해.",
  "OOC: 반응 보여줘.",
  "OOC: 장면 출력해줘.",
  '"본편과 별개로 생각하면 웃기겠네."',
] as const;

const OOC_USAGE = JSON.stringify(OOC_SCENE_RENDER_SEMANTICS);

function createMessagesDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
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
    CREATE TABLE chat_memories (
      chat_id INTEGER PRIMARY KEY,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO chat_memories (chat_id, memory_reset_after_message_id, memory_epoch)
    VALUES (1, NULL, 0);
  `);
  return db;
}

function insertPair(
  db: Database.Database,
  userContent: string,
  assistantContent: string,
  usage?: string | null
): { userId: number; assistantId: number } {
  const user = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, usage) VALUES (1,'user',?,'',?)`
    )
    .run(userContent, usage ?? null);
  const userId = Number(user.lastInsertRowid);
  const assistant = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, model, user_message_id, usage)
       VALUES (1,'assistant',?,'model',?,?)`
    )
    .run(assistantContent, userId, usage ?? null);
  return { userId, assistantId: Number(assistant.lastInsertRowid) };
}

describe("resolveOocSceneRenderIntent", () => {
  it("TRUE: strong isolation + render in OOC scope", () => {
    for (const text of TRUE_ISOLATED_RENDERS) {
      assert.equal(resolveOocSceneRenderIntent(text), true, text);
      assert.equal(classifyOoc(text) !== "rp_scene_reset", true, text);
      assert.equal(classifyOoc(text) !== "rp_hard_stop", true, text);
    }
  });

  it("FALSE: current-RP / reset / weak / in-character lines", () => {
    for (const text of FALSE_CONTROL_OR_WEAK) {
      assert.equal(resolveOocSceneRenderIntent(text), false, text);
    }
    assert.equal(
      classifyOoc("OOC: 기존 RP 종료. 새 에피소드 시작. 둘이 호텔에 있는 장면부터 시작해."),
      "rp_scene_reset"
    );
  });

  it("does not treat OOC marker or HTML path as render-only", () => {
    assert.equal(resolveOocSceneRenderIntent("OOC: 지금 장면 계속해."), false);
    assert.equal(isHtmlFlashOnlyTurn(TRUE_ISOLATED_RENDERS[0]), false);
    assert.equal(isOocCreativeHtmlTurn(TRUE_ISOLATED_RENDERS[0]), false);
    assert.equal(chatInputSuppressesStatusWidget(TRUE_ISOLATED_RENDERS[0]), true);
    assert.equal(chatInputSuppressesStatusWidget("계속 이어서 RP"), false);
  });

  it("fail-closed on isolation-only or render-only", () => {
    assert.equal(resolveOocSceneRenderIntent("OOC: 가정하면 어떻게 될까?"), false);
    assert.equal(resolveOocSceneRenderIntent("OOC: 반응을 보여줘."), false);
    assert.equal(resolveOocSceneRenderIntent("OOC: 장면으로 출력해줘."), false);
  });
});

describe("generation semantics + regen inherit", () => {
  it("classifies new isolated render as ooc_scene_render", () => {
    const semantics = resolveGenerationSemantics({
      userMessage: TRUE_ISOLATED_RENDERS[0],
    });
    assert.deepEqual(semantics, OOC_SCENE_RENDER_SEMANTICS);
    assert.equal(shouldCommitCanonicalTurnState(semantics), false);
  });

  it("inherits original semantics on regenerate even if text looks continuing", () => {
    const inherited = resolveGenerationSemantics({
      userMessage: "OOC: 지금 장면에서 라이크 반응을 자세히 보여줘.",
      inherited: readGenerationSemantics(OOC_USAGE),
    });
    assert.deepEqual(inherited, OOC_SCENE_RENDER_SEMANTICS);
  });

  it("allows new classification when the user sends a new message", () => {
    const next = resolveGenerationSemantics({
      userMessage: "OOC: 이대로 계속 진행해.",
    });
    assert.deepEqual(next, CANONICAL_GENERATION_SEMANTICS);
  });
});

describe("canonical history pair filter", () => {
  it("drops the noncanonical user+assistant pair and keeps surrounding canon", () => {
    const rows = [
      { id: 1, role: "user", content: "U1", user_message_id: null, usage: null },
      { id: 2, role: "assistant", content: "A1", user_message_id: 1, usage: null },
      { id: 3, role: "user", content: "U2", user_message_id: null, usage: null },
      { id: 4, role: "assistant", content: "A2", user_message_id: 3, usage: null },
      {
        id: 5,
        role: "user",
        content: TRUE_ISOLATED_RENDERS[0],
        user_message_id: null,
        usage: OOC_USAGE,
      },
      {
        id: 6,
        role: "assistant",
        content: "noncanonical sample",
        user_message_id: 5,
        usage: OOC_USAGE,
      },
      { id: 7, role: "user", content: "*본편에서 문을 열고 들어간다.*", user_message_id: null, usage: null },
    ];
    const canonical = filterCanonicalMessageRows(rows);
    assert.deepEqual(
      canonical.map((row) => row.id),
      [1, 2, 3, 4, 7]
    );
  });

  it("drops orphan parent OOC user after assistant delete/failure", () => {
    const rows = [
      { id: 1, role: "user", content: "U1", user_message_id: null, usage: null },
      { id: 2, role: "assistant", content: "A1", user_message_id: 1, usage: null },
      {
        id: 3,
        role: "user",
        content: TRUE_ISOLATED_RENDERS[1],
        user_message_id: null,
        usage: OOC_USAGE,
      },
    ];
    assert.deepEqual(
      filterCanonicalMessageRows(rows).map((row) => row.id),
      [1, 2]
    );
  });

  it("uses user_message_id linkage rather than searching parent text", () => {
    const rows = [
      {
        id: 10,
        role: "user",
        content: "canonical user",
        user_message_id: null,
        usage: null,
      },
      {
        id: 11,
        role: "assistant",
        content: "sample",
        user_message_id: 10,
        usage: OOC_USAGE,
      },
    ];
    assert.deepEqual(
      filterCanonicalMessageRows(rows).map((row) => row.id),
      []
    );
  });
});

describe("memory coverage excludes ooc_scene_render pairs", () => {
  it("counts 5 canon + 1 ooc + 1 canon as 6 playable turns", () => {
    const db = createMessagesDb();
    for (let i = 1; i <= 5; i += 1) {
      insertPair(db, `canon user ${i}`, `canon assistant ${i}`);
    }
    insertPair(db, TRUE_ISOLATED_RENDERS[0], "sample scene", OOC_USAGE);
    insertPair(db, "canon user 6", "canon assistant 6");
    assert.equal(countMemoryEligibleCompletedTurnsCore(db, 1), 6);
    assert.equal(isTurnEligibleForMemoryRecord(TRUE_ISOLATED_RENDERS[0]), false);
    assert.equal(isTurnEligibleForMemoryRecord("카페에 앉아 커피를 마신다."), true);
  });
});

describe("model route state is not committed for noncanonical turns", () => {
  it("keeps persistent ModelRouteState equal to the before fixture", () => {
    const before = {
      activeRoute: "general" as const,
      currentSceneMode: "normal" as const,
      adultRouteMinimumTurnsRemaining: 0,
      safeSceneStreak: 2,
      sexualContextActive: false,
      activeConsentMode: "standard" as const,
      adultHandoffSourceModelId: "claude-opus-5",
      adultHandoffTargetModelId: undefined,
    };
    const advanced = {
      ...before,
      activeRoute: "adult" as const,
      currentSceneMode: "explicit" as const,
      adultRouteMinimumTurnsRemaining: 3,
      sexualContextActive: true,
      adultHandoffTargetModelId: "qwen-3-8-max",
    };
    assert.deepEqual(
      nextPersistedModelRouteState(before, advanced, OOC_SCENE_RENDER_SEMANTICS),
      before
    );
    assert.deepEqual(
      nextPersistedModelRouteState(before, advanced, CANONICAL_GENERATION_SEMANTICS),
      advanced
    );
  });
});

describe("status trigger consume gate", () => {
  it("leaves a queued trigger unconsumed on ooc scene render", () => {
    const db = new Database(":memory:");
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "ooc_leave_queued",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "deadline_arrived",
      effect_text: "카운트가 끝났다.",
    });
    const fired = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 3,
      statusValues: { character: { d_day: "0" } },
    });
    assert.equal(fired.firedEvents.length, 1);
    if (shouldCommitCanonicalTurnState(OOC_SCENE_RENDER_SEMANTICS)) {
      markStatusTriggerEventsConsumed(
        db,
        fired.firedEvents.map((event) => event.id)
      );
    }
    assert.equal(loadQueuedStatusTriggerEventsForPrompt(db, 1).length, 1);
  });
});

describe("episodic / relationship mutation skip", () => {
  it("does not persist canonical episodic facts from an OOC sample", () => {
    const db = createMessagesDb();
    ensureEpisodicMemoryFactsTable(db);
    const { userId } = insertPair(db, TRUE_ISOLATED_RENDERS[2], "둘은 연인이 되었다. 결혼을 약속했다.");
    const inserted = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      sourceUserMessageId: userId,
      sourceUserText: TRUE_ISOLATED_RENDERS[2],
      facts: [
        {
          category: "relationship",
          subject: "user",
          attribute: "relationship_status",
          value: "lovers",
          importance: "critical",
          fact_text: "둘은 연인이 되었다.",
        },
      ],
    });
    assert.equal(inserted, 0);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts").get() as { n: number }).n,
      0
    );
  });
});

describe("streaming metadata survives finalize overwrite", () => {
  it("keeps generationKind/canonical from bootstrap through finalize", () => {
    const db = createMessagesDb();
    const boot = bootstrapStreamingTurn(db, {
      chatId: 1,
      requestId: "cr_ooc_render_1",
      userContent: TRUE_ISOLATED_RENDERS[0],
      skipUserInsert: false,
    });
    persistGenerationSemanticsOnMessages(db, {
      userMessageId: boot.userMessageId,
      assistantMessageId: boot.assistantMessageId,
      semantics: OOC_SCENE_RENDER_SEMANTICS,
    });
    const early = db
      .prepare("SELECT usage FROM messages WHERE id=?")
      .get(boot.assistantMessageId) as { usage: string };
    assert.deepEqual(readGenerationSemantics(early.usage), OOC_SCENE_RENDER_SEMANTICS);

    const billingOnly: Usage = {
      input: 10,
      output: 20,
      model: "claude-opus-5",
      route: "safe",
      cost: 3,
      breakdown: [],
    };
    finalizeAssistantMessage(db, {
      assistantMessageId: boot.assistantMessageId,
      chatId: 1,
      content: "sample scene",
      model: "claude-opus-5",
      usageJson: JSON.stringify(billingOnly),
      alternatesJson: "[]",
      activeVariant: 0,
    });
    const final = db
      .prepare("SELECT usage FROM messages WHERE id=?")
      .get(boot.assistantMessageId) as { usage: string };
    const parsed = JSON.parse(final.usage) as Usage;
    assert.equal(parsed.generationKind, "ooc_scene_render");
    assert.equal(parsed.canonical, false);
    assert.equal(parsed.cost, 3);
    assert.equal(isCanonicalGeneration(parsed), false);
  });

  it("mergeIncomingUsageWithStoredSemantics does not drop billing fields", () => {
    const merged = mergeIncomingUsageWithStoredSemantics(
      OOC_USAGE,
      JSON.stringify({
        input: 1,
        output: 2,
        model: "x",
        route: "safe",
        cost: 9,
        breakdown: [],
      })
    );
    const parsed = JSON.parse(merged) as Usage;
    assert.equal(parsed.generationKind, "ooc_scene_render");
    assert.equal(parsed.canonical, false);
    assert.equal(parsed.cost, 9);
  });
});

describe("public sanitize hides generation semantics", () => {
  it("strips generationKind/canonical from public receipts", () => {
    const usage = mergeGenerationSemantics(
      {
        input: 1,
        output: 2,
        model: "claude-opus-5",
        route: "safe" as const,
        cost: 4,
        breakdown: [],
      },
      OOC_SCENE_RENDER_SEMANTICS
    );
    const sanitized = sanitizeUsageForPublicReceipt(usage);
    assert.equal(sanitized.generationKind, undefined);
    assert.equal(sanitized.canonical, undefined);
    const publicClient = stripAdultRoutingForClient(usage);
    assert.equal(publicClient.generationKind, undefined);
    assert.equal(publicClient.canonical, undefined);
    const admin = stripAdultRoutingForClient(usage, { keepInternal: true });
    assert.equal(admin.generationKind, "ooc_scene_render");
    assert.equal(admin.canonical, false);
  });
});

describe("existing OOC control semantics stay unchanged", () => {
  it("keeps rp_continuing / reset / hard_stop / unrelated owners", () => {
    assert.equal(
      classifyOoc("OOC: 현재 장면에서 계속 진행. 호감도 조금 올려줘"),
      "rp_continuing"
    );
    assert.equal(
      classifyOoc("OOC: 기존 RP 종료. 새로운 에피소드 시작. 카페에서 다시 만난다."),
      "rp_scene_reset"
    );
    assert.equal(
      classifyOoc("OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마."),
      "rp_hard_stop"
    );
    assert.equal(
      classifyOoc("OOC: RP 중지. HTML로 내가 입력한 내용만 띄워줘"),
      "rp_unrelated"
    );
    assert.equal(resolveOocSceneRenderIntent("OOC: 현재 상황에서 성인 장면으로 이어가."), false);
  });
});
