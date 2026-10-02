import Link from "next/link";
import { BUSINESS_PUBLIC_LINES, BUSINESS_TRADE_NAME, SERVICE_PUBLIC_ORIGIN } from "@/lib/businessIdentity";
import { PUBLIC_LEGAL_LINKS } from "@/lib/legalPages";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/** Canonical public legal links and business identity. Render this once from the root layout. */
export function SiteLegalFooter() {
  return (
    <footer className="site-legal-footer mx-auto w-full max-w-7xl px-4 pb-28 pt-8 text-xs text-zinc-500 md:pb-8">
      <p>
        사이트명 {SITE_DISPLAY_NAME}({SERVICE_PUBLIC_ORIGIN})는 {SITE_DESCRIPTION}입니다. 법적 상호는{" "}
        {BUSINESS_TRADE_NAME}입니다.
      </p>
      <ul className="mt-2 space-y-0.5">
        {BUSINESS_PUBLIC_LINES.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <nav aria-label="법적 고지" className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {PUBLIC_LEGAL_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="underline-offset-2 hover:text-zinc-200 hover:underline">
            {link.label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
