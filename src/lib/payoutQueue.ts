import {
  executeWithdrawalPayout,
  listWithdrawalsForExecution,
  listPendingWithdrawals,
  processSingleWithdrawal,
  type WithdrawalExecutionRow,
} from "@/lib/payoutExecution";

export type PendingWithdrawalRow = WithdrawalExecutionRow;

export type PayoutBatchResult = {
  processed: number;
  approved: number;
  failed: number;
  reconciliationRequired: number;
  skipped: number;
  errors: { withdrawalId: number; message: string }[];
};

export { listPendingWithdrawals, processSingleWithdrawal };

/** PENDING 출금의 durable attempt state를 처리하는 공용 batch owner (스케줄러·수동 실행 공용) */
export async function processPayoutQueue(): Promise<PayoutBatchResult> {
  const queue = listWithdrawalsForExecution();
  const summary: PayoutBatchResult = {
    processed: 0,
    approved: 0,
    failed: 0,
    reconciliationRequired: 0,
    skipped: 0,
    errors: [],
  };

  console.log(`[payout-queue] 실행 대상 ${queue.length}건 처리 시작`);

  for (const row of queue) {
    summary.processed += 1;
    try {
      const outcome = await executeWithdrawalPayout(row);
      switch (outcome) {
        case "approved":
          summary.approved += 1;
          console.log(`[payout-queue] #${row.id} APPROVED ₩${row.payout_amount.toLocaleString()}`);
          break;
        case "failed":
          summary.failed += 1;
          console.warn(`[payout-queue] #${row.id} FAILED`);
          break;
        case "reconciliation_required":
          summary.reconciliationRequired += 1;
          console.warn(`[payout-queue] #${row.id} RECONCILIATION_REQUIRED`);
          break;
        case "skipped":
          summary.skipped += 1;
          break;
        default: {
          const _exhaustive: never = outcome;
          void _exhaustive;
        }
      }
    } catch (e) {
      summary.failed += 1;
      const message = (e as Error).message || "알 수 없는 오류";
      summary.errors.push({ withdrawalId: row.id, message });
      console.error(`[payout-queue] #${row.id} error:`, message);
    }
  }

  console.log(
    `[payout-queue] 완료 — 처리 ${summary.processed}, 성공 ${summary.approved}, 실패 ${summary.failed}, reconciliation ${summary.reconciliationRequired}, skip ${summary.skipped}`
  );
  return summary;
}
