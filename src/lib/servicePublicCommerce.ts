import { SERVICE_PUBLIC_NAME, SERVICE_PUBLIC_STATUS } from "@/lib/businessIdentity";

/**
 * Public commerce availability shown to users.
 * Independent of env flag names. Change this owner at open; runtime gates stay
 * in portoneConfig.
 */
export const MEMBER_PAID_POINT_CHARGE_PUBLICLY_AVAILABLE = false;

export const SERVICE_PUBLIC_COMMERCE_NOTICE_PARAGRAPHS = [
  `현재 ${SERVICE_PUBLIC_NAME}는 ${SERVICE_PUBLIC_STATUS}이며 일반 회원의 유료 포인트 결제는 제공하지 않습니다. PG·카드사 심사를 위한 지정 심사 계정에서만 테스트 결제가 제공됩니다.`,
] as const;

export const MEMBER_PAID_CHARGE_UNAVAILABLE_MESSAGE =
  "현재 일반 회원의 유료 포인트 결제는 제공하지 않습니다.";
