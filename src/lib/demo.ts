/** 개발·데모 환경 여부 (로컬 npm run dev 포함) */
export function isDemoEnv(): boolean {
  if (process.env.DEMO_MODE === "0") return false;
  return process.env.NODE_ENV === "development" || process.env.DEMO_MODE === "1";
}
