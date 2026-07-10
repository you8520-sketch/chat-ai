"use client";

import type { ReactNode } from "react";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export type StudioCardVariant = "default" | "muted" | "dashed" | "accent";

const variantClass: Record<StudioCardVariant, string> = {
  default: studioSurface.card,
  muted: studioSurface.cardMuted,
  dashed: studioSurface.cardDashed,
  accent: studioSurface.sectionAccent,
};

type Props = {
  variant?: StudioCardVariant;
  title?: string;
  description?: string;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
  as?: "section" | "div" | "article";
};

export default function StudioCard({
  variant = "default",
  title,
  description,
  trailing,
  className,
  children,
  as: Tag = "section",
}: Props) {
  return (
    <Tag className={cn(variantClass[variant], "p-4 sm:p-5", className)}>
      {(title || trailing) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className={studioType.sectionTitle}>{title}</h2> : null}
            {description ? (
              <p className={cn(studioType.helper, "mt-1")}>{description}</p>
            ) : null}
          </div>
          {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </div>
      )}
      <div className="space-y-4">{children}</div>
    </Tag>
  );
}
