import {
  cancelPortOnePayment,
  fetchPortOnePayment,
  isPortOneCancelledStatus,
} from "@/lib/portoneServer";
import type {
  PointChargeRefundCancelInput,
  PointChargeRefundLookupResult,
  PointChargeRefundProviderPort,
} from "@/lib/pointChargeRefundProviderTypes";

let refundProviderOverride: PointChargeRefundProviderPort | null = null;

export function setPointChargeRefundProviderForTests(
  provider: PointChargeRefundProviderPort | null
): void {
  refundProviderOverride = provider;
}

function mapCancellationStatus(
  status: string,
  cancellationId?: string
): PointChargeRefundLookupResult {
  if (status === "SUCCEEDED") {
    return { status: "success", cancellationId, providerStatus: status };
  }
  if (status === "REQUESTED") {
    return { status: "pending", cancellationId, providerStatus: status };
  }
  if (status === "FAILED") {
    return {
      status: "failed",
      cancellationId,
      providerStatus: status,
      code: "PORTONE_CANCEL_FAILED",
      message: "PortOne이 결제 취소 실패를 확정했습니다.",
    };
  }
  return { status: "unknown" };
}

const portOneRefundProvider: PointChargeRefundProviderPort = {
  async cancel(input: PointChargeRefundCancelInput) {
    try {
      const cancellation = await cancelPortOnePayment(
        input.paymentId,
        input.amount,
        input.currentCancellableAmount
      );
      if (cancellation.status === "SUCCEEDED") {
        return {
          resultClass: "success" as const,
          cancellationId: cancellation.id,
          providerStatus: cancellation.status,
        };
      }
      if (cancellation.status === "REQUESTED") {
        return {
          resultClass: "pending" as const,
          cancellationId: cancellation.id,
          providerStatus: cancellation.status,
        };
      }
      if (cancellation.status === "FAILED") {
        return {
          resultClass: "failed" as const,
          cancellationId: cancellation.id || undefined,
          providerStatus: cancellation.status,
          code: "PORTONE_CANCEL_FAILED",
          message: "PortOne이 결제 취소 실패를 확정했습니다.",
        };
      }
      return {
        resultClass: "unknown" as const,
        code: "PORTONE_CANCEL_UNKNOWN_STATUS",
        message: `알 수 없는 PortOne 취소 상태: ${cancellation.status || "EMPTY"}`,
      };
    } catch (error) {
      return {
        resultClass: "unknown" as const,
        code: "PORTONE_CANCEL_REQUEST_ERROR",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },

  async lookup(paymentId: string, cancellationId?: string) {
    try {
      const payment = await fetchPortOnePayment(paymentId);
      if (!payment) return { status: "not_found" as const };

      if (isPortOneCancelledStatus(payment.status)) {
        return {
          status: "success" as const,
          cancellationId,
          providerStatus: payment.status,
        };
      }

      if (cancellationId) {
        const exact = payment.cancellations.find((item) => item.id === cancellationId);
        if (exact) return mapCancellationStatus(exact.status, exact.id);
      }

      const pending = payment.cancellations.find((item) => item.status === "REQUESTED");
      if (pending) {
        return {
          status: "pending" as const,
          cancellationId: pending.id,
          providerStatus: pending.status,
        };
      }

      return { status: "unknown" as const };
    } catch {
      return { status: "unknown" as const };
    }
  },
};

export function getPointChargeRefundProviderPort(): PointChargeRefundProviderPort {
  return refundProviderOverride ?? portOneRefundProvider;
}
