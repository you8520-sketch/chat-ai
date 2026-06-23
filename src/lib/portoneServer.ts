import { PORTONE_API_BASE, PORTONE_API_SECRET } from "@/lib/portoneConfig";

export type PortonePaymentSnapshot = {
  status: string;
  paymentId: string;
  txId?: string;
  totalAmount?: number;
};

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
  };

  const status = data.status ?? "";
  const txId = data.transactionId ?? data.txId ?? "";

  return {
    status,
    paymentId: data.paymentId ?? data.id ?? paymentId,
    txId: txId || undefined,
    totalAmount: data.amount?.total ?? data.totalAmount,
  };
}

export function isPortOnePaidStatus(status: string): boolean {
  return status === "PAID" || status === "PaidPayment";
}

/** PortOne V2 REST — POST /payments/{paymentId}/cancel */
export async function cancelPortOnePayment(
  paymentId: string,
  cancelAmount?: number
): Promise<void> {
  if (!PORTONE_API_SECRET) return;

  const body: { reason: string; amount?: number } = { reason: "결제 취소 (7일 이내 미사용)" };
  if (cancelAmount != null && cancelAmount > 0) body.amount = cancelAmount;

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
}
