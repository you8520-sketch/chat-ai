export const PLANS = {
  basic: { label: "베이직", price: 19000, points: 20000, memoryLimit: 5000 },
  pro: { label: "프로", price: 47500, points: 50000, memoryLimit: 10000 },
} as const;
export type PlanId = keyof typeof PLANS;

export const FREE_MEMORY_LIMIT = 2000;

/** 무료 포인트(FREE) 기본 유효 기간 — 충전 보너스·이벤트 보상 포함 (출석 제외) */
export const FREE_POINTS_VALID_YEARS = 1;

/** 유료 포인트(PAID) 기본 유효 기간 */
export const PAID_POINTS_VALID_YEARS = 1;

/** PortOne 결제 취소 지원기간(일) — 포인트 사용기간과 별개 */
export const POINT_CHARGE_CANCEL_DAYS = 7;

/** 클로즈베타 캐릭터 제작 이벤트 — 관리자 승인 후 포인트 지급 */
export const CREATE_MIGRATION_EVENT_REWARD = 3000;

/** 신규 가입 보너스 (FREE 포인트) */
export const SIGNUP_BONUS_POINTS = 2000;

/** 포인트 충전 패키지 — 결제액(원) = 유료(PAID) 포인트 1:1, 보너스는 무료(FREE) 포인트 */
export type PointChargePackageId = "p5000" | "p10000" | "p30000" | "p50000" | "p100000";

export type PointChargePackage = {
  id: PointChargePackageId;
  /** 결제 금액(KRW) — 유료 포인트와 1:1 */
  price: number;
  /** 유료(PAID) 포인트 — price와 동일 */
  paidPoints: number;
  /** 무료(FREE) 보너스 포인트 */
  bonusPoints: number;
  bonusTag: string;
};

export const POINT_CHARGE_PACKAGES: PointChargePackage[] = [
  { id: "p5000", price: 5000, paidPoints: 5000, bonusPoints: 0, bonusTag: "" },
  { id: "p10000", price: 10000, paidPoints: 10000, bonusPoints: 0, bonusTag: "" },
  { id: "p30000", price: 30000, paidPoints: 30000, bonusPoints: 900, bonusTag: "+3% 보너스" },
  { id: "p50000", price: 50000, paidPoints: 50000, bonusPoints: 2500, bonusTag: "+5% 보너스" },
  { id: "p100000", price: 100000, paidPoints: 100000, bonusPoints: 7000, bonusTag: "+7% 보너스" },
];

export const POINT_CHARGE_PACKAGES_BY_ID = Object.fromEntries(
  POINT_CHARGE_PACKAGES.map((p) => [p.id, p])
) as Record<PointChargePackageId, PointChargePackage>;

export function isPointChargePackageId(id: string): id is PointChargePackageId {
  return Object.hasOwn(POINT_CHARGE_PACKAGES_BY_ID, id);
}

export function pointChargePackageTotalPoints(pkg: PointChargePackage): number {
  return pkg.paidPoints + pkg.bonusPoints;
}

export function pointChargePackageBonusPercent(pkg: PointChargePackage): number {
  if (pkg.paidPoints <= 0) return 0;
  return (pkg.bonusPoints / pkg.paidPoints) * 100;
}

export function formatPointChargePackagePublicLine(pkg: PointChargePackage): string {
  const total = pointChargePackageTotalPoints(pkg);
  return `${pkg.price.toLocaleString("ko-KR")}원: 유료 ${pkg.paidPoints.toLocaleString("ko-KR")}P, 보너스 ${pkg.bonusPoints.toLocaleString("ko-KR")}P, 합계 ${total.toLocaleString("ko-KR")}P`;
}
