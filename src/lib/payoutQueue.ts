import { getDb } from "./db";
import { parseAccountInfo, roundCreatorAmount } from "./creatorShared";
import { resolveBankCode, sendMoneyToUser } from "./payoutGateway";

export type PendingWithdrawalRow = {
  id: number;
  user_id: number;
  requested_cp: number;
  payout_amount: number;
  account_info: string;
  status: string;
};

export type PayoutBatchResult = {
  processed: number;
  approved: number;
  failed: number;
  errors: { withdrawalId: number; message: string }[];
};

export function listPendingWithdrawals(): PendingWithdrawalRow[] {
  return getDb()
    .prepare(
      `SELECT id, user_id, requested_cp, payout_amount, account_info, status
       FROM withdrawal_requests
       WHERE status = 'PENDING'
       ORDER BY created_at ASC, id ASC`
    )
    .all() as PendingWithdrawalRow[];
}

function markApproved(withdrawalId: number, providerRef: string) {
  const db = getDb();
  const updated = db
    .prepare(
      `UPDATE withdrawal_requests
       SET status = 'APPROVED', processed_at = datetime('now'), provider_ref = ?
       WHERE id = ? AND status = 'PENDING'`
    )
    .run(providerRef, withdrawalId);
  if (updated.changes === 0) {
    throw new Error(`출금 #${withdrawalId} 상태 갱신 실패 (이미 처리됨)`);
  }
}

function markFailedAndRollback(withdrawalId: number, userId: number, requestedCp: number, reason: string) {
  const db = getDb();
  const cp = roundCreatorAmount(requestedCp);

  db.transaction(() => {
    const updated = db
      .prepare(
        `UPDATE withdrawal_requests
         SET status = 'FAILED', failure_reason = ?, processed_at = datetime('now')
         WHERE id = ? AND status = 'PENDING'`
      )
      .run(reason.slice(0, 500), withdrawalId);
    if (updated.changes === 0) {
      throw new Error(`출금 #${withdrawalId} 실패 처리 불가 (이미 처리됨)`);
    }

    db.prepare("UPDATE users SET creator_points = ROUND(creator_points + ?, 1) WHERE id=?").run(
      cp,
      userId
    );

    db.prepare("INSERT INTO creator_point_logs (user_id, delta, reason) VALUES (?,?,?)").run(
      userId,
      cp,
      `출금 실패 CP 복구 #${withdrawalId} (${reason})`
    );
  })();
}

export async function processSingleWithdrawal(row: PendingWithdrawalRow): Promise<"approved" | "failed"> {
  const account = parseAccountInfo(row.account_info);
  if (!account) {
    markFailedAndRollback(row.id, row.user_id, row.requested_cp, "계좌 정보 파싱 실패");
    return "failed";
  }

  const bankCode = resolveBankCode(account.bankName);
  if (!bankCode) {
    markFailedAndRollback(
      row.id,
      row.user_id,
      row.requested_cp,
      `미지원 은행: ${account.bankName}`
    );
    return "failed";
  }

  const result = await sendMoneyToUser(bankCode, account.accountNumber, row.payout_amount);

  if (result.ok) {
    markApproved(row.id, result.providerRef);
    return "approved";
  }

  markFailedAndRollback(row.id, row.user_id, row.requested_cp, result.message);
  return "failed";
}

/** PENDING 큐 일괄 지급 (스케줄러·수동 실행 공용) */
export async function processPayoutQueue(): Promise<PayoutBatchResult> {
  const pending = listPendingWithdrawals();
  const summary: PayoutBatchResult = {
    processed: 0,
    approved: 0,
    failed: 0,
    errors: [],
  };

  console.log(`[payout-queue] PENDING ${pending.length}건 처리 시작`);

  for (const row of pending) {
    summary.processed += 1;
    try {
      const outcome = await processSingleWithdrawal(row);
      if (outcome === "approved") {
        summary.approved += 1;
        console.log(`[payout-queue] #${row.id} APPROVED ₩${row.payout_amount.toLocaleString()}`);
      } else {
        summary.failed += 1;
        console.warn(`[payout-queue] #${row.id} FAILED`);
      }
    } catch (e) {
      summary.failed += 1;
      const message = (e as Error).message || "알 수 없는 오류";
      summary.errors.push({ withdrawalId: row.id, message });
      console.error(`[payout-queue] #${row.id} error:`, message);
    }
  }

  console.log(
    `[payout-queue] 완료 — 처리 ${summary.processed}, 성공 ${summary.approved}, 실패 ${summary.failed}`
  );
  return summary;
}
