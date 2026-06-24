function envFlag(name: string): "true" | "false" | "unset" {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return "unset";
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return "true";
  if (v === "0" || v === "false" || v === "no") return "false";
  return "unset";
}

function isPaymentsDisabledForBeta(): boolean {
  return (
    envFlag("PORTONE_CHARGE_ENABLED") === "false" ||
    envFlag("NEXT_PUBLIC_PAYMENTS_ENABLED") === "false" ||
    envFlag("NEXT_PUBLIC_PORTONE_CHARGE_ENABLED") === "false"
  );
}

/** 클로즈베타 등 — 성인인증 요구 생략 (테스트 참여자는 성인으로 가정) */
export function isAdultVerificationSkipped(): boolean {
  const skip = envFlag("SKIP_ADULT_VERIFICATION");
  if (skip === "true") return true;
  if (skip === "false") return false;
  return isPaymentsDisabledForBeta();
}

export function effectiveIsAdult(isAdult: number | boolean): boolean {
  if (isAdultVerificationSkipped()) return true;
  return !!isAdult;
}
