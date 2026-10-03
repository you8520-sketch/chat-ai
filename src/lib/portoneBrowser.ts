"use client";

import type { PaymentRequest } from "@portone/browser-sdk/v2";
import { resolvePortOneRedirectUrl } from "@/lib/portoneConfig";

export const PORTONE_REVIEWER_TEST_CONFIRMED_MESSAGE =
  "테스트 결제가 확인되었습니다. 실제 포인트는 지급되지 않습니다.";

/**
 * Official PortOne KG Inicis V2 sample customer.
 * Reviewer checkout only — not collected from members.
 * https://developers.portone.io/opi/ko/integration/pg/v2/inicis-v2
 */
export const PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER = {
  fullName: "포트원",
  phoneNumber: "010-0000-1234",
  email: "test@portone.io",
} as const;

export const PORTONE_CHARGE_IN_FLIGHT_MESSAGE = "결제 요청이 이미 진행 중입니다.";

export type PortOneChargePrepareResponse = {
  paymentId: string;
  orderName: string;
  totalAmount: number;
  packageId: string;
  storeId: string;
  channelKey: string;
  payMethod?: "CARD";
};

export type PortOneCheckoutCustomerInput = {
  customerEmail?: string;
  customerName?: string;
  reviewerKgTest?: boolean;
};

export type PortOneSdkPaymentResponse = {
  code?: string;
  message?: string;
  paymentId?: string;
  txId?: string;
};

export type PortOneChargeAdapters = {
  prepare?: (packageId: string) => Promise<PortOneChargePrepareResponse>;
  requestPayment?: (request: PaymentRequest) => Promise<PortOneSdkPaymentResponse | null | undefined>;
  complete?: (paymentId: string, txId?: string) => Promise<PortOneChargeCompleteResponse>;
};

let chargeInFlight = false;

export function isPortOneChargeInFlight(): boolean {
  return chargeInFlight;
}

export function resetPortOneChargeInFlightForTests(): void {
  chargeInFlight = false;
}

export function isPortOneCheckoutSafeEmail(email: string | undefined): boolean {
  const value = email?.trim() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value)) return false;
  return !/\.(internal|invalid|local|test)$/i.test(value);
}

export function buildPortOneCardPaymentRequest(
  prepared: PortOneChargePrepareResponse,
  opts?: PortOneCheckoutCustomerInput & { redirectUrl?: string }
): PaymentRequest {
  const storeId = prepared.storeId?.trim() ?? "";
  const channelKey = prepared.channelKey?.trim() ?? "";
  if (!storeId || !channelKey) {
    throw new Error("PortOne 설정(storeId·channelKey)이 없습니다.");
  }

  return {
    storeId,
    channelKey,
    paymentId: prepared.paymentId,
    orderName: prepared.orderName,
    totalAmount: prepared.totalAmount,
    currency: "KRW",
    payMethod: prepared.payMethod ?? "CARD",
    redirectUrl: opts?.redirectUrl,
    customer: resolvePortOneCheckoutCustomer(opts),
  };
}

export function resolvePortOneCheckoutCustomer(
  opts?: PortOneCheckoutCustomerInput
): PaymentRequest["customer"] {
  if (opts?.reviewerKgTest) {
    return {
      fullName: PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.fullName,
      phoneNumber: PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.phoneNumber,
      email: PORTONE_KG_INICIS_OFFICIAL_TEST_CUSTOMER.email,
    };
  }

  const email = opts?.customerEmail?.trim() || undefined;
  const fullName = opts?.customerName?.trim() || undefined;
  if (!email && !fullName) return undefined;
  return {
    ...(isPortOneCheckoutSafeEmail(email) ? { email } : {}),
    ...(fullName ? { fullName } : {}),
  };
}

export function describePortOneCheckoutFailure(response: PortOneSdkPaymentResponse): string {
  const code = response.code?.trim();
  const message = response.message?.trim();
  if (code && message) return `${message} (${code})`;
  return message || code || "결제가 취소되었습니다.";
}

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
  opts?: PortOneCheckoutCustomerInput,
  adapters?: Pick<PortOneChargeAdapters, "requestPayment">
): Promise<{ paymentId: string; txId?: string } | null> {
  const redirectUrl =
    typeof window !== "undefined" ? resolvePortOneRedirectUrl(window.location.origin) : undefined;
  const request = buildPortOneCardPaymentRequest(prepared, { ...opts, redirectUrl });
  const requestPayment =
    adapters?.requestPayment ??
    (await import("@portone/browser-sdk/v2")).requestPayment;
  const response = await requestPayment(request);

  if (response == null) {
    return null;
  }

  if (response.code != null) {
    throw new Error(describePortOneCheckoutFailure(response));
  }

  return {
    paymentId: response.paymentId || prepared.paymentId,
    txId: response.txId,
  };
}

/** prepare → 결제창 → complete (리디렉션 없이 PC 팝업 완료 시) */
export async function runPortOnePointCharge(
  packageId: string,
  opts?: PortOneCheckoutCustomerInput,
  adapters?: PortOneChargeAdapters
) {
  if (chargeInFlight) {
    throw new Error(PORTONE_CHARGE_IN_FLIGHT_MESSAGE);
  }
  chargeInFlight = true;
  try {
    const prepare = adapters?.prepare ?? preparePortOneCheckout;
    const complete = adapters?.complete ?? completePortOneCheckout;
    const prepared = await prepare(packageId);
    const result = await requestPortOneCardPayment(prepared, opts, adapters);
    if (result == null) {
      return { prepared, completed: null as PortOneChargeCompleteResponse | null };
    }
    const completed = await complete(result.paymentId, result.txId);
    return { prepared, completed };
  } finally {
    chargeInFlight = false;
  }
}
