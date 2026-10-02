import Link from "next/link";
import { AppPageShell } from "@/components/AppPageShell";
import { LEGAL_DOCUMENT_AS_OF, PUBLIC_LEGAL_LINKS, type LegalSection } from "@/lib/legalPages";

export function LegalDocument({
  title,
  intro,
  sections,
  currentHref,
}: {
  title: string;
  intro: readonly string[];
  sections: readonly LegalSection[];
  currentHref?: (typeof PUBLIC_LEGAL_LINKS)[number]["href"];
}) {
  const related = PUBLIC_LEGAL_LINKS.filter((link) => link.href !== currentHref);

  return (
    <AppPageShell title={title} description={`시행일 ${LEGAL_DOCUMENT_AS_OF}`} narrow>
      <article className="space-y-6 text-sm leading-6 text-zinc-300">
        <p className="text-xs font-medium tabular-nums text-zinc-500">{`시행일 ${LEGAL_DOCUMENT_AS_OF}`}</p>
        <nav
          aria-label="목차"
          className="rounded-xl border border-white/10 bg-[#131626] p-4"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">목차</p>
          <ol className="mt-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="block min-h-11 rounded-lg px-2 py-2 text-sm text-zinc-300 hover:bg-white/[0.04] hover:text-zinc-50"
                >
                  <span className="tabular-nums text-zinc-500">{`제${section.article}조 `}</span>
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {sections.map((section) => (
          <section id={section.id} key={section.id} className="scroll-mt-24 space-y-2">
            <h2 className="text-base font-semibold text-zinc-50">
              <span className="tabular-nums text-zinc-500">{`제${section.article}조 `}</span>
              {section.heading}
            </h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
        {related.length > 0 ? (
          <nav aria-label="관련 문서" className="flex flex-wrap gap-x-4 gap-y-2 border-t border-white/10 pt-4">
            {related.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="min-h-11 text-sm text-violet-300 underline-offset-2 hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </article>
    </AppPageShell>
  );
}
