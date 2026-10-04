import { MEMBER_PAID_CHARGE_UNAVAILABLE_MESSAGE } from "@/lib/servicePublicCommerce";

/** PortOne V2 — browser SDK (public) + server verification */

export const PORTONE_STORE_ID =
  process.env.NEXT_PUBLIC_PORTONE_STORE_ID?.trim() ||
  process.env.PORTONE_STORE_ID?.trim() ||
  "";

export const PORTONE_CHANNEL_KEY =
  process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY?.trim() ||
  process.env.PORTONE_CHANNEL_KEY?.trim() ||
  "";

/** V2 API secret — server only (결제 조회·웹훅 검증) */
export const PORTONE_API_SECRET = process.env.PORTONE_API_SECRET?.trim() || "";

export const PORTONE_API_BASE = (
  process.env.PORTONE_API_BASE?.trim() || "https://api.portone.io"
).replace(/\/$/, "");

export function getPortOneBrowserIdentifiers(): { storeId: string; channelKey: string } {
  const storeId =
    process.env.NEXT_PUBLIC_PORTONE_STORE_ID?.trim() ||
    process.env.PORTONE_STORE_ID?.trim() ||
    PORTONE_STORE_ID;
  const channelKey =
    process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY?.trim() ||
    process.env.PORTONE_CHANNEL_KEY?.trim() ||
    PORTONE_CHANNEL_KEY;
  return { storeId, channelKey };
}

/** true when store + channel are set — 결제창 호출 가능 */
export function isPortOneBrowserConfigured(): boolean {
  const { storeId, channelKey } = getPortOneBrowserIdentifiers();
  return storeId.length > 0 && channelKey.length > 0;
}

export function isPortOneServerVerifyConfigured(): boolean {
  return (process.env.PORTONE_API_SECRET?.trim() || PORTONE_API_SECRET).length > 0;
}

function envFlagOn(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true";
}

/** Explicit allow only. Unset, blank, or typo keep ordinary-member charge closed. */
export function isPaymentsEnabled(): boolean {
  return envFlagOn(process.env.PORTONE_CHARGE_ENABLED);
}

export const PAYMENTS_DISABLED_MESSAGE = MEMBER_PAID_CHARGE_UNAVAILABLE_MESSAGE;

/** Points page — PortOne 결제창 (isPaymentsEnabled && 키 설정 시) */
export function isPortOneChargeEnabled(): boolean {
  if (!isPaymentsEnabled()) return false;
  if (!isPortOneBrowserConfigured()) return false;
  if (!isPortOneServerVerifyConfigured()) return false;
  return true;
}

export function resolvePortOneRedirectUrl(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/payments/portone/callback`;
}
