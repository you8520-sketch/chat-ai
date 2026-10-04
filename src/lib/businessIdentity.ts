import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Site brand. Distinct from the legal trade name. */
export const SERVICE_PUBLIC_NAME = SITE_DISPLAY_NAME;
export const SERVICE_PUBLIC_DOMAIN = "hav.chat";
export const SERVICE_PUBLIC_ORIGIN = "https://hav.chat";
export const SERVICE_PUBLIC_STATUS = "개업 준비중";

/** Source of the legal-entity fields below. */
export const BUSINESS_IDENTITY_SOURCE = "submitted_nts_certificate" as const;

export const BUSINESS_TRADE_NAME = "노벨 챗";
export const BUSINESS_REGISTRATION_NUMBER = "519-31-01749";
export const BUSINESS_REPRESENTATIVE_NAME = "조영지";
export const BUSINESS_ADDRESS = "인천광역시 검단구 당곡로4번길 15, 301호(원당동)";
/** 업태 */
export const BUSINESS_INDUSTRY = "정보통신업";
/** 종목 */
export const BUSINESS_ITEM = "응용 소프트웨어 개발 및 공급업";
export const BUSINESS_TAX_TYPE = "일반과세자";
export const BUSINESS_OPERATING_STATUS = "휴업";

/** Official business/contact email supplied by the operator; inbound delivery to verify separately. */
export const BUSINESS_CUSTOMER_SERVICE_EMAIL = "admin@hav.chat";
export const BUSINESS_CUSTOMER_SERVICE_PHONE = "070-8080-5884";
export const BUSINESS_MAIL_ORDER_REPORT_NUMBER = null;

export type BusinessFieldVerification = "confirmed" | "unverified";

/**
 * Verification ledger for PortOne review fields.
 * Unverified values must not be invented or published.
 */
export const BUSINESS_IDENTITY_VERIFICATION = {
  serviceName: "confirmed",
  serviceDomain: "confirmed",
  tradeName: "confirmed",
  registrationNumber: "confirmed",
  representativeName: "confirmed",
  businessAddress: "confirmed",
  industry: "confirmed",
  businessItem: "confirmed",
  taxType: "confirmed",
  operatingStatus: "confirmed",
  phoneNumber: "confirmed",
  customerServiceEmail: "confirmed",
  mailOrderReportNumber: "unverified",
} as const satisfies Record<string, BusinessFieldVerification>;

/** Canonical public lines. Footer renders these in site chrome; legal pages quote the same lines. */
export const BUSINESS_PUBLIC_LINES = [
  `사이트명 ${SERVICE_PUBLIC_NAME}`,
  `도메인 ${SERVICE_PUBLIC_ORIGIN}`,
  `상호 ${BUSINESS_TRADE_NAME}`,
  `대표자 ${BUSINESS_REPRESENTATIVE_NAME}`,
  `사업자등록번호 ${BUSINESS_REGISTRATION_NUMBER}`,
  `업태 ${BUSINESS_INDUSTRY}`,
  `종목 ${BUSINESS_ITEM}`,
  `과세유형 ${BUSINESS_TAX_TYPE}`,
  `사업장 ${BUSINESS_ADDRESS}`,
  `서비스 상태 ${SERVICE_PUBLIC_STATUS}`,
  `고객센터 전화 ${BUSINESS_CUSTOMER_SERVICE_PHONE}`,
  `고객센터 이메일 ${BUSINESS_CUSTOMER_SERVICE_EMAIL}`,
] as const;
