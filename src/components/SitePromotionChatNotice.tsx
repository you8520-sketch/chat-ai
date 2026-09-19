"use client";

import type { SitePromotionClientView } from "@/lib/sitePromotion";

type Props = {
  promotion: SitePromotionClientView | null;
};

/** Inline chat notice for active verified site promotions — not the home popup notice owner. */
export default function SitePromotionChatNotice({ promotion }: Props) {
  if (!promotion) return null;

  return (
    <div
      className="mb-1 rounded-md border border-violet-400/35 bg-violet-500/10 px-2.5 py-2 text-[11px] leading-snug text-violet-100"
      role="status"
      aria-live="polite"
    >
      <p className="font-semibold text-violet-50">{promotion.title}</p>
      <p className="mt-0.5 text-violet-100/90">{promotion.subtitle}</p>
      <p className="mt-0.5 text-violet-200/75">{promotion.detailLine}</p>
    </div>
  );
}
