import type { ReactNode } from "react";
import { cn, studioType } from "@/lib/studioDesign";

/** Shared page chrome for non-studio routes — same language as Studio. */
export function AppPageShell({
  title,
  description,
  children,
  className,
  narrow,
  actions,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  narrow?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className={cn(narrow ? "mx-auto max-w-2xl" : "w-full", "pb-8", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={studioType.heading}>{title}</h1>
          {description ? (
            <div className={cn(studioType.helper, "mt-2")}>{description}</div>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function AppSectionCard({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-white/10 bg-[#131626] p-4 sm:p-5",
        className,
      )}
    >
      {title ? (
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
