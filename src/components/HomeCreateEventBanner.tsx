"use client";

import { useCallback, useEffect, useState } from "react";

import StudioButton from "@/components/studio/StudioButton";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

const SLIDE_INTERVAL_MS = 5500;

type Slide = {
  id: string;
  badge: string;
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  hint: string;
};

const SLIDES: Slide[] = [
  {
    id: "closed-beta",
    badge: "CLOSED BETA",
    title: "클로즈베타 테스트중",
    description:
      "클로즈베타 참여자에게 무료 포인트를 지급합니다. 신청 후 관리자 승인 시 포인트가 지급됩니다.",
    ctaHref: "/events/beta-free-points",
    ctaLabel: "무료 포인트 신청하기",
    hint: "신청 → 관리자 검토 → 승인 후 지급",
  },
  {
    id: "create-character",
    badge: "CREATE EVENT",
    title: `캐릭터 제작 시 ${CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P 증정`,
    description:
      "공개 캐릭터를 제작하고 이벤트에 신청하세요. 관리자 승인 후 무료 포인트가 지급됩니다.",
    ctaHref: "/events/create-migration",
    ctaLabel: "캐릭터 제작 포인트 신청",
    hint: "캐릭터 제작 → 공개 저장 → 신청",
  },
];

export default function HomeCreateEventBanner() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const goTo = useCallback((index: number) => {
    setActiveIndex(index % SLIDES.length);
  }, []);

  const next = useCallback(() => {
    setActiveIndex((i) => (i + 1) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(next, SLIDE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused, next]);

  const slide = SLIDES[activeIndex]!;

  return (
    <div
      className={cn(studioSurface.banner, "mt-2")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {slide.badge}
          </p>
          <h1 className={cn(studioType.heading, "mt-1 text-lg sm:text-xl")}>{slide.title}</h1>
          <p className={cn(studioType.helper, "mt-2 line-clamp-2 sm:line-clamp-none")}>
            {slide.description}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5 pt-1">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`${i + 1}번째 배너`}
              aria-current={i === activeIndex ? "true" : undefined}
              onClick={() => goTo(i)}
              className={cn(
                "h-2 w-2 rounded-full transition",
                i === activeIndex ? "bg-violet-400" : "bg-white/25 hover:bg-white/45",
              )}
            />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StudioButton href={slide.ctaHref} size="sm">
          {slide.ctaLabel}
        </StudioButton>
        <p className={cn(studioType.caption, "hidden sm:block")}>{slide.hint}</p>
      </div>
    </div>
  );
}
