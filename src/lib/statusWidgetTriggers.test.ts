import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";

import {
  buildTriggeredScenarioEventsPromptBlock,
  ensureStatusWidgetTriggerTables,
  evaluateStatusWidgetTriggers,
  insertStatusWidgetTriggerForTest,
  listCharacterStatusWidgetTriggers,
  loadQueuedStatusTriggerEventsForPrompt,
  markStatusTriggerEventsConsumed,
  saveCharacterStatusWidgetTriggers,
  validateStatusWidgetTriggerInput,
} from "./statusWidgetTriggers";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  ensureStatusWidgetTriggerTables(db);
});

describe("statusWidgetTriggers", () => {
  it("creator trigger definitions save correctly", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "d_day_zero",
        status_key: "d_day",
        operator: "<=",
        value: 0,
        fire_once: true,
        event_key: "deadline_arrived",
        effect_text: "카운트가 끝났다. 지금부터 약속된 사건이 자연스럽게 발생한다.",
        character_knowledge: "revealed_on_trigger",
        is_enabled: true,
      },
    ]);

    const saved = listCharacterStatusWidgetTriggers(db, 10);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.trigger_id, "d_day_zero");
    assert.equal(saved[0]?.status_key, "d_day");
  });

  it("invalid trigger_id is rejected", () => {
    const result = validateStatusWidgetTriggerInput({
      trigger_id: "D Day!",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      event_key: "deadline_arrived",
      effect_text: "카운트가 끝났다.",
    });

    assert.equal(result.ok, false);
  });

  it("invalid operator is rejected", () => {
    const result = validateStatusWidgetTriggerInput({
      trigger_id: "d_day_zero",
      status_key: "d_day",
      operator: "contains",
      value: 0,
      event_key: "deadline_arrived",
      effect_text: "카운트가 끝났다.",
    });

    assert.equal(result.ok, false);
  });

  it("empty effect_text is rejected", () => {
    const result = validateStatusWidgetTriggerInput({
      trigger_id: "d_day_zero",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      event_key: "deadline_arrived",
      effect_text: "",
    });

    assert.equal(result.ok, false);
  });

  it("updated trigger replaces previous trigger with same trigger_id for same character", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "affection_route_open",
        status_key: "affection",
        operator: ">=",
        value: 80,
        fire_once: true,
        event_key: "old_event",
        effect_text: "이전 사건 문장이다.",
        character_knowledge: "unknown",
        is_enabled: true,
      },
    ]);
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "affection_route_open",
        status_key: "trust",
        operator: ">=",
        value: 90,
        fire_once: false,
        event_key: "new_event",
        effect_text: "새로운 사건 문장이다.",
        character_knowledge: "known",
        is_enabled: true,
      },
    ]);

    const saved = listCharacterStatusWidgetTriggers(db, 10);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.status_key, "trust");
    assert.equal(saved[0]?.event_key, "new_event");
    assert.equal(saved[0]?.fire_once, false);
  });

  it("removed trigger is deleted from configuration", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "remove_me",
        status_key: "d_day",
        operator: "<=",
        value: 0,
        fire_once: true,
        event_key: "remove_event",
        effect_text: "삭제될 사건이다.",
        character_knowledge: "unknown",
        is_enabled: true,
      },
    ]);
    saveCharacterStatusWidgetTriggers(db, 10, []);

    const saved = listCharacterStatusWidgetTriggers(db, 10);
    assert.equal(saved.length, 0);
  });

  it("disabled trigger is not evaluated", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "disabled_trigger",
        status_key: "d_day",
        operator: "<=",
        value: 0,
        fire_once: true,
        event_key: "disabled_event",
        effect_text: "비활성 트리거 문장이다.",
        character_knowledge: "unknown",
        is_enabled: false,
      },
    ]);

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 10,
      sourceTurn: 1,
      statusValues: { character: { d_day: "0" } },
    });

    assert.equal(result.firedEvents.length, 0);
  });

  it("Phase B evaluator can load creator-defined triggers", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "creator_defined",
        status_key: "affection",
        operator: ">=",
        value: 80,
        fire_once: true,
        event_key: "creator_event",
        effect_text: "제작자가 등록한 사건이 자연스럽게 열린다.",
        character_knowledge: "revealed_on_trigger",
        is_enabled: true,
      },
    ]);

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 10,
      sourceTurn: 2,
      statusValues: { character: { affection: "82" } },
    });

    assert.equal(result.firedEvents.length, 1);
    assert.equal(result.firedEvents[0]?.event_key, "creator_event");
  });

  it("fires from creator values even when user display values are also present", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "creator_with_user_display",
        status_key: "affection",
        operator: ">=",
        value: 80,
        fire_once: true,
        event_key: "creator_with_user_event",
        effect_text: "유저 표시 위젯이 있어도 제작자 사건이 열린다.",
        character_knowledge: "revealed_on_trigger",
        is_enabled: true,
      },
    ]);

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 10,
      sourceTurn: 3,
      statusValues: {
        character: { affection: "85" },
        user: { display_mood: "happy", affection: "0" },
      },
    });

    assert.equal(result.firedEvents.length, 1);
    assert.equal(result.firedEvents[0]?.event_key, "creator_with_user_event");
  });

  it("user display-only field does not trigger creator events", () => {
    saveCharacterStatusWidgetTriggers(db, 10, [
      {
        trigger_id: "user_only_should_not_fire",
        status_key: "affection",
        operator: ">=",
        value: 80,
        fire_once: true,
        event_key: "should_not_fire",
        effect_text: "유저 표시값만으로는 열리면 안 된다.",
        character_knowledge: "unknown",
        is_enabled: true,
      },
    ]);

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 10,
      sourceTurn: 4,
      statusValues: {
        user: { affection: "99", display_mood: "excited" },
      },
    });

    assert.equal(result.firedEvents.length, 0);
  });

  it("numeric trigger fires: d_day <= 0", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      character_id: 10,
      trigger_id: "d_day_zero",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "deadline_arrived",
      effect_text: "봉인된 문장이 마침내 빛나기 시작한다.",
    });

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 10,
      sourceTurn: 7,
      statusValues: { character: { d_day: "0" } },
    });

    assert.equal(result.firedEvents.length, 1);
    assert.equal(result.firedEvents[0]?.event_key, "deadline_arrived");
  });

  it("numeric trigger does not fire: d_day > 0", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "d_day_zero",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "deadline_arrived",
      effect_text: "봉인된 문장이 마침내 빛나기 시작한다.",
    });

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 7,
      statusValues: { character: { d_day: "3" } },
    });

    assert.equal(result.firedEvents.length, 0);
  });

  it("threshold trigger fires: affection >= 80", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "affection_route_open",
      status_key: "affection",
      operator: ">=",
      value: 80,
      fire_once: true,
      event_key: "romance_route_open",
      effect_text: "렌은 레온에게 숨겨 왔던 신뢰를 처음으로 행동으로 드러낸다.",
    });

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 8,
      statusValues: { character: { affection: "82" } },
    });

    assert.equal(result.firedEvents.length, 1);
  });

  it("equality trigger fires: route_flag == true", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "route_flag_enabled",
      status_key: "route_flag",
      operator: "==",
      value: true,
      fire_once: true,
      event_key: "route_branch_enabled",
      effect_text: "숨겨진 분기 조건이 충족되어 관계의 방향이 바뀐다.",
    });

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 9,
      // Creator triggers read canonical character status only
      statusValues: { character: { route_flag: "true" } },
    });

    assert.equal(result.firedEvents.length, 1);
  });

  it("missing status key does not crash and does not fire", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "missing_key_trigger",
      status_key: "trust",
      operator: ">=",
      value: 50,
      fire_once: true,
      event_key: "trust_event",
      effect_text: "신뢰가 눈에 띄게 깊어진다.",
    });

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 10,
      statusValues: { character: { affection: "99" } },
    });

    assert.equal(result.firedEvents.length, 0);
  });

  it("fire_once prevents the same trigger from firing twice in one chat", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "once_only",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "once_event",
      effect_text: "한 번만 열리는 장면이 시작된다.",
    });

    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 11,
      statusValues: { character: { d_day: "0" } },
    });
    const second = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 12,
      statusValues: { character: { d_day: "-1" } },
    });

    assert.equal(second.firedEvents.length, 0);
    assert.equal(loadQueuedStatusTriggerEventsForPrompt(db, 1).length, 1);
  });

  it("repeating trigger can fire again on a different source_turn", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "repeatable_pressure",
      status_key: "pressure",
      operator: ">=",
      value: 5,
      fire_once: false,
      event_key: "pressure_tick",
      effect_text: "긴장감이 한층 더 높아진다.",
    });

    const first = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 13,
      statusValues: { character: { pressure: "5" } },
    });
    const duplicateTurn = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 13,
      statusValues: { character: { pressure: "6" } },
    });
    const nextTurn = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 14,
      statusValues: { character: { pressure: "6" } },
    });

    assert.equal(first.firedEvents.length, 1);
    assert.equal(duplicateTurn.firedEvents.length, 0);
    assert.equal(nextTurn.firedEvents.length, 1);
  });

  it("queued event injection uses only effect text", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "affection_route_open",
      status_key: "affection",
      operator: ">=",
      value: 80,
      fire_once: true,
      event_key: "romance_route_open",
      effect_text: "렌은 레온에게 숨겨 왔던 신뢰를 처음으로 행동으로 드러낸다.",
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 15,
      statusValues: { character: { affection: "90" } },
    });

    const block = buildTriggeredScenarioEventsPromptBlock(
      loadQueuedStatusTriggerEventsForPrompt(db, 1)
    );

    assert.match(block, /\[TRIGGERED SCENARIO EVENTS\]/);
    assert.match(block, /렌은 레온에게 숨겨 왔던 신뢰를 처음으로 행동으로 드러낸다\./);
    assert.doesNotMatch(block, /affection_route_open/);
    assert.doesNotMatch(block, /romance_route_open/);
    assert.doesNotMatch(block, /affection/);
    assert.doesNotMatch(block, />=|80/);
  });

  it("consumed event is not injected again", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "consume_me",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "consume_event",
      effect_text: "소비되어야 하는 이벤트다.",
    });
    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 16,
      statusValues: { character: { d_day: "0" } },
    });
    markStatusTriggerEventsConsumed(db, result.firedEvents.map((event) => event.id));

    assert.equal(loadQueuedStatusTriggerEventsForPrompt(db, 1).length, 0);
  });

  it("D-DAY value alone does not expose hidden consequence before trigger", () => {
    insertStatusWidgetTriggerForTest(db, {
      chat_id: 1,
      trigger_id: "d_day_death_reveal",
      status_key: "d_day",
      operator: "<=",
      value: 0,
      fire_once: true,
      event_key: "death_curse_reveal",
      effect_text: "저주가 드러나며 남은 시간이 끝났다는 사실이 밝혀진다.",
    });

    const result = evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      sourceTurn: 17,
      statusValues: { character: { d_day: "3" } },
    });
    const block = buildTriggeredScenarioEventsPromptBlock(
      loadQueuedStatusTriggerEventsForPrompt(db, 1)
    );

    assert.equal(result.firedEvents.length, 0);
    assert.equal(block, "");
    assert.doesNotMatch(block, /저주|끝났다는 사실/);
  });

  it("queued event loading can exclude events after a regeneration boundary", () => {
    insertStatusWidgetTriggerForTest(db, {
      character_id: 1,
      chat_id: null,
      trigger_id: "regen_boundary_event",
      status_key: "affection",
      operator: ">=",
      value: 80,
      fire_once: false,
      event_key: "regen_boundary_event",
      effect_text: "숨겨진 문이 열렸다.",
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 1,
      sourceTurn: 2,
      statusValues: { character: { affection: "80" } },
    });
    evaluateStatusWidgetTriggers(db, {
      chatId: 1,
      characterId: 1,
      sourceTurn: 4,
      statusValues: { character: { affection: "80" } },
    });

    const events = loadQueuedStatusTriggerEventsForPrompt(db, 1, 8, {
      maxSourceTurn: 2,
    });

    assert.deepEqual(
      events.map((event) => event.source_turn),
      [2]
    );
  });
});
