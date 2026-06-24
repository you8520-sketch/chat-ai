/** 클로즈베타 등 — 성인인증 요구 생략 (테스트 참여자는 성인으로 가정) */
export function isAdultVerificationSkipped(): boolean {
  const explicit = process.env.SKIP_ADULT_VERIFICATION?.trim().toLowerCase();
  if (explicit === "1" || explicit === "true" || explicit === "yes") return true;
  if (explicit === "0" || explicit === "false" || explicit === "no") return false;
  // 결제 비활성 클로즈베타와 동일 신호
  if (process.env.PORTONE_CHARGE_ENABLED === "0") return true;
  return false;
}

export function effectiveIsAdult(isAdult: number | boolean): boolean {
  if (isAdultVerificationSkipped()) return true;
  return !!isAdult;
}
