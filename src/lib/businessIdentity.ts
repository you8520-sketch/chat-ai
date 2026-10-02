import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Confirmed public service identity for legal/footer disclosure. */
export const SERVICE_PUBLIC_NAME = SITE_DISPLAY_NAME;
export const SERVICE_PUBLIC_DOMAIN = "hav.chat";
export const BUSINESS_REGISTRATION_NUMBER = "159-31-01749";
export const BUSINESS_INDUSTRY = "정보통신업";

export type BusinessFieldVerification = "confirmed" | "unverified";

/**
 * Verification ledger for PortOne review fields.
 * Unverified values must not be invented or published.
 */
export const BUSINESS_IDENTITY_VERIFICATION = {
  serviceName: "confirmed",
  serviceDomain: "confirmed",
  registrationNumber: "confirmed",
  industry: "confirmed",
  tradeName: "unverified",
  representativeName: "unverified",
  businessAddress: "unverified",
  phoneNumber: "unverified",
  mailOrderReportNumber: "unverified",
} as const satisfies Record<string, BusinessFieldVerification>;
