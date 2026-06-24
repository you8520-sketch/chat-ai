import { isDemoUserEmail } from "@/lib/demo";

function isAdminEmailUser(user: { email: string } & { is_admin?: number }): boolean {
  if (user.is_admin === 1) return true;
  const allow = process.env.ADMIN_EMAILS?.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allow?.length) return false;
  return allow.includes(user.email.toLowerCase());
}

/** 관리자·로컬 데모유저만 영수증 상세(thinking·API raw·strip 등) 노출 */
export function canShowFullBillingReceipt(
  user: { email: string } & { is_admin?: number }
): boolean {
  if (isDemoUserEmail(user.email)) return true;
  return isAdminEmailUser(user);
}
