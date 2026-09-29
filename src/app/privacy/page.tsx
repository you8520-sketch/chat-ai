import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { PRIVACY_PAGE } from "@/lib/legalPages";
import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

export const metadata: Metadata = {
  title: `${PRIVACY_PAGE.title} · ${SITE_DISPLAY_NAME}`,
  description: `${SITE_DISPLAY_NAME} 개인정보처리방침`,
};

export default function PrivacyPage() {
  return (
    <LegalDocument title={PRIVACY_PAGE.title} intro={PRIVACY_PAGE.intro} sections={PRIVACY_PAGE.sections} />
  );
}
