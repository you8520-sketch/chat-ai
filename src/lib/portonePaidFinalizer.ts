import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  getPortoneCheckoutByPaymentId,
  isReviewerKgTestCheckout,
  markPortoneCheckoutPaid,
  type PortoneCheckoutKind,
} from "@/lib/portoneCheckout";
import { fetchPortOnePayment, isPortOnePaidStatus } from "@/lib/portoneServer";
import {
  isConfirmedReviewerKgTestChannel,
  PORTONE_REVIEWER_KG_TEST_MID,
} from "@/lib/portoneReviewerAccount";

export type PortonePaidFinalizeResult =
  | { ok: true; status: "already_paid" }
  | { ok: true; status: "paid"; alreadyPaid: boolean }
  | { ok: false; status: "not_found_local" }
  | { ok: false; status: "not_pending"; error: string }
  | { ok: false; status: "provider_missing" }
  | { ok: false; status: "not_paid"; providerStatus: string }
  | { ok: false; status: "amount_missing" }
  | { ok: false; status: "amount_mismatch" }
  | { ok: false; status: "channel_mismatch" }
  | { ok: false; status: "provider_error"; error: string }
  | { ok: false; status: "finalize_failed"; error: string };

function reviewerKgRemoteMatches(remote: {
  storeId?: string;
  channelKey?: string;
  pgMerchantId?: string;
  channelType?: string;
}): boolean {
  if (!isConfirmedReviewerKgTestChannel(remote)) return false;
  if (remote.pgMerchantId && remote.pgMerchantId !== PORTONE_REVIEWER_KG_TEST_MID) return false;
  if (remote.channelType && remote.channelType.toUpperCase() !== "TEST") return false;
  return true;
}

function checkoutChannelIsTrusted(checkout: {
  checkout_kind: PortoneCheckoutKind;
  store_id: string;
  channel_key: string;
}, remote: {
  storeId?: string;
  channelKey?: string;
  pgMerchantId?: string;
}): boolean {
  if (isReviewerKgTestCheckout(checkout)) {
    return (
      isConfirmedReviewerKgTestChannel({
        storeId: checkout.store_id,
        channelKey: checkout.channel_key,
      }) && reviewerKgRemoteMatches(remote)
    );
  }
  return !isConfirmedReviewerKgTestChannel({
    storeId: remote.storeId ?? checkout.store_id,
    channelKey: remote.channelKey ?? checkout.channel_key,
  });
}

/**
 * Canonical paid recovery after a local checkout exists.
 * Provider GET is the only payment truth. Credits only through markPortoneCheckoutPaid.
 */
export async function finalizePortoneCheckoutFromProvider(
  paymentId: string,
  options: { fallbackTxId?: string; db?: Database.Database } = {}
): Promise<PortonePaidFinalizeResult> {
  const db = options.db ?? getDb();
  const checkout = getPortoneCheckoutByPaymentId(paymentId, db);
  if (!checkout) return { ok: false, status: "not_found_local" };
  if (checkout.status === "paid") return { ok: true, status: "already_paid" };
  if (checkout.status !== "pending") {
    return { ok: false, status: "not_pending", error: "처리할 수 없는 결제 상태입니다." };
  }

  let remote;
  try {
    remote = await fetchPortOnePayment(paymentId);
  } catch (error) {
    return {
      ok: false,
      status: "provider_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (!remote) return { ok: false, status: "provider_missing" };
  if (!isPortOnePaidStatus(remote.status)) {
    return { ok: false, status: "not_paid", providerStatus: remote.status };
  }
  if (remote.totalAmount == null) return { ok: false, status: "amount_missing" };
  if (remote.totalAmount !== checkout.amount) return { ok: false, status: "amount_mismatch" };
  if (!checkoutChannelIsTrusted(checkout, remote)) {
    return { ok: false, status: "channel_mismatch" };
  }

  const marked = markPortoneCheckoutPaid(paymentId, remote.txId || options.fallbackTxId || "", db);
  if (!marked.ok) {
    return { ok: false, status: "finalize_failed", error: marked.error };
  }
  return { ok: true, status: "paid", alreadyPaid: marked.alreadyPaid };
}
