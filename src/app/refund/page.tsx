import type { Metadata } from "next";
import { LegalDocument } from "@/components/LegalDocument";
import { PAYMENT_REFUND_PAGE } from "@/lib/legalPages";
import { SITE_DISPLAY_NAME } from "@/lib/siteBrand";
import { publicPageMetadata } from "@/lib/siteSeo";

export const metadata: Metadata = publicPageMetadata({
  title: `${PAYMENT_REFUND_PAGE.title} · ${SITE_DISPLAY_NAME}`,
  description: `${SITE_DISPLAY_NAME} 결제 및 환불 정책`,
  path: "/refund",
});

export default function RefundPolicyPage() {
  return (
    <LegalDocument
      title={PAYMENT_REFUND_PAGE.title}
      intro={PAYMENT_REFUND_PAGE.intro}
      sections={PAYMENT_REFUND_PAGE.sections}
      currentHref={PAYMENT_REFUND_PAGE.href}
    />
  );
}
