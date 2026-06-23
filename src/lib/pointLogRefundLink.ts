import { getDb } from "@/lib/db";
import type { PointUsageLog } from "@/lib/pointUsageLog";
import { isChatPointDeductionLog } from "@/lib/pointUsageLog";
import type { DeductionSlice } from "@/lib/points";
import type { Usage } from "@/lib/chatUsage";

export type PointUsageLogRow = PointUsageLog;

type MessageCandidate = {
  id: number;
  chat_id: number;
  is_refunded: number;
  created_at: string;
  usage: string | null;
  deduction_slices: string | null;
};

/** `대화 · model (입력…)` 및 구형 `대화(입력… 출력…)` */
export function parseChatLogTokens(reason: string): { input: number; output: number } | null {
  const match = reason.match(/입력토큰\s+([\d,]+)\s*(?:\/\s*)?출력토큰\s+([\d,]+)/);
  if (!match) return null;
  const input = Number(match[1]!.replace(/,/g, ""));
  const output = Number(match[2]!.replace(/,/g, ""));
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}

function parseChatLogModelLabel(reason: string): string | null {
  const match = reason.match(/^대화\s*·\s*(.+?)\s*\(/);
  return match?.[1]?.trim() || null;
}

function sliceTotal(raw: string | null): number {
  if (!raw) return 0;
  try {
    const slices = JSON.parse(raw) as DeductionSlice[];
    return slices.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
  } catch {
    return 0;
  }
}

function parseUsage(raw: string | null): Usage | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Usage;
  } catch {
    return null;
  }
}

function usageBillableTokens(usage: Usage): { input: number; output: number } {
  return {
    input: usage.apiInputTokens ?? usage.input ?? 0,
    output: usage.apiOutputTokens ?? usage.output ?? 0,
  };
}

function timeDeltaSec(log: PointUsageLogRow, candidate: MessageCandidate): number {
  const logSec = Date.parse(log.created_at.includes("T") ? log.created_at : `${log.created_at}Z`);
  const msgSec = Date.parse(
    candidate.created_at.includes("T") ? candidate.created_at : `${candidate.created_at}Z`
  );
  if (!Number.isFinite(logSec) || !Number.isFinite(msgSec)) return Number.POSITIVE_INFINITY;
  return Math.abs(logSec - msgSec);
}

function scoreCandidate(
  log: PointUsageLogRow,
  candidate: MessageCandidate,
  tokens: { input: number; output: number } | null,
  modelLabel: string | null
): number {
  let score = 0;
  const usage = parseUsage(candidate.usage);
  const deltaSec = timeDeltaSec(log, candidate);

  if (tokens && usage) {
    const bill = usageBillableTokens(usage);
    if (bill.input === tokens.input && bill.output === tokens.output) {
      if (deltaSec <= 120) score += 1000;
      else if (deltaSec <= 600) score += 300;
      // 토큰만 같고 시각이 10분+ 벌어지면 다른 턴·삭제된 메시지 가능 — 제외
    }
  }

  if (candidate.created_at === log.created_at) score += 100;

  if (deltaSec <= 2) score += 80;
  else if (deltaSec <= 60) score += 40;
  else if (deltaSec <= 300) score += 10;

  if (modelLabel && usage?.modelLabel === modelLabel) score += 20;

  const deducted = sliceTotal(candidate.deduction_slices);
  const expected = Math.abs(log.delta);
  if (deducted > 0 && Math.abs(deducted - expected) < 0.05) score += 30;

  return score;
}

function loadAssistantCandidates(userId: number, log: PointUsageLogRow): MessageCandidate[] {
  const db = getDb();
  const tokens = parseChatLogTokens(log.reason);

  if (tokens) {
    const rows = db
      .prepare(
        `SELECT m.id, m.chat_id, m.is_refunded, m.created_at, m.usage, m.deduction_slices
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
         WHERE c.user_id = ?
           AND m.role = 'assistant'
           AND m.usage IS NOT NULL
         ORDER BY m.id DESC
         LIMIT 800`
      )
      .all(userId) as MessageCandidate[];

    const matched = rows.filter((row) => {
      const usage = parseUsage(row.usage);
      if (!usage) return false;
      const bill = usageBillableTokens(usage);
      return bill.input === tokens.input && bill.output === tokens.output;
    });
    if (matched.length > 0) return matched;
  }

  return db
    .prepare(
      `SELECT m.id, m.chat_id, m.is_refunded, m.created_at, m.usage, m.deduction_slices
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE c.user_id = ?
         AND m.role = 'assistant'
         AND datetime(m.created_at) BETWEEN datetime(?, '-15 minutes') AND datetime(?, '+15 minutes')
       ORDER BY ABS(strftime('%s', m.created_at) - strftime('%s', ?))`
    )
    .all(userId, log.created_at, log.created_at, log.created_at) as MessageCandidate[];
}

function pickBestCandidate(
  log: PointUsageLogRow,
  candidates: MessageCandidate[],
  usedMessageIds: Set<number>
): MessageCandidate | null {
  const tokens = parseChatLogTokens(log.reason);
  const modelLabel = parseChatLogModelLabel(log.reason);

  let best: MessageCandidate | null = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (usedMessageIds.has(candidate.id)) continue;
    const score = scoreCandidate(log, candidate, tokens, modelLabel);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best || bestScore < 10) return null;
  return best;
}

/** point_logs에 message_id가 없는 대화 차감 내역 → assistant 메시지와 연결 */
export function enrichPointLogsForRefund(
  userId: number,
  logs: PointUsageLogRow[],
  logIds?: number[]
): PointUsageLogRow[] {
  const db = getDb();
  const persist = db.prepare(
    "UPDATE point_logs SET message_id = ?, chat_id = ? WHERE id = ? AND user_id = ? AND message_id IS NULL"
  );

  const usedMessageIds = new Set<number>(
    logs
      .filter((l) => l.message_id != null && l.message_id > 0)
      .map((l) => l.message_id as number)
  );

  const pending = logs
    .map((log, index) => ({ log, index, logId: logIds?.[index] }))
    .filter(
      ({ log }) =>
        isChatPointDeductionLog(log) &&
        !(log.message_id != null && log.message_id > 0 && log.chat_id != null && log.chat_id > 0)
    )
    .sort((a, b) => a.log.created_at.localeCompare(b.log.created_at));

  const linkedByIndex = new Map<number, PointUsageLogRow>();

  for (const { log, index, logId } of pending) {
    const candidates = loadAssistantCandidates(userId, log);
    const best = pickBestCandidate(log, candidates, usedMessageIds);
    if (!best) continue;

    usedMessageIds.add(best.id);
    if (logId != null) {
      persist.run(best.id, best.chat_id, logId, userId);
    }

    linkedByIndex.set(index, {
      ...log,
      message_id: best.id,
      chat_id: best.chat_id,
      is_refunded: !!best.is_refunded,
    });
  }

  return logs.map((log, index) => linkedByIndex.get(index) ?? log);
}
