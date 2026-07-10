"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import StudioButton from "@/components/studio/StudioButton";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  icon?: ReactNode;
  message: string;
  href: string;
  cta: string;
  className?: string;
};

export default function StudioEmptyState({ icon, message, href, cta, className }: Props) {
  return (
    <div className={cn(studioSurface.cardDashed, "mt-6 p-10 text-center", className)}>
      {icon ? (
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-zinc-400">
          {icon}
        </div>
      ) : null}
      <p className={cn(studioType.body, "mt-3 text-zinc-400")}>{message}</p>
      <StudioButton href={href} className="mt-5">
        {cta}
      </StudioButton>
    </div>
  );
}

export function StudioBackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={studioSurface.backLink}>
      {children}
    </Link>
  );
}
