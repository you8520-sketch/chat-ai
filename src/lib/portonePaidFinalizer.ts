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
  PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY,
  PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME,
  PORTONE_REVIEWER_KG_TEST_MID,
  PORTONE_REVIEWER_KG_TEST_STORE_ID,
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

type RemoteChannelSnapshot = {
  storeId?: string;
  channelKey?: string;
  channelName?: string;
  pgMerchantId?: string;
  channelType?: string;
};

/** Official PaidPayment always has storeId + channel.type + channel.pgMerchantId. channel.key is optional. */
function officialPaidChannelPresent(remote: RemoteChannelSnapshot): boolean {
  return Boolean(remote.storeId && remote.channelType && remote.pgMerchantId);
}

function remoteLooksLikeReviewerKgTest(remote: RemoteChannelSnapshot): boolean {
  if (remote.storeId !== PORTONE_REVIEWER_KG_TEST_STORE_ID) return false;
  if ((remote.channelType ?? "").toUpperCase() !== "TEST") return false;
  if (remote.pgMerchantId !== PORTONE_REVIEWER_KG_TEST_MID) return false;
  if (remote.channelKey && remote.channelKey !== PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY) return false;
  if (remote.channelName && remote.channelName !== PORTONE_REVIEWER_KG_TEST_CHANNEL_NAME) {
    return false;
  }
  return true;
}

function reviewerKgRemoteMatches(remote: RemoteChannelSnapshot): boolean {
  if (!officialPaidChannelPresent(remote)) return false;
  return remoteLooksLikeReviewerKgTest(remote);
}

function standardChannelIsTrusted(
  checkout: { store_id: string; channel_key: string },
  remote: RemoteChannelSnapshot
): boolean {
  if (!officialPaidChannelPresent(remote)) return false;
  if (remoteLooksLikeReviewerKgTest(remote)) return false;
  if (
    remote.storeId === PORTONE_REVIEWER_KG_TEST_STORE_ID ||
    remote.channelKey === PORTONE_REVIEWER_KG_TEST_CHANNEL_KEY
  ) {
    return false;
  }
  if (checkout.store_id && checkout.store_id !== remote.storeId) return false;
  if (checkout.channel_key && remote.channelKey && checkout.channel_key !== remote.channelKey) {
    return false;
  }
  return true;
}

function checkoutChannelIsTrusted(
  checkout: {
    checkout_kind: PortoneCheckoutKind;
    store_id: string;
    channel_key: string;
  },
  remote: RemoteChannelSnapshot
): boolean {
  if (isReviewerKgTestCheckout(checkout)) {
    return (
      isConfirmedReviewerKgTestChannel({
        storeId: checkout.store_id,
        channelKey: checkout.channel_key,
      }) && reviewerKgRemoteMatches(remote)
    );
  }
  return standardChannelIsTrusted(checkout, remote);
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
