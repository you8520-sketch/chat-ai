import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { TERMS_PAGE } from "@/lib/legalPages";
import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";

export const metadata: Metadata = {
  title: `${TERMS_PAGE.title} · ${SITE_DISPLAY_NAME}`,
  description: `${SITE_DISPLAY_NAME} 이용약관`,
};

export default function TermsPage() {
  return <LegalDocument title={TERMS_PAGE.title} intro={TERMS_PAGE.intro} sections={TERMS_PAGE.sections} />;
}