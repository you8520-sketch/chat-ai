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

/** true when store + channel are set — 결제창 호출 가능 */
export function isPortOneBrowserConfigured(): boolean {
  return PORTONE_STORE_ID.length > 0 && PORTONE_CHANNEL_KEY.length > 0;
}

export function isPortOneServerVerifyConfigured(): boolean {
  return PORTONE_API_SECRET.length > 0;
}

/** Points page — PortOne 우선, 미설정 시 모의 결제 */
export function isPortOneChargeEnabled(): boolean {
  if (process.env.PORTONE_CHARGE_ENABLED === "0") return false;
  if (process.env.PORTONE_CHARGE_ENABLED === "1") return isPortOneBrowserConfigured();
  return isPortOneBrowserConfigured();
}

export function resolvePortOneRedirectUrl(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/payments/portone/callback`;
}
