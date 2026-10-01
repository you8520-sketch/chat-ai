import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { isPortOneServerVerifyConfigured } from "@/lib/portoneConfig";
import { getPortoneCheckoutByPaymentId } from "@/lib/portoneCheckout";
import { finalizePortoneCheckoutFromProvider } from "@/lib/portonePaidFinalizer";
import {
  ensurePointChargeRefundAttemptsSchema,
  getPointChargeRefundAttemptByPaymentId,
} from "@/lib/pointChargeRefundAttempts";
import { wakePointChargeRefundLookupByPaymentId } from "@/lib/pointChargeRefundExecution";

export const PORTONE_WEBHOOK_PAID = "Transaction.Paid";
export const PORTONE_WEBHOOK_FAILED = "Transaction.Failed";
export const PORTONE_WEBHOOK_CANCEL_PENDING = "Transaction.CancelPending";
export const PORTONE_WEBHOOK_CANCELLED = "Transaction.Cancelled";
export const PORTONE_WEBHOOK_PARTIAL_CANCELLED = "Transaction.PartialCancelled";

const REFUND_WAKE_TYPES = new Set<string>([
  PORTONE_WEBHOOK_CANCEL_PENDING,
  PORTONE_WEBHOOK_CANCELLED,
  PORTONE_WEBHOOK_PARTIAL_CANCELLED,
]);

export type PortoneWebhookHandleResult = {
  httpStatus: number;
  body: { ok: boolean; ignored?: boolean; status?: string; error?: string };
};

type ParsedWebhook = {
  type: string;
  paymentId: string;
};

function parseWebhookBody(bodyText: string): ParsedWebhook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as { type?: unknown; data?: unknown; paymentId?: unknown };
  if (typeof row.type !== "string" || !row.type.trim()) return null;

  let paymentId = "";
  if (row.data && typeof row.data === "object") {
    const data = row.data as { paymentId?: unknown };
    if (typeof data.paymentId === "string") paymentId = data.paymentId.trim();
  }
  if (!paymentId && typeof row.paymentId === "string") {
    paymentId = row.paymentId.trim();
  }
  return { type: row.type.trim(), paymentId };
}

function ignored(status: string): PortoneWebhookHandleResult {
  return { httpStatus: 200, body: { ok: true, ignored: true, status } };
}

/**
 * Webhook is a wake signal. Provider GET is truth. Existing owners mutate.
 */
export async function handlePortoneWebhookEvent(
  bodyText: string,
  db: Database.Database = getDb()
): Promise<PortoneWebhookHandleResult> {
  const parsed = parseWebhookBody(bodyText);
  if (!parsed) return ignored("malformed");

  if (parsed.type === PORTONE_WEBHOOK_FAILED) {
    return ignored("failed_event_no_writer");
  }

  if (
    parsed.type !== PORTONE_WEBHOOK_PAID &&
    !REFUND_WAKE_TYPES.has(parsed.type)
  ) {
    return ignored("unknown_type");
  }

  if (!parsed.paymentId) return ignored("missing_payment_id");

  if (parsed.type === PORTONE_WEBHOOK_PAID) {
    return handlePaidWake(parsed.paymentId, db);
  }
  return handleRefundWake(parsed.paymentId, db);
}

async function handlePaidWake(
  paymentId: string,
  db: Database.Database
): Promise<PortoneWebhookHandleResult> {
  const checkout = getPortoneCheckoutByPaymentId(paymentId, db);
  if (!checkout) return ignored("no_local_checkout");
  if (checkout.status === "paid") {
    return { httpStatus: 200, body: { ok: true, status: "already_paid" } };
  }
  if (!isPortOneServerVerifyConfigured()) {
    return {
      httpStatus: 503,
      body: { ok: false, error: "PORTONE_API_SECRET is not configured", status: "secret_missing" },
    };
  }

  const result = await finalizePortoneCheckoutFromProvider(paymentId, { db });
  switch (result.status) {
    case "already_paid":
    case "paid":
      return { httpStatus: 200, body: { ok: true, status: result.status } };
    case "not_found_local":
      return ignored("no_local_checkout");
    case "not_pending":
    case "not_paid":
    case "amount_missing":
    case "amount_mismatch":
    case "provider_missing":
      return { httpStatus: 200, body: { ok: true, ignored: true, status: result.status } };
    case "provider_error":
      return { httpStatus: 503, body: { ok: false, error: result.error, status: result.status } };
    case "finalize_failed":
      return { httpStatus: 500, body: { ok: false, error: result.error, status: result.status } };
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

async function handleRefundWake(
  paymentId: string,
  db: Database.Database
): Promise<PortoneWebhookHandleResult> {
  ensurePointChargeRefundAttemptsSchema(db);
  const attempt = getPointChargeRefundAttemptByPaymentId(db, paymentId);
  if (!attempt) return ignored("no_local_refund_attempt");

  const result = await wakePointChargeRefundLookupByPaymentId(paymentId, db);
  if (result.status === "skipped") {
    return ignored("refund_wake_skipped");
  }
  return { httpStatus: 200, body: { ok: true, status: result.status } };
}
