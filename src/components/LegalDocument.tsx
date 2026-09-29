import { AppPageShell } from "@/components/AppPageShell";
import type { LegalSection } from "@/lib/legalPages";

export function LegalDocument({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: readonly string[];
  sections: readonly LegalSection[];
}) {
  return (
    <AppPageShell title={title} narrow>
      <article className="space-y-6 text-sm leading-6 text-zinc-300">
        {intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-50">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    </AppPageShell>
  );
}
