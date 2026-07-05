import { getDb } from "./db";
import {
  getPointBalance,
  type DeductionSlice,
  type PointBalance,
  type PointType,
} from "./points";
import { FREE_POINTS_VALID_MONTHS } from "./plans";
import { reverseCreatorRewardForMessage } from "./creatorPoints";
import { assessMessageForAutoRefund } from "./refundAutoValidation";
import { buildMessageReceiptSnapshot } from "./refundMessageReceipt";
import { AUTO_REFUND_DAILY_LIMIT } from "./reportRefundPolicy";

export type RefundProcessResult =
  | {
      status: "approved";
      message: string;
      autoRefund: boolean;
      balance?: PointBalance;
    }
  | {
      status: "pending";
      message: string;
      dailyLimitExceeded?: boolean;
    }
  | {
      status: "rejected";
      message: string;
    };

function roundAmount(n: number): number {
  return Math.round(n * 10) / 10;
}

function restoreSlice(userId: number, slice: DeductionSlice, db: ReturnType<typeof getDb>) {
  const row = db
    .prepare(
      `SELECT id, point_type, remaining_amount FROM point_transactions
       WHERE id = ? AND user_id = ? AND expires_at > datetime('now')`
    )
    .get(slice.transactionId, userId) as
    | { id: number; point_type: PointType; remaining_amount: number }
    | undefined;

  if (row) {
    db.prepare("UPDATE point_transactions SET remaining_amount = ? WHERE id = ?").run(
      roundAmount(row.remaining_amount + slice.amount),
      row.id
    );
    return;
  }

  db.prepare(
    `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
     VALUES (?, ?, ?, datetime('now', ?))`
  ).run(
    userId,
    slice.pointType,
    slice.amount,
    slice.pointType === "PAID" ? "+2 years" : `+${FREE_POINTS_VALID_MONTHS} months`
  );
}

export function refundMessageDeduction(
  userId: number,
  messageId: number,
  slices: DeductionSlice[],
  totalAmount: number,
  reason: string
): PointBalance {
  const db = getDb();
  db.transaction(() => {
    if (slices.length > 0) {
      for (const slice of slices) {
        restoreSlice(userId, slice, db);
      }
    } else if (totalAmount > 0) {
      db.prepare(
        `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
         VALUES (?, 'FREE', ?, datetime('now', '+${FREE_POINTS_VALID_MONTHS} months'))`
      ).run(userId, totalAmount);
    }

    db.prepare("INSERT INTO point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      userId,
      roundAmount(totalAmount),
      reason
    );

    db.prepare("UPDATE messages SET is_refunded = 1 WHERE id = ?").run(messageId);
    reverseCreatorRewardForMessage(messageId);
    db.prepare(
      "UPDATE users SET points = (SELECT COALESCE(SUM(remaining_amount), 0) FROM point_transactions WHERE user_id = ? AND remaining_amount > 0 AND expires_at > datetime('now')) WHERE id = ?"
    ).run(userId, userId);
  })();

  return getPointBalance(userId);
}

type MessageRefundContext = {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  is_refunded: number;
  deduction_slices: string | null;
  usage: string | null;
  status: string | null;
  created_at: string;
  user_id: number;
};

function loadMessageRefundContext(
  messageId: number,
  chatId: number
): MessageRefundContext | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT m.id, m.chat_id, m.role, m.content, m.is_refunded, m.deduction_slices, m.usage,
              m.status, m.created_at, c.user_id
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id = ? AND m.chat_id = ?`
    )
    .get(messageId, chatId) as MessageRefundContext | undefined;
}

function loadPreviousAssistantContent(chatId: number, messageId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT content FROM messages
       WHERE chat_id = ? AND role = 'assistant' AND id < ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(chatId, messageId) as { content: string } | undefined;
  return row?.content ?? null;
}

function loadPairedUserMessage(chatId: number, messageId: number): string | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT content FROM messages
       WHERE chat_id = ? AND role = 'user' AND id < ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(chatId, messageId) as { content: string } | undefined;
  return row?.content ?? null;
}

function countAutoRefundsToday(userId: number): number {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM report_refunds
       WHERE user_id = ? AND auto_refund = 1 AND status = 'approved'
         AND date(created_at) = date('now')`
    )
    .get(userId) as { c: number };
  return row?.c ?? 0;
}

function parseRefundAmount(msg: { usage: string | null }): number {
  if (!msg.usage) return 0;
  try {
    const usage = JSON.parse(msg.usage) as { cost?: number };
    return roundAmount(Number(usage.cost) || 0);
  } catch {
    return 0;
  }
}

function parseDeductionSlices(raw: string | null): DeductionSlice[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as DeductionSlice[];
  } catch {
    return [];
  }
}

/** 오류 신고 — 결함 확인 시 하루 3회까지 자동 환불, 이후 관리자 검토 */
export function processReportRefund(
  userId: number,
  messageId: number,
  chatId: number
): RefundProcessResult {
  const db = getDb();
  const msg = loadMessageRefundContext(messageId, chatId);

  if (!msg) return { status: "rejected", message: "메시지를 찾을 수 없습니다." };
  if (msg.user_id !== userId) return { status: "rejected", message: "권한이 없습니다." };
  if (msg.role !== "assistant") return { status: "rejected", message: "AI 응답만 신고할 수 있습니다." };
  if (msg.is_refunded) return { status: "rejected", message: "이미 환불된 메시지입니다." };

  const totalAmount = parseRefundAmount(msg);
  if (totalAmount <= 0) {
    return { status: "rejected", message: "환불할 포인트 내역이 없습니다." };
  }

  const existing = db
    .prepare(
      `SELECT status FROM report_refunds
       WHERE user_id = ? AND message_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, messageId) as { status: string } | undefined;

  if (existing?.status === "approved") {
    return { status: "rejected", message: "이미 환불 처리된 신고입니다." };
  }
  if (existing?.status === "pending") {
    return { status: "rejected", message: "이미 접수된 오류 신고입니다." };
  }

  const assessment = assessMessageForAutoRefund({
    content: msg.content,
    messageStatus: msg.status,
    previousAssistantContent: loadPreviousAssistantContent(chatId, messageId),
    userMessage: loadPairedUserMessage(chatId, messageId),
  });
  const receiptSnapshot = buildMessageReceiptSnapshot(msg.usage);
  const slices = parseDeductionSlices(msg.deduction_slices);
  const autoRefundsToday = countAutoRefundsToday(userId);
  const canAutoRefund =
    assessment.isError && autoRefundsToday < AUTO_REFUND_DAILY_LIMIT;

  if (canAutoRefund) {
    const balance = refundMessageDeduction(
      userId,
      messageId,
      slices,
      totalAmount,
      `오류 자동 환불 (메시지 #${messageId})`
    );

    db.prepare(
      `INSERT INTO report_refunds
         (user_id, chat_id, message_id, status, refund_amount, validation_note, receipt_snapshot, auto_refund, error_reasons)
       VALUES (?, ?, ?, 'approved', ?, ?, ?, 1, ?)`
    ).run(
      userId,
      chatId,
      messageId,
      totalAmount,
      `자동 환불: ${assessment.summary}`,
      receiptSnapshot,
      assessment.summary
    );

    db.prepare(
      "INSERT INTO reports (user_id, chat_id, message_id, content, reason) VALUES (?,?,?,?,?)"
    ).run(
      userId,
      chatId,
      messageId,
      msg.content.slice(0, 2000),
      `오류 자동 환불 — ${assessment.summary}`
    );

    return {
      status: "approved",
      autoRefund: true,
      balance,
      message: `오류가 확인되어 ${totalAmount.toLocaleString()}P가 자동 환불되었습니다. (오늘 ${autoRefundsToday + 1}/${AUTO_REFUND_DAILY_LIMIT}회)`,
    };
  }

  const validationNote = assessment.isError
    ? autoRefundsToday >= AUTO_REFUND_DAILY_LIMIT
      ? `일일 자동 환불 한도(${AUTO_REFUND_DAILY_LIMIT}회) 초과 — 관리자 검토 (${assessment.summary})`
      : `관리자 검토 (${assessment.summary})`
    : "관리자 검토";

  db.prepare(
    `INSERT INTO report_refunds
       (user_id, chat_id, message_id, status, refund_amount, validation_note, receipt_snapshot, auto_refund, error_reasons)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, ?)`
  ).run(
    userId,
    chatId,
    messageId,
    totalAmount,
    validationNote,
    receiptSnapshot,
    assessment.summary
  );

  db.prepare(
    "INSERT INTO reports (user_id, chat_id, message_id, content, reason) VALUES (?,?,?,?,?)"
  ).run(
    userId,
    chatId,
    messageId,
    msg.content.slice(0, 2000),
    assessment.isError
      ? `오류 신고 — ${assessment.summary}`
      : "오류 신고 — 관리자 검토"
  );

  if (assessment.isError && autoRefundsToday >= AUTO_REFUND_DAILY_LIMIT) {
    return {
      status: "pending",
      dailyLimitExceeded: true,
      message: `오늘 자동 환불 한도(${AUTO_REFUND_DAILY_LIMIT}회)를 사용했습니다. 관리자 확인 후 환불 여부가 결정됩니다.`,
    };
  }

  return {
    status: "pending",
    message: assessment.isError
      ? "오류 신고가 접수되었습니다. 관리자 확인 후 환불 여부가 결정됩니다."
      : "신고가 접수되었습니다. 관리자 확인 후 환불 여부가 결정됩니다.",
  };
}

export type ReportRefundAdminRow = {
  id: number;
  user_id: number;
  chat_id: number;
  message_id: number;
  status: string;
  refund_amount: number;
  validation_note: string;
  receipt_snapshot: string;
  auto_refund: number;
  error_reasons: string;
  created_at: string;
  user_nickname: string;
  user_email: string;
  message_content: string;
  message_status: string | null;
};

export function listReportRefundsForAdmin(
  filter: "pending" | "approved" | "rejected" | "all"
): ReportRefundAdminRow[] {
  const db = getDb();
  const where =
    filter === "all"
      ? ""
      : `WHERE rr.status = '${filter === "pending" ? "pending" : filter === "approved" ? "approved" : "rejected"}'`;

  return db
    .prepare(
      `SELECT rr.id, rr.user_id, rr.chat_id, rr.message_id, rr.status, rr.refund_amount,
              rr.validation_note, rr.receipt_snapshot, rr.auto_refund, rr.error_reasons, rr.created_at,
              u.nickname AS user_nickname, u.email AS user_email,
              m.content AS message_content, m.status AS message_status
       FROM report_refunds rr
       JOIN users u ON u.id = rr.user_id
       JOIN messages m ON m.id = rr.message_id AND m.chat_id = rr.chat_id
       ${where}
       ORDER BY rr.id DESC
       LIMIT 200`
    )
    .all() as ReportRefundAdminRow[];
}

export function reviewReportRefund(
  reportRefundId: number,
  action: "approve" | "reject",
  adminNote = ""
): { ok: true; balance?: PointBalance } | { ok: false; error: string; status?: number } {
  const db = getDb();

  const row = db
    .prepare(
      `SELECT rr.id, rr.user_id, rr.chat_id, rr.message_id, rr.status, rr.refund_amount,
              m.is_refunded, m.deduction_slices, m.usage, m.role
       FROM report_refunds rr
       JOIN messages m ON m.id = rr.message_id AND m.chat_id = rr.chat_id
       WHERE rr.id = ?`
    )
    .get(reportRefundId) as
    | {
        id: number;
        user_id: number;
        chat_id: number;
        message_id: number;
        status: string;
        refund_amount: number;
        is_refunded: number;
        deduction_slices: string | null;
        usage: string | null;
        role: string;
      }
    | undefined;

  if (!row) return { ok: false, error: "신고 내역을 찾을 수 없습니다.", status: 404 };
  if (row.status !== "pending") {
    return { ok: false, error: "이미 처리된 신고입니다.", status: 400 };
  }

  if (action === "reject") {
    db.prepare(
      "UPDATE report_refunds SET status = 'rejected', validation_note = ? WHERE id = ?"
    ).run(adminNote.trim() || "관리자 반려", reportRefundId);
    return { ok: true };
  }

  if (row.is_refunded) {
    db.prepare(
      "UPDATE report_refunds SET status = 'rejected', validation_note = ? WHERE id = ?"
    ).run("이미 환불된 메시지", reportRefundId);
    return { ok: false, error: "이미 환불된 메시지입니다.", status: 400 };
  }

  if (row.role !== "assistant") {
    return { ok: false, error: "AI 응답만 환불할 수 있습니다.", status: 400 };
  }

  const totalAmount = parseRefundAmount({ usage: row.usage });
  const amount = totalAmount > 0 ? totalAmount : row.refund_amount;
  const slices = parseDeductionSlices(row.deduction_slices);

  const balance = refundMessageDeduction(
    row.user_id,
    row.message_id,
    slices,
    amount,
    `오류 신고 환불 (메시지 #${row.message_id})`
  );

  db.prepare(
    "UPDATE report_refunds SET status = 'approved', validation_note = ? WHERE id = ?"
  ).run(adminNote.trim() || "관리자 승인 환불", reportRefundId);

  return { ok: true, balance };
}

export function getReportStatusesForMessages(
  userId: number,
  messageIds: number[]
): Map<number, "none" | "pending" | "approved" | "rejected"> {
  const map = new Map<number, "none" | "pending" | "approved" | "rejected">();
  if (messageIds.length === 0) return map;

  const db = getDb();
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT message_id, status FROM report_refunds
       WHERE user_id = ? AND message_id IN (${placeholders})
       ORDER BY id DESC`
    )
    .all(userId, ...messageIds) as { message_id: number; status: string }[];

  for (const row of rows) {
    if (map.has(row.message_id)) continue;
    if (
      row.status === "pending" ||
      row.status === "approved" ||
      row.status === "rejected"
    ) {
      map.set(row.message_id, row.status);
    }
  }
  return map;
}

export function getReportStatusForMessage(
  userId: number,
  messageId: number
): "none" | "pending" | "approved" | "rejected" {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT status FROM report_refunds
       WHERE user_id = ? AND message_id = ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, messageId) as { status: string } | undefined;
  if (!row) return "none";
  if (row.status === "pending" || row.status === "approved" || row.status === "rejected") {
    return row.status;
  }
  return "none";
}
