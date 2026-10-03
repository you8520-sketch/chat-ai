"use client";

import type { PaymentRequest } from "@portone/browser-sdk/v2";
import { resolvePortOneRedirectUrl } from "@/lib/portoneConfig";

export const PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE =
  "테스트 결제가 확인되었습니다. 실제 포인트는 지급되지 않습니다.";

export type PortOneChargePrepareResponse = {
  paymentId: string;
  orderName: string;
  totalAmount: number;
  packageId: string;
  storeId: string;
  channelKey: string;
  payMethod?: "CARD";
};

export async function preparePortOneCheckout(packageId: string): Promise<PortOneChargePrepareResponse> {
  const res = await fetch("/api/payments/portone/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ packageId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "결제 준비에 실패했습니다.");
  return data as PortOneChargePrepareResponse;
}

export type PortOneChargeCompleteResponse = {
  ok: true;
  alreadyPaid?: boolean;
  checkoutKind?: string;
  credited?: boolean;
  points?: number;
  paidPoints?: number;
  freePoints?: number;
};

export async function completePortOneCheckout(
  paymentId: string,
  txId?: string
): Promise<PortOneChargeCompleteResponse> {
  const res = await fetch("/api/payments/portone/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentId, txId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "결제 확인에 실패했습니다.");
  return data as PortOneChargeCompleteResponse;
}

export async function requestPortOneCardPayment(
  prepared: PortOneChargePrepareResponse,
  opts?: { customerEmail?: string; customerName?: string }
): Promise<{ paymentId: string; txId?: string }> {
  const storeId = prepared.storeId?.trim() ?? "";
  const channelKey = prepared.channelKey?.trim() ?? "";
  if (!storeId || !channelKey) {
    throw new Error("PortOne 설정(storeId·channelKey)이 없습니다.");
  }

  const PortOne = await import("@portone/browser-sdk/v2");
  const redirectUrl =
    typeof window !== "undefined" ? resolvePortOneRedirectUrl(window.location.origin) : undefined;

  const request: PaymentRequest = {
    storeId,
    channelKey,
    paymentId: prepared.paymentId,
    orderName: prepared.orderName,
    totalAmount: prepared.totalAmount,
    currency: "KRW",
    payMethod: "CARD",
    redirectUrl,
    customer:
      opts?.customerEmail || opts?.customerName
        ? {
            email: opts.customerEmail,
            fullName: opts.customerName,
          }
        : undefined,
  };

  const response = await PortOne.requestPayment(request);

  if (response == null) {
    return { paymentId: prepared.paymentId };
  }

  if (response.code != null) {
    throw new Error(response.message || response.code || "결제가 취소되었습니다.");
  }

  return {
    paymentId: response.paymentId,
    txId: response.txId,
  };
}

/** prepare → 결제창 → complete (리디렉션 없이 PC 팝업 완료 시) */
export async function runPortOnePointCharge(
  packageId: string,
  opts?: { customerEmail?: string; customerName?: string }
) {
  const prepared = await preparePortOneCheckout(packageId);
  const result = await requestPortOneCardPayment(prepared, opts);
  const completed = await completePortOneCheckout(result.paymentId, result.txId);
  return { prepared, completed };
}
