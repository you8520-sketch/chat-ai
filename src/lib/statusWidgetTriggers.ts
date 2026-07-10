import type Database from "better-sqlite3";
import { mergeNamespacedStatusValues } from "@/lib/statusWidget/namespaces";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";

export type StatusTriggerOperator = "<=" | ">=" | "==" | "!=" | "<" | ">";
export type StatusTriggerVisibility = "engine_only";
export type StatusTriggerCharacterKnowledge = "unknown" | "known" | "revealed_on_trigger";

export type StatusWidgetTriggerDefinition = {
  id?: number;
  character_id?: number | null;
  chat_id?: number | null;
  trigger_id: string;
  status_key: string;
  operator: StatusTriggerOperator;
  value: string | number | boolean;
  fire_once: boolean;
  event_key: string;
  effect_text: string;
  visibility: StatusTriggerVisibility;
  character_knowledge: StatusTriggerCharacterKnowledge;
  is_enabled: boolean;
};

export type StatusTriggerEvent = {
  id: number;
  chat_id: number;
  character_id: number | null;
  trigger_id: string;
  event_key: string;
  source_turn: number;
  effect_text: string;
  is_consumed: number;
  fired_at: string;
  consumed_at: string | null;
  metadata: string | null;
};

export type StatusWidgetTriggerInput = {
  trigger_id: string;
  status_key: string;
  operator: StatusTriggerOperator;
  value: string | number | boolean;
  fire_once: boolean;
  event_key: string;
  effect_text: string;
  character_knowledge: StatusTriggerCharacterKnowledge;
  is_enabled: boolean;
};

type TriggerRow = {
  id: number;
  character_id: number | null;
  chat_id: number | null;
  trigger_id: string;
  status_key: string;
  operator: string;
  value: string;
  fire_once: number;
  event_key: string;
  effect_text: string;
  visibility: string;
  character_knowledge: string;
  is_enabled: number;
};

const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const OPERATORS = new Set<StatusTriggerOperator>(["<=", ">=", "==", "!=", "<", ">"]);
const KNOWLEDGE = new Set<StatusTriggerCharacterKnowledge>([
  "unknown",
  "known",
  "revealed_on_trigger",
]);

function isKoreanText(text: string): boolean {
  return /[가-힣]/.test(text.trim());
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseTriggerInputValue(value: unknown): string | number | boolean | null {
  if (typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value as number) ? (value as number | boolean) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === "true";
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function validateStatusWidgetTriggerInput(
  raw: unknown
): { ok: true; trigger: StatusWidgetTriggerInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "트리거 형식이 올바르지 않습니다." };
  }
  const o = raw as Record<string, unknown>;
  const trigger_id = String(o.trigger_id ?? "").trim();
  const status_key = String(o.status_key ?? "").trim();
  const operator = String(o.operator ?? "").trim() as StatusTriggerOperator;
  const event_key = String(o.event_key ?? "").trim();
  const effect_text = String(o.effect_text ?? "").trim();
  const character_knowledge = String(
    o.character_knowledge ?? "revealed_on_trigger"
  ).trim() as StatusTriggerCharacterKnowledge;
  const value = parseTriggerInputValue(o.value);

  if (!SNAKE_CASE_RE.test(trigger_id)) {
    return { ok: false, error: "trigger_id는 snake_case 형식이어야 합니다." };
  }
  if (!SNAKE_CASE_RE.test(event_key)) {
    return { ok: false, error: "event_key는 snake_case 형식이어야 합니다." };
  }
  if (!status_key) return { ok: false, error: "status_key를 입력해 주세요." };
  if (!OPERATORS.has(operator)) return { ok: false, error: "지원하지 않는 연산자입니다." };
  if (value == null) return { ok: false, error: "비교값을 입력해 주세요." };
  if (!effect_text || !isKoreanText(effect_text)) {
    return { ok: false, error: "effect_text는 한국어 문장으로 입력해 주세요." };
  }
  if (!KNOWLEDGE.has(character_knowledge)) {
    return { ok: false, error: "character_knowledge 값이 올바르지 않습니다." };
  }

  return {
    ok: true,
    trigger: {
      trigger_id,
      status_key,
      operator,
      value,
      fire_once: coerceBoolean(o.fire_once, true),
      event_key,
      effect_text,
      character_knowledge,
      is_enabled: coerceBoolean(o.is_enabled, true),
    },
  };
}

export function validateStatusWidgetTriggerInputs(
  raw: unknown
): { ok: true; triggers: StatusWidgetTriggerInput[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, triggers: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "상태창 트리거 목록 형식이 올바르지 않습니다." };
  const out: StatusWidgetTriggerInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = validateStatusWidgetTriggerInput(item);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.trigger.trigger_id)) {
      return { ok: false, error: `중복된 trigger_id입니다: ${parsed.trigger.trigger_id}` };
    }
    seen.add(parsed.trigger.trigger_id);
    out.push(parsed.trigger);
  }
  return { ok: true, triggers: out.slice(0, 50) };
}

export function ensureStatusWidgetTriggerTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_widget_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER,
      chat_id INTEGER,
      trigger_id TEXT NOT NULL,
      status_key TEXT NOT NULL,
      operator TEXT NOT NULL,
      value TEXT NOT NULL,
      fire_once INTEGER NOT NULL DEFAULT 1,
      event_key TEXT NOT NULL,
      effect_text TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'engine_only',
      character_knowledge TEXT NOT NULL DEFAULT 'unknown',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_status_widget_triggers_lookup
      ON status_widget_triggers(chat_id, character_id, is_enabled);
    CREATE INDEX IF NOT EXISTS idx_status_widget_triggers_trigger
      ON status_widget_triggers(trigger_id);

    CREATE TABLE IF NOT EXISTS status_trigger_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      trigger_id TEXT NOT NULL,
      event_key TEXT NOT NULL,
      source_turn INTEGER NOT NULL,
      effect_text TEXT NOT NULL,
      is_consumed INTEGER NOT NULL DEFAULT 0,
      fired_at TEXT NOT NULL DEFAULT (datetime('now')),
      consumed_at TEXT,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_status_trigger_events_chat_consumed
      ON status_trigger_events(chat_id, is_consumed, fired_at, id);
    CREATE INDEX IF NOT EXISTS idx_status_trigger_events_once
      ON status_trigger_events(chat_id, trigger_id);
    CREATE INDEX IF NOT EXISTS idx_status_trigger_events_turn
      ON status_trigger_events(chat_id, trigger_id, source_turn);
  `);
}

function serializeTriggerValue(value: string | number | boolean): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function insertStatusWidgetTriggerForTest(
  db: Database.Database,
  trigger: Omit<StatusWidgetTriggerDefinition, "visibility" | "character_knowledge" | "is_enabled"> &
    Partial<Pick<StatusWidgetTriggerDefinition, "visibility" | "character_knowledge" | "is_enabled">>
): number {
  ensureStatusWidgetTriggerTables(db);
  const row = db
    .prepare(
      `INSERT INTO status_widget_triggers
       (character_id, chat_id, trigger_id, status_key, operator, value, fire_once,
        event_key, effect_text, visibility, character_knowledge, is_enabled)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      trigger.character_id ?? null,
      trigger.chat_id ?? null,
      trigger.trigger_id,
      trigger.status_key,
      trigger.operator,
      serializeTriggerValue(trigger.value),
      trigger.fire_once ? 1 : 0,
      trigger.event_key,
      trigger.effect_text,
      trigger.visibility ?? "engine_only",
      trigger.character_knowledge ?? "unknown",
      trigger.is_enabled === false ? 0 : 1
    );
  return Number(row.lastInsertRowid);
}

export function saveCharacterStatusWidgetTriggers(
  db: Database.Database,
  characterId: number,
  triggers: StatusWidgetTriggerInput[]
): void {
  ensureStatusWidgetTriggerTables(db);
  const existing = db
    .prepare("SELECT trigger_id FROM status_widget_triggers WHERE character_id=? AND chat_id IS NULL")
    .all(characterId) as { trigger_id: string }[];
  const nextIds = new Set(triggers.map((trigger) => trigger.trigger_id));

  const tx = db.transaction(() => {
    for (const row of existing) {
      if (!nextIds.has(row.trigger_id)) {
        db.prepare(
          "DELETE FROM status_widget_triggers WHERE character_id=? AND chat_id IS NULL AND trigger_id=?"
        ).run(characterId, row.trigger_id);
      }
    }

    for (const trigger of triggers) {
      const found = db
        .prepare(
          "SELECT id FROM status_widget_triggers WHERE character_id=? AND chat_id IS NULL AND trigger_id=? LIMIT 1"
        )
        .get(characterId, trigger.trigger_id) as { id: number } | undefined;
      if (found) {
        db.prepare(
          `UPDATE status_widget_triggers SET
             status_key=?, operator=?, value=?, fire_once=?, event_key=?, effect_text=?,
             visibility='engine_only', character_knowledge=?, is_enabled=?, updated_at=datetime('now')
           WHERE id=?`
        ).run(
          trigger.status_key,
          trigger.operator,
          serializeTriggerValue(trigger.value),
          trigger.fire_once ? 1 : 0,
          trigger.event_key,
          trigger.effect_text,
          trigger.character_knowledge,
          trigger.is_enabled ? 1 : 0,
          found.id
        );
      } else {
        db.prepare(
          `INSERT INTO status_widget_triggers
           (character_id, chat_id, trigger_id, status_key, operator, value, fire_once,
            event_key, effect_text, visibility, character_knowledge, is_enabled)
           VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          characterId,
          trigger.trigger_id,
          trigger.status_key,
          trigger.operator,
          serializeTriggerValue(trigger.value),
          trigger.fire_once ? 1 : 0,
          trigger.event_key,
          trigger.effect_text,
          "engine_only",
          trigger.character_knowledge,
          trigger.is_enabled ? 1 : 0
        );
      }
    }
  });
  tx();
}

export function listCharacterStatusWidgetTriggers(
  db: Database.Database,
  characterId: number
): StatusWidgetTriggerInput[] {
  ensureStatusWidgetTriggerTables(db);
  const rows = db
    .prepare(
      `SELECT * FROM status_widget_triggers
       WHERE character_id=? AND chat_id IS NULL
       ORDER BY id ASC`
    )
    .all(characterId) as TriggerRow[];
  return rows.map((row) => ({
    trigger_id: row.trigger_id,
    status_key: row.status_key,
    operator: row.operator as StatusTriggerOperator,
    value: parseStoredTriggerValue(row.value),
    fire_once: row.fire_once === 1,
    event_key: row.event_key,
    effect_text: row.effect_text,
    character_knowledge: KNOWLEDGE.has(row.character_knowledge as StatusTriggerCharacterKnowledge)
      ? (row.character_knowledge as StatusTriggerCharacterKnowledge)
      : "unknown",
    is_enabled: row.is_enabled === 1,
  }));
}

function triggerRowIsValid(row: TriggerRow): boolean {
  if (!SNAKE_CASE_RE.test(row.trigger_id) || !SNAKE_CASE_RE.test(row.event_key)) return false;
  if (!row.status_key.trim() || !OPERATORS.has(row.operator as StatusTriggerOperator)) return false;
  if (row.visibility !== "engine_only") return false;
  if (!KNOWLEDGE.has(row.character_knowledge as StatusTriggerCharacterKnowledge)) return false;
  if (!row.effect_text.trim()) return false;
  return row.is_enabled === 1;
}

function parseStoredTriggerValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
      return parsed;
    }
  } catch {
    // keep string fallback
  }
  return trimmed;
}

function flattenStatusValues(values: ParsedStatusWidgetTurnValues | null | undefined): Record<string, string> {
  // Creator triggers read canonical creator status only — never user display values.
  const { creatorForTriggers } = mergeNamespacedStatusValues(values);
  return creatorForTriggers;
}

function normalizeRuntimeValue(value: string): string | number | boolean {
  const trimmed = value.trim();
  const numeric = trimmed.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (numeric?.[0] != null && numeric[0].length >= Math.min(1, trimmed.length)) {
    return Number(numeric[0]);
  }
  if (/^(true|yes|on|참|예|켜짐)$/i.test(trimmed)) return true;
  if (/^(false|no|off|거짓|아니오|꺼짐)$/i.test(trimmed)) return false;
  return trimmed;
}

function compareTriggerValues(
  actual: string | number | boolean,
  operator: StatusTriggerOperator,
  expected: string | number | boolean
): boolean {
  if (operator === "==" || operator === "!=") {
    const same =
      typeof actual === "string" || typeof expected === "string"
        ? String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()
        : actual === expected;
    return operator === "==" ? same : !same;
  }

  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (operator === "<=") return actual <= expected;
  if (operator === ">=") return actual >= expected;
  if (operator === "<") return actual < expected;
  if (operator === ">") return actual > expected;
  return false;
}

function alreadyFired(db: Database.Database, chatId: number, triggerId: string): boolean {
  const row = db
    .prepare("SELECT id FROM status_trigger_events WHERE chat_id=? AND trigger_id=? LIMIT 1")
    .get(chatId, triggerId) as { id: number } | undefined;
  return Boolean(row);
}

function alreadyQueuedForTurn(
  db: Database.Database,
  chatId: number,
  triggerId: string,
  sourceTurn: number
): boolean {
  const row = db
    .prepare(
      "SELECT id FROM status_trigger_events WHERE chat_id=? AND trigger_id=? AND source_turn=? LIMIT 1"
    )
    .get(chatId, triggerId, sourceTurn) as { id: number } | undefined;
  return Boolean(row);
}

export function evaluateStatusWidgetTriggers(
  db: Database.Database,
  opts: {
    chatId: number;
    characterId?: number | null;
    sourceTurn: number;
    statusValues: ParsedStatusWidgetTurnValues | null | undefined;
  }
): { firedEvents: StatusTriggerEvent[] } {
  ensureStatusWidgetTriggerTables(db);
  const statusMap = flattenStatusValues(opts.statusValues);
  if (Object.keys(statusMap).length === 0) return { firedEvents: [] };

  const rows = db
    .prepare(
      `SELECT * FROM status_widget_triggers
       WHERE is_enabled=1
         AND (chat_id IS NULL OR chat_id=?)
         AND (character_id IS NULL OR character_id=?)
       ORDER BY chat_id DESC, character_id DESC, id ASC`
    )
    .all(opts.chatId, opts.characterId ?? null) as TriggerRow[];

  const firedEvents: StatusTriggerEvent[] = [];
  for (const row of rows) {
    if (!triggerRowIsValid(row)) continue;
    const rawActual = statusMap[row.status_key] ?? statusMap[row.status_key.toLowerCase()];
    if (rawActual == null) continue;

    const actual = normalizeRuntimeValue(rawActual);
    const expected = parseStoredTriggerValue(row.value);
    const matched = compareTriggerValues(
      actual,
      row.operator as StatusTriggerOperator,
      expected
    );
    if (!matched) continue;
    if (row.fire_once === 1 && alreadyFired(db, opts.chatId, row.trigger_id)) continue;
    if (row.fire_once !== 1 && alreadyQueuedForTurn(db, opts.chatId, row.trigger_id, opts.sourceTurn)) {
      continue;
    }

    const metadata = JSON.stringify({
      trigger_row_id: row.id,
      character_knowledge: row.character_knowledge,
    });
    const inserted = db
      .prepare(
        `INSERT INTO status_trigger_events
         (chat_id, character_id, trigger_id, event_key, source_turn, effect_text, is_consumed, metadata)
         VALUES (?,?,?,?,?,?,0,?)`
      )
      .run(
        opts.chatId,
        opts.characterId ?? null,
        row.trigger_id,
        row.event_key,
        opts.sourceTurn,
        row.effect_text,
        metadata
      );
    const event = db
      .prepare("SELECT * FROM status_trigger_events WHERE id=?")
      .get(Number(inserted.lastInsertRowid)) as StatusTriggerEvent;
    firedEvents.push(event);
  }

  if (process.env.NODE_ENV === "development" && firedEvents.length > 0) {
    console.log(
      "[StatusTrigger] fired events:",
      firedEvents.map((event) => ({
        chat_id: event.chat_id,
        source_turn: event.source_turn,
        trigger_id: event.trigger_id,
        event_key: event.event_key,
      }))
    );
  }

  return { firedEvents };
}

export function evaluateStatusWidgetTriggersBestEffort(
  db: Database.Database,
  opts: Parameters<typeof evaluateStatusWidgetTriggers>[1]
): { firedEvents: StatusTriggerEvent[] } {
  try {
    return evaluateStatusWidgetTriggers(db, opts);
  } catch (error) {
    console.error("[StatusTrigger] evaluation failed:", (error as Error).message);
    return { firedEvents: [] };
  }
}

export function loadQueuedStatusTriggerEventsForPrompt(
  db: Database.Database,
  chatId: number,
  limit = 8
): StatusTriggerEvent[] {
  ensureStatusWidgetTriggerTables(db);
  return db
    .prepare(
      `SELECT * FROM status_trigger_events
       WHERE chat_id=? AND is_consumed=0
       ORDER BY fired_at ASC, id ASC
       LIMIT ?`
    )
    .all(chatId, Math.max(1, Math.min(20, limit))) as StatusTriggerEvent[];
}

export function buildTriggeredScenarioEventsPromptBlock(events: StatusTriggerEvent[]): string {
  const effectTexts = events
    .map((event) => event.effect_text.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (effectTexts.length === 0) return "";

  return [
    "[TRIGGERED SCENARIO EVENTS]",
    "These events have just been triggered by backend scenario logic.",
    "Use only the revealed event text.",
    "Do not mention trigger IDs, thresholds, status keys, counters, or backend logic.",
    "Do not reveal hidden mechanics beyond the event text.",
    "If the event text does not explicitly reveal a hidden cause, keep the cause unknown to the character.",
    "Continue the scene naturally.",
    "",
    ...effectTexts.map((text) => `* ${text}`),
  ].join("\n");
}

export function markStatusTriggerEventsConsumed(
  db: Database.Database,
  eventIds: number[]
): void {
  if (eventIds.length === 0) return;
  ensureStatusWidgetTriggerTables(db);
  const update = db.prepare(
    "UPDATE status_trigger_events SET is_consumed=1, consumed_at=datetime('now') WHERE id=? AND is_consumed=0"
  );
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) update.run(id);
  });
  tx([...new Set(eventIds.filter((id) => Number.isInteger(id) && id > 0))]);
}
