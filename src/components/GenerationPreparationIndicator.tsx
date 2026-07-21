"use client";

import {
  GENERATION_SCENE_BADGE_LABELS,
  generationPreparationSubtitle,
  generationPreparationTitle,
  type GenerationPreparationPhase,
  type GenerationSceneBadge,
} from "@/lib/generationPreparationUi";
import { cn } from "@/lib/studioDesign";

type Props = {
  phase?: GenerationPreparationPhase;
  badges?: readonly GenerationSceneBadge[];
  className?: string;
};

/**
 * Compact pre-first-token loading panel — not a reasoning/CoT disclosure UI.
 */
export default function GenerationPreparationIndicator({
  phase = "preparing",
  badges = [],
  className,
}: Props) {
  const title = generationPreparationTitle(phase);
  const subtitle = generationPreparationSubtitle(phase);
  const safeBadges = badges.slice(0, 3);

  return (
    <div
      className={cn(
        "w-full max-w-full rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3",
        className
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center text-sm text-orange-300/90 motion-safe:animate-pulse"
          aria-hidden
        >
          ✦
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-200">{title}</p>
          {safeBadges.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="장면 초점">
              {safeBadges.map((b) => (
                <li
                  key={b}
                  className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-400"
                >
                  {GENERATION_SCENE_BADGE_LABELS[b]}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
