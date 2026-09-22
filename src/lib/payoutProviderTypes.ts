/** Provider transfer outcome — UNKNOWN is not FAILURE. */
export type PayoutProviderResultClass = "success" | "failed" | "unknown" | "pending";

export type PayoutProviderSuccess = {
  resultClass: "success";
  providerRef: string;
  deduplicated: boolean;
};

export type PayoutProviderFailure = {
  resultClass: "failed";
  code: string;
  message: string;
  deduplicated: boolean;
};

export type PayoutProviderUnknown = {
  resultClass: "unknown";
  code: string;
  message: string;
};

export type PayoutProviderPending = {
  resultClass: "pending";
  code: string;
  message: string;
};

export type PayoutProviderTransferResult =
  | PayoutProviderSuccess
  | PayoutProviderFailure
  | PayoutProviderUnknown
  | PayoutProviderPending;

export type PayoutProviderLookupResult =
  | { status: "success"; providerRef: string }
  | { status: "failed"; code: string; message: string }
  | { status: "unknown" }
  | { status: "pending" }
  | { status: "not_found" };

export type PayoutProviderTransferInput = {
  bankCode: string;
  accountNo: string;
  amount: number;
  /** Stable per-withdrawal identity — must not change across retries. */
  idempotencyKey: string;
  withdrawalId: number;
};

export interface PayoutProviderPort {
  transfer(input: PayoutProviderTransferInput): Promise<PayoutProviderTransferResult>;
  lookup(idempotencyKey: string): Promise<PayoutProviderLookupResult>;
}
