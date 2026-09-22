export type PointChargeRefundCancelResult =
  | { resultClass: "success"; cancellationId: string; providerStatus: string }
  | { resultClass: "pending"; cancellationId: string; providerStatus: string }
  | { resultClass: "failed"; cancellationId?: string; providerStatus: string; code: string; message: string }
  | { resultClass: "unknown"; code: string; message: string };

export type PointChargeRefundLookupResult =
  | { status: "success"; cancellationId?: string; providerStatus: string }
  | { status: "pending"; cancellationId?: string; providerStatus: string }
  | { status: "failed"; cancellationId?: string; providerStatus: string; code: string; message: string }
  | { status: "unknown" }
  | { status: "not_found" };

export type PointChargeRefundCancelInput = {
  paymentId: string;
  amount: number;
  currentCancellableAmount: number;
};

export interface PointChargeRefundProviderPort {
  cancel(input: PointChargeRefundCancelInput): Promise<PointChargeRefundCancelResult>;
  lookup(paymentId: string, cancellationId?: string): Promise<PointChargeRefundLookupResult>;
}
