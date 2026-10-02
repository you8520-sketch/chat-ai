import Link from "next/link";
import { BUSINESS_PUBLIC_LINES } from "@/lib/businessIdentity";
import { PUBLIC_LEGAL_LINKS } from "@/lib/legalPages";
import { SITE_DESCRIPTION, SITE_DISPLAY_NAME } from "@/lib/siteBrand";

/**
 * Compact, readable legal disclosure. Keep one renderer in the root layout
 * and one canonical source of business details in businessIdentity.
 */
export function SiteLegalFooter() {
  return (
    <footer className="site-legal-footer mx-auto w-full max-w-7xl px-4 pb-24 pt-4 text-xs leading-relaxed text-zinc-400 md:pb-6">
      <div className="border-t border-white/[0.07] pt-4 min-[576px]:pl-[200px]">
        <p>
          © {new Date().getFullYear()} {SITE_DISPLAY_NAME} · {SITE_DESCRIPTION}
        </p>
        <ul aria-label="사업자 정보" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
          {BUSINESS_PUBLIC_LINES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <nav aria-label="법적 고지" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          {PUBLIC_LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="underline-offset-2 hover:text-zinc-100 hover:underline">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
