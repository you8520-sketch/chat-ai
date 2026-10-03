import Link from "next/link";
import { PUBLIC_LEGAL_LINKS } from "@/lib/legalPages";
import { cn } from "@/lib/studioDesign";

/** Contextual legal links for signup and login. Footer still owns the site-wide set. */
export function LegalConsentLinks({ className }: { className?: string }) {
  return (
    <nav
      aria-label="법적 문서"
      className={cn("flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs", className)}
    >
      {PUBLIC_LEGAL_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="min-h-11 text-violet-400 underline-offset-2 hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
