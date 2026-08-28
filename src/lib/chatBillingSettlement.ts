/**
 * Exactly-once chat turn billing — DB-owned idempotency for consumer ledger charges.
 * Single owner for chat_billing_settlements schema and settlement transactions.
 */

import type Database from "better-sqlite3";
import {
  deductPointsOnDb,
  getPointBalanceOnDb,
  InsufficientPointsError,
  type DeductionSlice,
  type PointBalance,
} from "./points";

export const CHAT_TURN_CHARGE_KIND = "chat_turn";

export const CHAT_BILLING_SETTLEMENTS_DDL = `
  CREATE TABLE IF NOT EXISTS chat_billing_settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    charge_kind TEXT NOT NULL DEFAULT 'chat_turn',
    assistant_message_id INTEGER,
    requested_points INTEGER NOT NULL,
    settled_points INTEGER NOT NULL,
    outcome TEXT NOT NULL,
    deduction_slices_json TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'native',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, chat_id, request_id, charge_kind)
  );
  CREATE INDEX IF NOT EXISTS idx_chat_billing_settlements_message
    ON chat_billing_settlements(assistant_message_id);
`;

export type ChatBillingSettlementSource =
  | "native"
  | "existing_settlement"
  | "legacy_message_deduction_slices";

export type ChatBillingSettlementOutcome =
  | "charged"
  | "waived"
  | "legacy_already_billed"
  | "duplicate_replay"
  | "legacy_malformed";

export type ChatBillingSettlementResult = {
  settlementId: number;
  appliedNewCharge: boolean;
  duplicate: boolean;
  requestedPoints: number;
  settledPoints: number;
  slices: DeductionSlice[];
  balance: PointBalance;
  source: ChatBillingSettlementSource;
  outcome: ChatBillingSettlementOutcome;
  amountMismatch?: boolean;
  assistantMessageMismatch?: boolean;
};

type SettlementRow = {
  id: number;
  user_id: number;
  chat_id: number;
  request_id: string;
  charge_kind: string;
  assistant_message_id: number | null;
  requested_points: number;
  settled_points: number;
  outcome: string;
  deduction_slices_json: string;
  reason: string;
  source: string;
};

export type SettleChatTurnBillingInput = {
  userId: number;
  chatId: number;
  requestId: string;
  assistantMessageId: number;
  requestedPoints: number;
  reason: string;
  chargeKind?: string;
};

const SETTLEMENT_SELECT = `
  SELECT id, user_id, chat_id, request_id, charge_kind, assistant_message_id,
         requested_points, settled_points, outcome, deduction_slices_json, reason, source
  FROM chat_billing_settlements
  WHERE user_id = ? AND chat_id = ? AND request_id = ? AND charge_kind = ?
`;

/** Canonical schema owner — invoked from db.ts migrate() for local and remote bootstrap. */
export function ensureChatBillingSettlementSchema(db: Pick<Database.Database, "exec">): void {
  db.exec(CHAT_BILLING_SETTLEMENTS_DDL);
}

export function isChatBillingSettlementUniqueConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  return code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT";
}

function normalizeRequestedPoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n - 1e-9);
}

function sumSliceAmounts(slices: DeductionSlice[]): number {
  return slices.reduce((sum, slice) => sum + slice.amount, 0);
}

export function parseDeductionSlicesJson(raw: string): DeductionSlice[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item == null ||
        typeof (item as DeductionSlice).transactionId !== "number" ||
        typeof (item as DeductionSlice).amount !== "number" ||
        ((item as DeductionSlice).pointType !== "PAID" &&
          (item as DeductionSlice).pointType !== "FREE")
      ) {
        return null;
      }
    }
    return parsed as DeductionSlice[];
  } catch {
    return null;
  }
}

function hasLegacyChargeSignal(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed !== "[]" && trimmed !== "null";
}

function readSettlementRow(
  db: Database.Database,
  userId: number,
  chatId: number,
  requestId: string,
  chargeKind: string
): SettlementRow | null {
  return (
    (db.prepare(SETTLEMENT_SELECT).get(userId, chatId, requestId, chargeKind) as SettlementRow | undefined) ??
    null
  );
}

export function readChatBillingSettlement(
  db: Database.Database,
  userId: number,
  chatId: number,
  requestId: string,
  chargeKind: string = CHAT_TURN_CHARGE_KIND
): ChatBillingSettlementResult | null {
  const row = readSettlementRow(db, userId, chatId, requestId, chargeKind);
  if (!row) return null;
  const slices = parseDeductionSlicesJson(row.deduction_slices_json) ?? [];
  const amountMismatch = false;
  return {
    settlementId: row.id,
    appliedNewCharge: false,
    duplicate: true,
    requestedPoints: row.requested_points,
    settledPoints: row.settled_points,
    slices,
    balance: getPointBalanceOnDb(db, userId),
    source: row.source as ChatBillingSettlementSource,
    outcome: row.outcome as ChatBillingSettlementOutcome,
    amountMismatch: amountMismatch || undefined,
  };
}

type LegacyBridgeState =
  | {
      kind: "valid";
      assistantMessageId: number;
      slices: DeductionSlice[];
      settledPoints: number;
    }
  | {
      kind: "malformed";
      assistantMessageId: number;
    };

function findLegacyBridgeState(
  db: Database.Database,
  chatId: number,
  requestId: string
): LegacyBridgeState | null {
  const rows = db
    .prepare(
      `SELECT id, deduction_slices FROM messages
       WHERE chat_id = ? AND request_id = ? AND role = 'assistant'
       ORDER BY id ASC`
    )
    .all(chatId, requestId) as Array<{ id: number; deduction_slices: string | null }>;

  for (const row of rows) {
    if (!hasLegacyChargeSignal(row.deduction_slices)) continue;
    const slices = parseDeductionSlicesJson(row.deduction_slices ?? "");
    if (slices && slices.length > 0) {
      return {
        kind: "valid",
        assistantMessageId: row.id,
        slices,
        settledPoints: sumSliceAmounts(slices),
      };
    }
    return { kind: "malformed", assistantMessageId: row.id };
  }
  return null;
}

function persistMessageDeductionSlices(
  db: Database.Database,
  assistantMessageId: number,
  chatId: number,
  requestId: string,
  slices: DeductionSlice[]
): boolean {
  const result = db
    .prepare(
      `UPDATE messages SET deduction_slices = ?
       WHERE id = ? AND chat_id = ? AND request_id = ?`
    )
    .run(JSON.stringify(slices), assistantMessageId, chatId, requestId);
  return result.changes > 0;
}

function insertSettlement(
  db: Database.Database,
  opts: {
    userId: number;
    chatId: number;
    requestId: string;
    chargeKind: string;
    assistantMessageId: number;
    requestedPoints: number;
    settledPoints: number;
    outcome: ChatBillingSettlementOutcome;
    slices: DeductionSlice[];
    reason: string;
    source: ChatBillingSettlementSource;
  }
): number {
  const insert = db
    .prepare(
      `INSERT INTO chat_billing_settlements (
         user_id, chat_id, request_id, charge_kind, assistant_message_id,
         requested_points, settled_points, outcome, deduction_slices_json, reason, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.userId,
      opts.chatId,
      opts.requestId,
      opts.chargeKind,
      opts.assistantMessageId,
      opts.requestedPoints,
      opts.settledPoints,
      opts.outcome,
      JSON.stringify(opts.slices),
      opts.reason,
      opts.source
    );
  return Number(insert.lastInsertRowid);
}

function buildResultFromRow(
  db: Database.Database,
  row: SettlementRow,
  input: SettleChatTurnBillingInput,
  appliedNewCharge: boolean,
  duplicate: boolean,
  source: ChatBillingSettlementSource
): ChatBillingSettlementResult {
  const slices = parseDeductionSlicesJson(row.deduction_slices_json) ?? [];
  const amountMismatch =
    duplicate && normalizeRequestedPoints(input.requestedPoints) !== row.settled_points;
  const assistantMessageMismatch =
    duplicate &&
    row.assistant_message_id != null &&
    row.assistant_message_id !== input.assistantMessageId;
  if (amountMismatch) {
    console.info("[ChatBillingSettlement] amount_mismatch", {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      requestedPoints: input.requestedPoints,
      settledPoints: row.settled_points,
    });
  }
  if (assistantMessageMismatch) {
    console.info("[ChatBillingSettlement] assistant_message_mismatch", {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      settlementMessageId: row.assistant_message_id,
      requestedMessageId: input.assistantMessageId,
    });
  }
  return {
    settlementId: row.id,
    appliedNewCharge,
    duplicate,
    requestedPoints: input.requestedPoints,
    settledPoints: row.settled_points,
    slices,
    balance: getPointBalanceOnDb(db, input.userId),
    source,
    outcome: row.outcome as ChatBillingSettlementOutcome,
    amountMismatch: amountMismatch || undefined,
    assistantMessageMismatch: assistantMessageMismatch || undefined,
  };
}

function settleWithinTransaction(
  db: Database.Database,
  input: SettleChatTurnBillingInput
): ChatBillingSettlementResult {
  const chargeKind = input.chargeKind ?? CHAT_TURN_CHARGE_KIND;
  const requestedPoints = normalizeRequestedPoints(input.requestedPoints);

  const existing = readSettlementRow(db, input.userId, input.chatId, input.requestId, chargeKind);
  if (existing) {
    return buildResultFromRow(db, existing, input, false, true, "existing_settlement");
  }

  const legacy = findLegacyBridgeState(db, input.chatId, input.requestId);
  if (legacy?.kind === "valid") {
    persistMessageDeductionSlices(
      db,
      legacy.assistantMessageId,
      input.chatId,
      input.requestId,
      legacy.slices
    );
    const settlementId = insertSettlement(db, {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      chargeKind,
      assistantMessageId: legacy.assistantMessageId,
      requestedPoints,
      settledPoints: legacy.settledPoints,
      outcome: "legacy_already_billed",
      slices: legacy.slices,
      reason: input.reason,
      source: "legacy_message_deduction_slices",
    });
    const row = readSettlementRow(db, input.userId, input.chatId, input.requestId, chargeKind)!;
    console.info("[ChatBillingSettlement] legacy_bridge", {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      settlementId,
      settledPoints: legacy.settledPoints,
    });
    return buildResultFromRow(db, row, input, false, true, "legacy_message_deduction_slices");
  }

  if (legacy?.kind === "malformed") {
    console.warn("[ChatBillingSettlement] legacy_malformed_slices", {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      assistantMessageId: legacy.assistantMessageId,
    });
    const settlementId = insertSettlement(db, {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      chargeKind,
      assistantMessageId: legacy.assistantMessageId,
      requestedPoints,
      settledPoints: 0,
      outcome: "legacy_malformed",
      slices: [],
      reason: input.reason,
      source: "legacy_message_deduction_slices",
    });
    const row = readSettlementRow(db, input.userId, input.chatId, input.requestId, chargeKind)!;
    return buildResultFromRow(db, row, input, false, true, "legacy_message_deduction_slices");
  }

  let slices: DeductionSlice[] = [];
  let settledPoints = 0;
  let outcome: ChatBillingSettlementOutcome = requestedPoints > 0 ? "charged" : "waived";

  if (requestedPoints > 0) {
    const deducted = deductPointsOnDb(db, input.userId, requestedPoints, input.reason, {
      messageId: input.assistantMessageId,
      chatId: input.chatId,
    });
    slices = deducted.slices;
    settledPoints = deducted.total;
    outcome = "charged";
  }

  persistMessageDeductionSlices(
    db,
    input.assistantMessageId,
    input.chatId,
    input.requestId,
    slices
  );

  insertSettlement(db, {
    userId: input.userId,
    chatId: input.chatId,
    requestId: input.requestId,
    chargeKind,
    assistantMessageId: input.assistantMessageId,
    requestedPoints,
    settledPoints,
    outcome,
    slices,
    reason: input.reason,
    source: "native",
  });

  console.info("[ChatBillingSettlement] fresh_settlement", {
    userId: input.userId,
    chatId: input.chatId,
    requestId: input.requestId,
    settledPoints,
    outcome,
  });

  const row = readSettlementRow(db, input.userId, input.chatId, input.requestId, chargeKind)!;
  return buildResultFromRow(db, row, input, requestedPoints > 0, false, "native");
}

/**
 * Exactly-once chat turn billing. DB UNIQUE constraint is the final concurrent guard.
 * `alreadyBilledForRequest` must not authorize charges — this function owns safety.
 */
export function settleChatTurnBillingExactlyOnce(
  db: Database.Database,
  input: SettleChatTurnBillingInput
): ChatBillingSettlementResult {
  try {
    return db.transaction(() => settleWithinTransaction(db, input))();
  } catch (err) {
    if (isChatBillingSettlementUniqueConflict(err)) {
      const chargeKind = input.chargeKind ?? CHAT_TURN_CHARGE_KIND;
      const row = readSettlementRow(db, input.userId, input.chatId, input.requestId, chargeKind);
      if (!row) throw err;
      console.info("[ChatBillingSettlement] duplicate_replay", {
        userId: input.userId,
        chatId: input.chatId,
        requestId: input.requestId,
      });
      return buildResultFromRow(db, row, input, false, true, "existing_settlement");
    }
    if (err instanceof InsufficientPointsError) {
      throw err;
    }
    throw err;
  }
}
