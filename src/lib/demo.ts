/** 개발·데모 환경 여부 (로컬 npm run dev 포함). production(Railway 등)에서는 항상 false */
export function isDemoEnv(): boolean {
  if (process.env.DEMO_MODE === "0") return false;
  if (process.env.NODE_ENV === "production") return false;
  return process.env.NODE_ENV === "development" || process.env.DEMO_MODE === "1";
}

/** 로컬 데모 로그인 계정 — 영수증 전체 노출 대상 */
export const DEMO_USER_EMAIL = "demo@playai.local";

export function isDemoUserEmail(email: string): boolean {
  return email.trim().toLowerCase() === DEMO_USER_EMAIL.toLowerCase();
}
