/** Client-safe — mirrors server PORTONE_CHARGE_ENABLED / NEXT_PUBLIC_PAYMENTS_ENABLED */
export function isPaymentsEnabledClient(): boolean {
  if (process.env.NEXT_PUBLIC_PAYMENTS_ENABLED === "0") return false;
  if (process.env.NEXT_PUBLIC_PORTONE_CHARGE_ENABLED === "0") return false;
  return true;
}
