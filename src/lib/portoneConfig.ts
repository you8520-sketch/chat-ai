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

/** 클로즈베타 등 — `PORTONE_CHARGE_ENABLED=0`이면 충전·결제 UI·API 전면 비활성 */
export function isPaymentsEnabled(): boolean {
  return process.env.PORTONE_CHARGE_ENABLED !== "0";
}

export const PAYMENTS_DISABLED_MESSAGE =
  "클로즈베타 기간에는 포인트 구매가 제공되지 않습니다. 메인 화면의 무료 포인트 신청을 이용해 주세요.";

/** Points page — PortOne 결제창 (isPaymentsEnabled && 키 설정 시) */
export function isPortOneChargeEnabled(): boolean {
  if (!isPaymentsEnabled()) return false;
  if (process.env.PORTONE_CHARGE_ENABLED === "1") return isPortOneBrowserConfigured();
  return isPortOneBrowserConfigured();
}

export function resolvePortOneRedirectUrl(origin: string): string {
  const base = origin.replace(/\/$/, "");
  return `${base}/payments/portone/callback`;
}
