"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/studioDesign";

/**
 * One scrollable row of chips on phones, wrapping rows from `sm` up.
 * The selected chip (`aria-current="true"`) is brought into view on mount so the active filter is never off-screen.
 */
export default function ChipRail({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rail = ref.current;
    const current = rail?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!rail || !current) return;
    rail.scrollLeft = Math.max(0, current.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2);
  }, []);

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cn(
        "relative flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "[mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] sm:flex-wrap sm:overflow-visible sm:[mask-image:none]",
        className,
      )}
    >
      {children}
    </div>
  );
}
