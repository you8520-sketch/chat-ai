/**
 * Exactly-once chat turn billing — DB-owned idempotency for consumer ledger charges.
 */

import type Database from "better-sqlite3";
import {
  deductPointsOnDb,
  getPointBalanceOnDb,
  InsufficientPointsError,
  type DeductionSlice,
  type PointBalance,
} from "./points";
import {
  CHAT_BILLING_SETTLEMENTS_TABLE,
  CHAT_BILLING_SETTLEMENT_UNIQUE_COLUMNS,
} from "./chatBillingSettlementSchema";

export { ensureChatBillingSettlementSchema, hasChatBillingSettlementSchema } from "./chatBillingSettlementSchema";

export const CHAT_TURN_CHARGE_KIND = "chat_turn";

/** Settlement uses BEGIN IMMEDIATE to serialize concurrent writers before claim insert. */
export const SETTLEMENT_TRANSACTION_MODE = "IMMEDIATE" as const;

export const SETTLEMENT_CONTENTION_FAILURE_MODES = [
  "SQLITE_BUSY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_LOCKED",
] as const;

export const SETTLEMENT_CONTENTION_MAX_ATTEMPTS = 12;

const CLAIM_OUTCOME = "claiming";

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

export function isRetryableSettlementContention(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (
    code === "SQLITE_BUSY" ||
    code === "SQLITE_BUSY_SNAPSHOT" ||
    code === "SQLITE_LOCKED"
  ) {
    return true;
  }
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(err.message);
}

/** Match only the canonical chat_billing_settlements identity UNIQUE — not generic constraints. */
export function isChatBillingSettlementUniqueConflict(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code !== "SQLITE_CONSTRAINT_UNIQUE") return false;
  const message = err.message.toLowerCase();
  if (message.includes(CHAT_BILLING_SETTLEMENTS_TABLE)) return true;
  return CHAT_BILLING_SETTLEMENT_UNIQUE_COLUMNS.every((col) => message.includes(col));
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

function readSettlementRowSafe(
  db: Database.Database,
  userId: number,
  chatId: number,
  requestId: string,
  chargeKind: string
): SettlementRow | null {
  for (let attempt = 1; attempt <= SETTLEMENT_CONTENTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return readSettlementRow(db, userId, chatId, requestId, chargeKind);
    } catch (err) {
      if (!isRetryableSettlementContention(err) || attempt === SETTLEMENT_CONTENTION_MAX_ATTEMPTS) {
        throw err;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * attempt);
    }
  }
  return null;
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

function insertSettlementOrIgnore(
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
): { inserted: boolean; settlementId: number | null } {
  const insert = db
    .prepare(
      `INSERT INTO chat_billing_settlements (
         user_id, chat_id, request_id, charge_kind, assistant_message_id,
         requested_points, settled_points, outcome, deduction_slices_json, reason, source
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, chat_id, request_id, charge_kind) DO NOTHING`
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
  if (insert.changes === 0) return { inserted: false, settlementId: null };
  return { inserted: true, settlementId: Number(insert.lastInsertRowid) };
}

function tryAcquireSettlementClaim(
  db: Database.Database,
  input: SettleChatTurnBillingInput,
  chargeKind: string,
  requestedPoints: number
): { acquired: boolean; claimId: number | null } {
  const claim = db
    .prepare(
      `INSERT INTO chat_billing_settlements (
         user_id, chat_id, request_id, charge_kind, assistant_message_id,
         requested_points, settled_points, outcome, deduction_slices_json, reason, source
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, '[]', ?, 'native')
       ON CONFLICT(user_id, chat_id, request_id, charge_kind) DO NOTHING`
    )
    .run(
      input.userId,
      input.chatId,
      input.requestId,
      chargeKind,
      input.assistantMessageId,
      requestedPoints,
      CLAIM_OUTCOME,
      input.reason
    );
  if (claim.changes === 0) return { acquired: false, claimId: null };
  return { acquired: true, claimId: Number(claim.lastInsertRowid) };
}

function finalizeSettlementClaim(
  db: Database.Database,
  claimId: number,
  opts: {
    settledPoints: number;
    outcome: ChatBillingSettlementOutcome;
    slices: DeductionSlice[];
    reason: string;
    source: ChatBillingSettlementSource;
    assistantMessageId: number;
  }
): void {
  db.prepare(
    `UPDATE chat_billing_settlements
     SET assistant_message_id = ?,
         settled_points = ?,
         outcome = ?,
         deduction_slices_json = ?,
         reason = ?,
         source = ?
     WHERE id = ?`
  ).run(
    opts.assistantMessageId,
    opts.settledPoints,
    opts.outcome,
    JSON.stringify(opts.slices),
    opts.reason,
    opts.source,
    claimId
  );
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

function duplicateResultFromExistingRow(
  db: Database.Database,
  input: SettleChatTurnBillingInput,
  row: SettlementRow,
  source: ChatBillingSettlementSource = "existing_settlement"
): ChatBillingSettlementResult {
  console.info("[ChatBillingSettlement] duplicate_replay", {
    userId: input.userId,
    chatId: input.chatId,
    requestId: input.requestId,
    settlementId: row.id,
  });
  return buildResultFromRow(db, row, input, false, true, source);
}

function settleWithinTransaction(
  db: Database.Database,
  input: SettleChatTurnBillingInput
): ChatBillingSettlementResult {
  const chargeKind = input.chargeKind ?? CHAT_TURN_CHARGE_KIND;
  const requestedPoints = normalizeRequestedPoints(input.requestedPoints);

  const existing = readSettlementRowSafe(db, input.userId, input.chatId, input.requestId, chargeKind);
  if (existing && existing.outcome !== CLAIM_OUTCOME) {
    return duplicateResultFromExistingRow(db, input, existing);
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
    const inserted = insertSettlementOrIgnore(db, {
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
    if (!inserted.inserted) {
      return duplicateResultFromExistingRow(db, input, row, "legacy_message_deduction_slices");
    }
    console.info("[ChatBillingSettlement] legacy_bridge", {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
      settlementId: inserted.settlementId,
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
    const inserted = insertSettlementOrIgnore(db, {
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
    if (!inserted.inserted) {
      return duplicateResultFromExistingRow(db, input, row, "legacy_message_deduction_slices");
    }
    return buildResultFromRow(db, row, input, false, true, "legacy_message_deduction_slices");
  }

  const claim = tryAcquireSettlementClaim(db, input, chargeKind, requestedPoints);
  if (!claim.acquired || claim.claimId == null) {
    const winner = readSettlementRowSafe(db, input.userId, input.chatId, input.requestId, chargeKind);
    if (!winner) {
      throw new Error("Settlement claim lost but no canonical row found");
    }
    return duplicateResultFromExistingRow(db, input, winner);
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

  finalizeSettlementClaim(db, claim.claimId, {
    settledPoints,
    outcome,
    slices,
    reason: input.reason,
    source: "native",
    assistantMessageId: input.assistantMessageId,
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

function runSettlementTransaction(
  db: Database.Database,
  input: SettleChatTurnBillingInput
): ChatBillingSettlementResult {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = settleWithinTransaction(db, input);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Connection may already be rolled back on driver contention errors.
    }
    throw err;
  }
}

/**
 * Exactly-once chat turn billing.
 * Claim-first: settlement identity is acquired before any ledger mutation.
 */
export function settleChatTurnBillingExactlyOnce(
  db: Database.Database,
  input: SettleChatTurnBillingInput
): ChatBillingSettlementResult {
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // Some remote drivers may reject pragma mutation; contention retry remains.
  }

  const chargeKind = input.chargeKind ?? CHAT_TURN_CHARGE_KIND;
  let lastError: unknown;

  for (let attempt = 1; attempt <= SETTLEMENT_CONTENTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return runSettlementTransaction(db, input);
    } catch (err) {
      lastError = err;
      if (err instanceof InsufficientPointsError) throw err;
      if (isChatBillingSettlementUniqueConflict(err)) {
        const row = readSettlementRowSafe(db, input.userId, input.chatId, input.requestId, chargeKind);
        if (!row) throw err;
        return duplicateResultFromExistingRow(db, input, row);
      }
      if (isRetryableSettlementContention(err) && attempt < SETTLEMENT_CONTENTION_MAX_ATTEMPTS) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * attempt);
        continue;
      }
      break;
    }
  }

  const settled = readSettlementRowSafe(db, input.userId, input.chatId, input.requestId, chargeKind);
  if (settled && settled.outcome !== CLAIM_OUTCOME) {
    return duplicateResultFromExistingRow(db, input, settled);
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("Settlement contention retries exhausted");
}
