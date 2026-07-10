"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

const SLIDE_INTERVAL_MS = 5500;

type Slide = {
  id: string;
  badge: string;
  badgeClass: string;
  gradient: string;
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  ctaClass: string;
  hint: string;
};

const SLIDES: Slide[] = [
  {
    id: "closed-beta",
    badge: "CLOSED BETA",
    badgeClass: "text-violet-300/90",
    gradient: "from-violet-950/70 via-[#131626] to-violet-900/40",
    title: "클로즈베타 테스트중",
    description:
      "클로즈베타 참여자에게 무료 포인트를 지급합니다. 신청 후 관리자 승인 시 포인트가 지급됩니다.",
    ctaHref: "/events/beta-free-points",
    ctaLabel: "무료 포인트 신청하기",
    ctaClass: "bg-violet-600 text-white hover:bg-violet-500",
    hint: "신청 → 관리자 검토 → 승인 후 지급",
  },
  {
    id: "create-character",
    badge: "CREATE EVENT",
    badgeClass: "text-emerald-300/80",
    gradient: "from-violet-950/60 via-[#131626] to-emerald-950/35",
    title: `캐릭터 제작 시 ${CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P 증정`,
    description:
      "공개 캐릭터를 제작하고 이벤트에 신청하세요. 관리자 승인 후 무료 포인트가 지급됩니다.",
    ctaHref: "/events/create-migration",
    ctaLabel: "캐릭터 제작 포인트 신청",
    ctaClass: "bg-violet-600 text-white hover:bg-violet-500",
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

  const slide = SLIDES[activeIndex];

  return (
    <div
      className={`mt-2 rounded-xl border border-white/[0.08] bg-gradient-to-r p-3.5 transition-[background] duration-500 sm:rounded-2xl sm:p-5 ${slide.gradient}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-bold uppercase tracking-wider sm:text-xs ${slide.badgeClass}`}>
            {slide.badge}
          </p>
          <h1 className="mt-0.5 text-base font-black leading-snug text-white sm:mt-1 sm:text-xl">
            {slide.title}
          </h1>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400 sm:mt-1.5 sm:line-clamp-none sm:text-sm sm:text-zinc-300">
            {slide.description}
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5 pt-0.5">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`${i + 1}번째 배너`}
              aria-current={i === activeIndex ? "true" : undefined}
              onClick={() => goTo(i)}
              className={`h-1.5 w-1.5 rounded-full transition sm:h-2 sm:w-2 ${
                i === activeIndex ? "bg-violet-300" : "bg-white/30 hover:bg-white/50"
              }`}
            />
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-4 sm:gap-3">
        <Link
          href={slide.ctaHref}
          className={`rounded-xl px-3.5 py-2 text-xs font-bold sm:px-5 sm:py-2.5 sm:text-sm ${slide.ctaClass}`}
        >
          {slide.ctaLabel}
        </Link>
        <p className="hidden text-xs text-zinc-500 sm:block">{slide.hint}</p>
      </div>
    </div>
  );
}
