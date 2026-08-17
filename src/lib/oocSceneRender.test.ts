import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";

import { classifyChatOocIntent } from "@/lib/chatOocPriority";
import { classifySceneMode } from "@/lib/adultSceneRouting";
import { sanitizeUsageForPublicReceipt, stripAdultRoutingForClient } from "@/lib/billingReceiptAccess";
import type { Usage } from "@/lib/chatUsage";
import { persistEpisodicMemoryFactsBestEffort, ensureEpisodicMemoryFactsTable } from "@/lib/episodicMemoryFacts";
import { isHtmlFlashOnlyTurn, isOocCreativeHtmlTurn, chatInputSuppressesStatusWidget } from "@/lib/htmlDisplayOnlyTurn";
import { messagesToTurns, rawRecentTurnsToHistory } from "@/lib/hybridMemory";
import { isTurnEligibleForMemoryRecord } from "@/lib/memory/memory-ooc-filter";
import {
  countMemoryEligibleCompletedTurnsCore,
  loadMemoryEligibleChatTurnsWithMessageIdsCore,
} from "@/lib/memory/memory-turn-loader";
import { countMemoryEligibleCompletedTurnsUpToMessageId } from "@/lib/memory/memory-fork-turn-count";
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
  OOC_CANON_ADOPTION_COPY,
  OOC_SCENE_RENDER_SEMANTICS,
  adoptOocSceneRenderCore,
  collectStaleOocAdoptionIds,
  filterCanonicalMessageRows,
  hasNewerCanonicalStoryProgress,
  isCanonAdoptedScene,
  isCanonicalGeneration,
  isEffectiveCanonEvent,
  isNoncanonicalGeneration,
  isOocSceneAdoptionPromptEligible,
  mergeGenerationSemantics,
  mergeIncomingUsageWithStoredSemantics,
  nextPersistedModelRouteState,
  persistGenerationSemanticsOnMessages,
  readCanonAdoption,
  readGenerationSemantics,
  readOocSceneClientFlags,
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

const CAFE_USER = "*라이크와 카페에 있다.*";
const CAFE_ASSISTANT = "<카페 scene>";
const HOTEL_OOC_USER =
  "OOC: 본편과 별개로 샘플로 둘이 호텔에서 키스하는 장면을 보여줘.";
const HOTEL_ASSISTANT = "<호텔 키스 scene>";
const NEXT_RP_USER = "*그의 옷깃을 정리한다.*";
const ADULT_OOC_USER =
  "OOC: 본편과 별개로 샘플로 둘이 호텔에서 성인 장면을 한 장면 써줘.";
const ADULT_ASSISTANT =
  "둘은 호텔 침대에서 옷을 벗고 격렬하게 섹스했다. 삽입과 절정이 이어졌다.";

const ADOPTED_USAGE = JSON.stringify({
  generationKind: "ooc_scene_render",
  canonical: false,
  canonAdopted: true,
  canonAdoptedAt: "2026-08-17T00:00:00.000Z",
});

function canonicalHistoryFromRows(
  rows: Array<{
    id?: number;
    role: "user" | "assistant";
    content: string;
    model?: string;
    user_message_id?: number | null;
    usage?: unknown;
  }>
) {
  return rawRecentTurnsToHistory(messagesToTurns(filterCanonicalMessageRows(rows)));
}

function createAdoptionDb() {
  const db = createMessagesDb();
  db.exec(`
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      model_route_state_json TEXT
    );
    INSERT INTO chats (id, user_id, model_route_state_json)
    VALUES (1, 10, '{"sexualContextActive":false}');
    INSERT INTO chats (id, user_id, model_route_state_json)
    VALUES (2, 99, '{"sexualContextActive":false}');
  `);
  return db;
}

function insertOwnedPair(
  db: Database.Database,
  opts: {
    chatId?: number;
    userContent: string;
    assistantContent: string;
    usage?: string | null;
    generationStatus?: string;
    alternates?: string;
    activeVariant?: number;
  }
) {
  const chatId = opts.chatId ?? 1;
  const user = db
    .prepare(`INSERT INTO messages (chat_id, role, content, model, usage) VALUES (?, 'user', ?, '', ?)`)
    .run(chatId, opts.userContent, opts.usage ?? null);
  const userId = Number(user.lastInsertRowid);
  const assistant = db
    .prepare(
      `INSERT INTO messages
        (chat_id, role, content, model, user_message_id, usage, generation_status, alternates, active_variant)
       VALUES (?, 'assistant', ?, 'model', ?, ?, ?, ?, ?)`
    )
    .run(
      chatId,
      opts.assistantContent,
      userId,
      opts.usage ?? null,
      opts.generationStatus ?? "completed",
      opts.alternates ?? "[]",
      opts.activeVariant ?? 0
    );
  return { userId, assistantId: Number(assistant.lastInsertRowid) };
}

describe("canon adoption owner helpers", () => {
  it("keeps origin canonical=false after adoption and preserves adoptedAt", () => {
    const semantics = readGenerationSemantics(ADOPTED_USAGE);
    assert.equal(semantics?.generationKind, "ooc_scene_render");
    assert.equal(semantics?.canonical, false);
    assert.equal(semantics?.canonAdopted, true);
    assert.equal(readCanonAdoption(ADOPTED_USAGE).canonAdopted, true);
    assert.equal(isCanonAdoptedScene(ADOPTED_USAGE), true);
    assert.equal(isEffectiveCanonEvent(ADOPTED_USAGE), true);
    assert.equal(isNoncanonicalGeneration(ADOPTED_USAGE), false);
    assert.equal(isCanonicalGeneration(ADOPTED_USAGE), false);
    const flags = readOocSceneClientFlags(ADOPTED_USAGE);
    assert.deepEqual(flags, { oocSceneRender: true, canonAdopted: true });
  });

  it("does not expose adoption UI for partial/failed/empty output", () => {
    assert.equal(
      isOocSceneAdoptionPromptEligible({
        role: "assistant",
        oocSceneRender: true,
        canonAdopted: false,
        generationStatus: "generating",
        content: "partial",
      }),
      false
    );
    assert.equal(
      isOocSceneAdoptionPromptEligible({
        role: "assistant",
        oocSceneRender: true,
        canonAdopted: false,
        generationStatus: "failed",
        content: "oops",
      }),
      false
    );
    assert.equal(
      isOocSceneAdoptionPromptEligible({
        role: "assistant",
        oocSceneRender: true,
        canonAdopted: false,
        generationStatus: "completed",
        content: "   ",
      }),
      false
    );
    assert.equal(
      isOocSceneAdoptionPromptEligible({
        role: "assistant",
        oocSceneRender: true,
        canonAdopted: false,
        generationStatus: "completed",
        content: HOTEL_ASSISTANT,
      }),
      true
    );
  });

  it("uses the exact confirmation copy", () => {
    assert.equal(OOC_CANON_ADOPTION_COPY.title, "이 장면을 본편에 반영할까요?");
    assert.match(OOC_CANON_ADOPTION_COPY.description, /실제로 일어난 사건/);
    assert.match(OOC_CANON_ADOPTION_COPY.description, /다음 대화는 이 장면 직후부터/);
    assert.match(OOC_CANON_ADOPTION_COPY.description, /비정사 장면으로 유지/);
    assert.equal(OOC_CANON_ADOPTION_COPY.keepNoncanonical, "비정사로 유지");
    assert.equal(OOC_CANON_ADOPTION_COPY.adopt, "본편에 반영");
    assert.equal(OOC_CANON_ADOPTION_COPY.adoptedBadge, "본편에 반영됨");
    assert.equal(
      OOC_CANON_ADOPTION_COPY.stale,
      "본편이 이미 진행되어 이 장면은 더 이상 반영할 수 없습니다."
    );
    assert.equal(OOC_CANON_ADOPTION_COPY.description.includes("되돌릴 수 있음"), false);
    assert.equal(OOC_CANON_ADOPTION_COPY.description.includes("영구 저장"), false);
    assert.equal(OOC_CANON_ADOPTION_COPY.description.includes("기억에만 저장"), false);
  });
});

describe("canon adoption history + continuity", () => {
  const cafeHotelRows = [
    { id: 1, role: "user" as const, content: CAFE_USER, user_message_id: null, usage: null },
    { id: 2, role: "assistant" as const, content: CAFE_ASSISTANT, user_message_id: 1, usage: null },
    {
      id: 3,
      role: "user" as const,
      content: HOTEL_OOC_USER,
      user_message_id: null,
      usage: OOC_USAGE,
    },
    {
      id: 4,
      role: "assistant" as const,
      content: HOTEL_ASSISTANT,
      user_message_id: 3,
      usage: OOC_USAGE,
    },
  ];

  it("CASE 1: non-adopted OOC excludes parent user and assistant", () => {
    const history = canonicalHistoryFromRows(cafeHotelRows);
    assert.deepEqual(
      history.map((row) => row.content),
      [CAFE_USER, CAFE_ASSISTANT]
    );
    assert.equal(history.some((row) => row.content.includes("호텔")), false);
    assert.equal(history.some((row) => row.content.includes("본편과 별개")), false);
  });

  it("CASE 2/8/33: adoption keeps parent OOC out and inserts assistant scene once", () => {
    const adoptedRows = cafeHotelRows.map((row) =>
      row.id === 4 ? { ...row, usage: ADOPTED_USAGE } : row
    );
    const history = canonicalHistoryFromRows(adoptedRows);
    const nextContext = [...history, { role: "user" as const, content: NEXT_RP_USER }];
    const contents = nextContext.map((row) => row.content);
    assert.deepEqual(contents, [CAFE_USER, CAFE_ASSISTANT, HOTEL_ASSISTANT, NEXT_RP_USER]);
    assert.equal(contents.filter((text) => text === HOTEL_ASSISTANT).length, 1);
    assert.equal(contents.some((text) => text.includes("본편과 별개")), false);
    assert.equal(contents.some((text) => text.includes("샘플로")), false);
    assert.equal(history.at(-1)!.content, HOTEL_ASSISTANT);
    assert.equal(history.at(-1)!.role, "assistant");
  });

  it("CASE 3: double adoption does not duplicate the canon event", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const { assistantId } = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
      now: "2026-08-17T01:00:00.000Z",
    });
    adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
      now: "2026-08-17T02:00:00.000Z",
    });
    const rows = db
      .prepare("SELECT id, role, content, user_message_id, usage FROM messages WHERE chat_id=1 ORDER BY id")
      .all() as Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      user_message_id: number | null;
      usage: unknown;
    }>;
    const history = canonicalHistoryFromRows(rows);
    assert.equal(history.filter((row) => row.content === HOTEL_ASSISTANT).length, 1);
    assert.equal(history.some((row) => row.content === HOTEL_OOC_USER), false);
    assert.equal(countMemoryEligibleCompletedTurnsCore(db, 1), 2);
  });
});

describe("canon adoption endpoint core", () => {
  it("adopts the active OOC scene idempotently without flipping origin canonical", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const { assistantId } = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    const first = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
      now: "2026-08-17T01:00:00.000Z",
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.alreadyAdopted, false);
    const stored = db
      .prepare("SELECT usage FROM messages WHERE id=?")
      .get(assistantId) as { usage: string };
    const parsed = JSON.parse(stored.usage) as Usage;
    assert.equal(parsed.generationKind, "ooc_scene_render");
    assert.equal(parsed.canonical, false);
    assert.equal(parsed.canonAdopted, true);
    assert.equal(parsed.canonAdoptedAt, "2026-08-17T01:00:00.000Z");

    const second = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
      now: "2026-08-17T02:00:00.000Z",
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyAdopted, true);
    assert.equal(second.canonAdoptedAt, "2026-08-17T01:00:00.000Z");
    const again = JSON.parse(
      (db.prepare("SELECT usage FROM messages WHERE id=?").get(assistantId) as { usage: string })
        .usage
    ) as Usage;
    assert.equal(again.canonAdoptedAt, "2026-08-17T01:00:00.000Z");
    const route = db
      .prepare("SELECT model_route_state_json FROM chats WHERE id=1")
      .get() as { model_route_state_json: string };
    assert.equal(JSON.parse(route.model_route_state_json).sexualContextActive, false);
  });

  it("CASE 4: rejects normal RP assistant adoption", () => {
    const db = createAdoptionDb();
    const { assistantId } = insertOwnedPair(db, {
      userContent: CAFE_USER,
      assistantContent: CAFE_ASSISTANT,
    });
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "not_ooc_scene_render");
  });

  it("CASE 5: rejects another user's assistant id", () => {
    const db = createAdoptionDb();
    const { assistantId } = insertOwnedPair(db, {
      chatId: 2,
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    const result = adoptOocSceneRenderCore(db, {
      chatId: 2,
      assistantMessageId: assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 404);
  });

  it("CASE 6: rejects failed/incomplete OOC scenes", () => {
    const db = createAdoptionDb();
    const failed = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
      generationStatus: "failed",
    });
    const incomplete = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: "",
      usage: OOC_USAGE,
      generationStatus: "generating",
    });
    const failedResult = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: failed.assistantId,
      ownerUserId: 10,
    });
    const incompleteResult = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: incomplete.assistantId,
      ownerUserId: 10,
    });
    assert.equal(failedResult.ok, false);
    assert.equal(incompleteResult.ok, false);
    if (!failedResult.ok) assert.equal(failedResult.code, "not_finalized");
    if (!incompleteResult.ok) assert.equal(incompleteResult.code, "not_finalized");
  });

  it("CASE 7: only the active regen variant is adopted", () => {
    const db = createAdoptionDb();
    const oldUsage = {
      generationKind: "ooc_scene_render",
      canonical: false,
      model: "old",
    };
    const activeUsage = {
      generationKind: "ooc_scene_render",
      canonical: false,
      model: "active",
    };
    const { assistantId } = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: "<호텔 키스 scene B>",
      usage: JSON.stringify(activeUsage),
      alternates: JSON.stringify([
        { content: "<호텔 키스 scene A>", model: "old", usage: oldUsage, created_at: "" },
        { content: "<호텔 키스 scene B>", model: "active", usage: activeUsage, created_at: "" },
      ]),
      activeVariant: 1,
    });
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
      now: "2026-08-17T03:00:00.000Z",
    });
    assert.equal(result.ok, true);
    const row = db
      .prepare("SELECT content, usage, alternates, active_variant FROM messages WHERE id=?")
      .get(assistantId) as {
      content: string;
      usage: string;
      alternates: string;
      active_variant: number;
    };
    assert.equal(row.content, "<호텔 키스 scene B>");
    assert.equal(JSON.parse(row.usage).canonAdopted, true);
    const variants = JSON.parse(row.alternates) as Array<{ content: string; usage?: Usage }>;
    assert.equal(variants[0]!.usage?.canonAdopted, undefined);
    assert.equal(variants[1]!.usage?.canonAdopted, true);
    assert.equal(row.active_variant, 1);
  });
});

describe("canon adoption memory / fork / adult continuity", () => {
  it("CASE 9: memory loader/backfill sees adopted assistant once and never the parent OOC", () => {
    const db = createMessagesDb();
    for (let i = 1; i <= 5; i += 1) {
      insertPair(db, `canon user ${i}`, `canon assistant ${i}`);
    }
    const ooc = insertPair(db, HOTEL_OOC_USER, HOTEL_ASSISTANT, OOC_USAGE);
    insertPair(db, "canon user 6", "canon assistant 6");
    assert.equal(countMemoryEligibleCompletedTurnsCore(db, 1), 6);
    db.prepare("UPDATE messages SET usage=? WHERE id=?").run(ADOPTED_USAGE, ooc.assistantId);
    assert.equal(countMemoryEligibleCompletedTurnsCore(db, 1), 7);
    const turns = loadMemoryEligibleChatTurnsWithMessageIdsCore(db, 1);
    const adopted = turns.filter((turn) => turn.assistant === HOTEL_ASSISTANT);
    assert.equal(adopted.length, 1);
    assert.equal(adopted[0]!.user, "");
    assert.equal(adopted[0]!.userMessageId, null);
    assert.equal(adopted[0]!.assistantMessageId, ooc.assistantId);
    assert.equal(turns.some((turn) => turn.user.includes("본편과 별개")), false);
    assert.equal(isTurnEligibleForMemoryRecord(HOTEL_OOC_USER), false);
  });

  it("CASE 10: fork row filter preserves adopted assistant and still drops parent OOC", () => {
    const copied = [
      { id: 1, role: "user", content: CAFE_USER, model: "", usage: null },
      { id: 2, role: "assistant", content: CAFE_ASSISTANT, model: "model", usage: null },
      { id: 3, role: "user", content: HOTEL_OOC_USER, model: "", usage: OOC_USAGE },
      {
        id: 4,
        role: "assistant",
        content: HOTEL_ASSISTANT,
        model: "model",
        usage: ADOPTED_USAGE,
        user_message_id: 3,
      },
    ];
    const filtered = filterCanonicalMessageRows(copied);
    assert.deepEqual(
      filtered.map((row) => row.id),
      [1, 2, 4]
    );
    assert.equal(countMemoryEligibleCompletedTurnsUpToMessageId(filtered, 4, null), 2);
  });

  it("CASE 34: adoption does not hardcode adult route state; next classifier can see the scene", () => {
    const db = createAdoptionDb();
    const { assistantId } = insertOwnedPair(db, {
      userContent: ADULT_OOC_USER,
      assistantContent: ADULT_ASSISTANT,
      usage: OOC_USAGE,
    });
    const before = db
      .prepare("SELECT model_route_state_json FROM chats WHERE id=1")
      .get() as { model_route_state_json: string };
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, true);
    const after = db
      .prepare("SELECT model_route_state_json FROM chats WHERE id=1")
      .get() as { model_route_state_json: string };
    assert.equal(after.model_route_state_json, before.model_route_state_json);
    const history = canonicalHistoryFromRows([
      { id: 1, role: "user", content: CAFE_USER, usage: null },
      { id: 2, role: "assistant", content: CAFE_ASSISTANT, usage: null },
      { id: 3, role: "user", content: ADULT_OOC_USER, usage: OOC_USAGE },
      { id: 4, role: "assistant", content: ADULT_ASSISTANT, usage: ADOPTED_USAGE, user_message_id: 3 },
    ]);
    assert.equal(history.some((row) => row.content === ADULT_ASSISTANT), true);
    assert.equal(history.some((row) => row.content.includes("본편과 별개")), false);
    const classification = classifySceneMode({
      currentInput: NEXT_RP_USER,
      previousSceneMode: "normal",
      recentRawText: history.map((row) => row.content).join("\n"),
    });
    assert.equal(typeof classification.sceneMode, "string");
    assert.equal(typeof classification.sexualContextActive, "boolean");
  });

  it("parent OOC remains ineligible for episodic persist after assistant adoption", () => {
    const db = createMessagesDb();
    ensureEpisodicMemoryFactsTable(db);
    const { userId, assistantId } = insertPair(
      db,
      HOTEL_OOC_USER,
      "둘은 연인이 되었다. 결혼을 약속했다.",
      OOC_USAGE
    );
    db.prepare("UPDATE messages SET usage=? WHERE id=?").run(ADOPTED_USAGE, assistantId);
    assert.equal(isCanonAdoptedScene(ADOPTED_USAGE), true);
    const fromParent = persistEpisodicMemoryFactsBestEffort(db, {
      chatId: 1,
      sourceTurn: 1,
      sourceUserMessageId: userId,
      sourceUserText: HOTEL_OOC_USER,
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
    assert.equal(fromParent, 0);
    assert.equal(isNoncanonicalGeneration(ADOPTED_USAGE), false);
    assert.equal(isCanonAdoptedScene(ADOPTED_USAGE), true);
    assert.equal(isTurnEligibleForMemoryRecord(HOTEL_OOC_USER), false);
  });
});

const SECOND_OOC_USER =
  "OOC: 본편과 별개로 샘플로 둘이 옥상에서 대화하는 장면을 한 번 보여줘.";
const SECOND_OOC_ASSISTANT = "<옥상 대화 scene>";
const HTML_ONLY_USER = "OOC: RP 중지. HTML로 내가 입력한 내용만 띄워줘";
const EXCLUDED_OOC_USER = "OOC: 여기서 RP 끝. 더 이상 장면 진행하지 마.";

function insertUserOnly(
  db: Database.Database,
  content: string,
  usage?: string | null
): number {
  const user = db
    .prepare(`INSERT INTO messages (chat_id, role, content, model, usage) VALUES (1, 'user', ?, '', ?)`)
    .run(content, usage ?? null);
  return Number(user.lastInsertRowid);
}

describe("stale canon adoption guard", () => {
  it("CASE A: immediate adoption after OOC with no later canon progress succeeds", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const o1 = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o1.assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const rows = db
      .prepare("SELECT id, role, content, usage FROM messages WHERE chat_id=1 ORDER BY id ASC")
      .all() as Array<{ id: number; role: string; content: string; usage: string | null }>;
    const filtered = filterCanonicalMessageRows(rows);
    assert.equal(filtered.some((row) => row.content === HOTEL_ASSISTANT), true);
    assert.equal(filtered.some((row) => row.content.includes("본편과 별개")), false);
    assert.equal(JSON.parse(String(rows.find((row) => row.id === o1.assistantId)?.usage)).canonical, false);
    assert.equal(JSON.parse(String(rows.find((row) => row.id === o1.assistantId)?.usage)).canonAdopted, true);
  });

  it("CASE B: later canonical RP makes prior OOC adoption stale", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const o1 = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    const c2 = insertOwnedPair(db, { userContent: NEXT_RP_USER, assistantContent: "<본편 계속>" });
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o1.assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.status, 409);
    assert.equal(result.code, "CANON_ADOPTION_STALE");
    assert.match(result.error, /본편이 이미 진행/);
    assert.equal(result.error.includes("canonical"), false);
    assert.equal(result.error.includes("stale"), false);
    const o1Usage = JSON.parse(
      (db.prepare("SELECT usage FROM messages WHERE id=?").get(o1.assistantId) as { usage: string }).usage
    ) as Usage;
    assert.equal(o1Usage.canonAdopted, undefined);
    assert.equal(o1Usage.canonical, false);
    const c2Usage = db.prepare("SELECT usage FROM messages WHERE id=?").get(c2.assistantId) as {
      usage: string | null;
    };
    assert.equal(c2Usage.usage, null);
    const history = db
      .prepare(
        "SELECT id, role, content, model, user_message_id, usage, generation_status FROM messages WHERE chat_id=1 ORDER BY id ASC"
      )
      .all() as Array<{
      id: number;
      role: string;
      content: string;
      model: string;
      user_message_id: number | null;
      usage: unknown;
      generation_status: string;
    }>;
    assert.equal(hasNewerCanonicalStoryProgress(history, o1.assistantId), true);
    assert.deepEqual(collectStaleOocAdoptionIds(history), [o1.assistantId]);
  });

  it("CASE C: newer noncanonical OOC only does not stale an earlier sample", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const o1 = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    insertOwnedPair(db, {
      userContent: SECOND_OOC_USER,
      assistantContent: SECOND_OOC_ASSISTANT,
      usage: OOC_USAGE,
    });
    const rows = db
      .prepare(
        "SELECT id, role, content, model, user_message_id, usage, generation_status FROM messages WHERE chat_id=1 ORDER BY id ASC"
      )
      .all() as Array<{
      id: number;
      role: string;
      content: string;
      model: string;
      user_message_id: number | null;
      usage: unknown;
      generation_status: string;
    }>;
    assert.equal(hasNewerCanonicalStoryProgress(rows, o1.assistantId), false);
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o1.assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, true);
  });

  it("CASE D: adopted scene is a later canon boundary for older OOC", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const o0 = insertOwnedPair(db, {
      userContent: SECOND_OOC_USER,
      assistantContent: SECOND_OOC_ASSISTANT,
      usage: OOC_USAGE,
    });
    const o1 = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    const first = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o1.assistantId,
      ownerUserId: 10,
    });
    assert.equal(first.ok, true);
    const late = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o0.assistantId,
      ownerUserId: 10,
    });
    assert.equal(late.ok, false);
    if (late.ok) return;
    assert.equal(late.code, "CANON_ADOPTION_STALE");
    const o0Usage = JSON.parse(
      (db.prepare("SELECT usage FROM messages WHERE id=?").get(o0.assistantId) as { usage: string }).usage
    ) as Usage;
    assert.equal(o0Usage.canonAdopted, undefined);
  });

  it("CASE E: failed / HTML-only / excluded OOC after O1 are not canon progress", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const o1 = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status)
       VALUES (1, 'assistant', '<실패 초안>', 'model', 'failed')`
    ).run();
    insertOwnedPair(db, {
      userContent: HTML_ONLY_USER,
      assistantContent: "<html only>",
    });
    insertOwnedPair(db, {
      userContent: EXCLUDED_OOC_USER,
      assistantContent: "<rp stopped>",
    });
    const rows = db
      .prepare(
        "SELECT id, role, content, model, user_message_id, usage, generation_status FROM messages WHERE chat_id=1 ORDER BY id ASC"
      )
      .all() as Array<{
      id: number;
      role: string;
      content: string;
      model: string;
      user_message_id: number | null;
      usage: unknown;
      generation_status: string;
    }>;
    assert.equal(hasNewerCanonicalStoryProgress(rows, o1.assistantId), false);
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o1.assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, true);
  });

  it("CASE F: adopt vs later canonical write keeps one consistent chronology", () => {
    const dbAdoptFirst = createAdoptionDb();
    insertOwnedPair(dbAdoptFirst, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const adopted = insertOwnedPair(dbAdoptFirst, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    const adoptWon = adoptOocSceneRenderCore(dbAdoptFirst, {
      chatId: 1,
      assistantMessageId: adopted.assistantId,
      ownerUserId: 10,
    });
    assert.equal(adoptWon.ok, true);
    const later = insertOwnedPair(dbAdoptFirst, {
      userContent: NEXT_RP_USER,
      assistantContent: "<본편 계속>",
    });
    const afterAdopt = filterCanonicalMessageRows(
      dbAdoptFirst
        .prepare("SELECT id, role, content, usage FROM messages WHERE chat_id=1 ORDER BY id ASC")
        .all() as Array<{ id: number; role: string; content: string; usage: unknown }>
    );
    assert.equal(afterAdopt.some((row) => row.id === adopted.assistantId), true);
    assert.equal(afterAdopt.some((row) => row.id === later.assistantId), true);
    assert.equal(
      afterAdopt.findIndex((row) => row.id === adopted.assistantId) <
        afterAdopt.findIndex((row) => row.id === later.assistantId),
      true
    );

    const dbCanonFirst = createAdoptionDb();
    insertOwnedPair(dbCanonFirst, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const staleTarget = insertOwnedPair(dbCanonFirst, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    insertUserOnly(dbCanonFirst, NEXT_RP_USER);
    const canonWon = adoptOocSceneRenderCore(dbCanonFirst, {
      chatId: 1,
      assistantMessageId: staleTarget.assistantId,
      ownerUserId: 10,
    });
    assert.equal(canonWon.ok, false);
    if (!canonWon.ok) assert.equal(canonWon.code, "CANON_ADOPTION_STALE");
    const staleUsage = JSON.parse(
      (dbCanonFirst.prepare("SELECT usage FROM messages WHERE id=?").get(staleTarget.assistantId) as {
        usage: string;
      }).usage
    ) as Usage;
    assert.equal(staleUsage.canonAdopted, undefined);
  });

  it("CASE G: UI may still show a button but the endpoint stays authoritative", () => {
    const db = createAdoptionDb();
    insertOwnedPair(db, { userContent: CAFE_USER, assistantContent: CAFE_ASSISTANT });
    const o1 = insertOwnedPair(db, {
      userContent: HOTEL_OOC_USER,
      assistantContent: HOTEL_ASSISTANT,
      usage: OOC_USAGE,
    });
    insertOwnedPair(db, { userContent: NEXT_RP_USER, assistantContent: "<본편 계속>" });
    assert.equal(isOocSceneAdoptionPromptEligible({
      role: "assistant",
      oocSceneRender: true,
      canonAdopted: false,
      generationStatus: "completed",
      content: HOTEL_ASSISTANT,
    }), true);
    const result = adoptOocSceneRenderCore(db, {
      chatId: 1,
      assistantMessageId: o1.assistantId,
      ownerUserId: 10,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CANON_ADOPTION_STALE");
  });
});
