import { PORTONE_API_BASE, PORTONE_API_SECRET } from "@/lib/portoneConfig";

export type PortoneCancellationSnapshot = {
  status: string;
  id: string;
  pgCancellationId?: string;
  totalAmount?: number;
};

export type PortonePaymentSnapshot = {
  status: string;
  paymentId: string;
  txId?: string;
  totalAmount?: number;
  cancellations: PortoneCancellationSnapshot[];
};

function parseCancellation(input: unknown): PortoneCancellationSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const row = input as {
    status?: string;
    id?: string;
    pgCancellationId?: string;
    amount?: number | { total?: number };
    totalAmount?: number;
  };
  const amount =
    typeof row.amount === "number"
      ? row.amount
      : row.amount?.total ?? row.totalAmount;
  return {
    status: row.status ?? "",
    id: row.id ?? "",
    pgCancellationId: row.pgCancellationId || undefined,
    totalAmount: amount,
  };
}

/** PortOne V2 REST — GET /payments/{paymentId} */
export async function fetchPortOnePayment(paymentId: string): Promise<PortonePaymentSnapshot | null> {
  if (!PORTONE_API_SECRET) return null;

  const res = await fetch(`${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `PortOne ${PORTONE_API_SECRET}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PortOne API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    status?: string;
    id?: string;
    paymentId?: string;
    transactionId?: string;
    txId?: string;
    amount?: { total?: number };
    totalAmount?: number;
    cancellations?: unknown[];
  };

  const status = data.status ?? "";
  const txId = data.transactionId ?? data.txId ?? "";
  const cancellations = Array.isArray(data.cancellations)
    ? data.cancellations.map(parseCancellation).filter((v): v is PortoneCancellationSnapshot => !!v)
    : [];

  return {
    status,
    paymentId: data.paymentId ?? data.id ?? paymentId,
    txId: txId || undefined,
    totalAmount: data.amount?.total ?? data.totalAmount,
    cancellations,
  };
}

export function isPortOnePaidStatus(status: string): boolean {
  return status === "PAID" || status === "PaidPayment";
}

export function isPortOneCancelledStatus(status: string): boolean {
  return status === "CANCELLED" || status === "CancelledPayment";
}

/** PortOne V2 REST — POST /payments/{paymentId}/cancel */
export async function cancelPortOnePayment(
  paymentId: string,
  cancelAmount?: number,
  currentCancellableAmount?: number
): Promise<PortoneCancellationSnapshot> {
  if (!PORTONE_API_SECRET) {
    throw new Error("PORTONE_API_SECRET_MISSING");
  }

  const body: {
    reason: string;
    amount?: number;
    currentCancellableAmount?: number;
  } = { reason: "결제 취소 (7일 이내 미사용)" };
  if (cancelAmount != null && cancelAmount > 0) body.amount = cancelAmount;
  if (currentCancellableAmount != null && currentCancellableAmount > 0) {
    body.currentCancellableAmount = currentCancellableAmount;
  }

  const res = await fetch(
    `${PORTONE_API_BASE}/payments/${encodeURIComponent(paymentId)}/cancel`,
    {
      method: "POST",
      headers: {
        Authorization: `PortOne ${PORTONE_API_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PortOne cancel ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { cancellation?: unknown };
  const cancellation = parseCancellation(data.cancellation);
  if (!cancellation) {
    throw new Error("PORTONE_CANCEL_RESPONSE_MISSING_CANCELLATION");
  }
  return cancellation;
}
