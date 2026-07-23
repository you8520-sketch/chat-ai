"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import StudioButton from "@/components/studio/StudioButton";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";
import { cn } from "@/lib/studioDesign";

const SLIDE_INTERVAL_MS = 5500;

type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
  hint: string;
  accent: string;
};

const SLIDES: Slide[] = [
  {
    id: "closed-beta",
    eyebrow: "EARLY ACCESS · 새로운 이야기의 시작",
    title: "당신의 선택으로 완성되는 세계",
    description:
      "캐릭터와 관계를 쌓고, 여러 인물이 살아 움직이는 시뮬레이션까지. 지금 클로즈베타에 참여해 이야기를 시작하세요.",
    ctaHref: "/events/beta-free-points",
    ctaLabel: "무료 포인트 받기",
    hint: "클로즈베타 참여 혜택",
    accent: "from-violet-500/35 via-fuchsia-500/10 to-transparent",
  },
  {
    id: "create-character",
    eyebrow: "CREATOR EVENT · 나만의 세계를 공개하세요",
    title: `캐릭터를 만들면 ${CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P`,
    description:
      "한 명의 캐릭터부터 다인 시뮬레이션까지 자유롭게 제작하고 공개해 보세요. 승인된 작품에는 이벤트 포인트를 드립니다.",
    ctaHref: "/events/create-migration",
    ctaLabel: "제작 이벤트 참여",
    hint: "공개 저장 후 신청",
    accent: "from-cyan-400/30 via-violet-500/10 to-transparent",
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
    <section
      className="home-hero group relative mt-1 min-h-[22rem] overflow-hidden rounded-[1.4rem] border border-white/10 bg-[#0a0d16] shadow-2xl shadow-black/35 sm:min-h-[24rem]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-90 transition duration-700",
          slide.accent,
        )}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,#080a11_0%,rgba(8,10,17,.96)_42%,rgba(8,10,17,.28)_72%,rgba(8,10,17,.72)_100%)]" />
      <div className="home-hero-grid pointer-events-none absolute inset-0 opacity-30" />

      <div className="pointer-events-none absolute -right-16 -top-24 h-[28rem] w-[28rem] rounded-full border border-violet-300/20 transition duration-700 group-hover:scale-105 sm:right-[-2rem]">
        <div className="absolute inset-[12%] rounded-full border border-white/10" />
        <div className="absolute inset-[25%] rounded-full border border-violet-300/25 bg-violet-500/5 shadow-[0_0_90px_rgba(124,58,237,.28)]" />
      </div>
      <div className="home-hero-orb pointer-events-none absolute right-[7%] top-[14%] hidden h-[18rem] w-[13rem] rotate-[8deg] rounded-[45%_45%_20%_20%] border border-white/15 bg-gradient-to-b from-zinc-200/20 via-violet-400/15 to-zinc-950/70 shadow-[0_0_80px_rgba(124,58,237,.22)] sm:block" />
      <div className="pointer-events-none absolute bottom-[-8rem] right-[18%] h-[18rem] w-[18rem] rounded-full bg-violet-500/15 blur-3xl" />

      <div className="relative z-10 flex min-h-[22rem] max-w-[46rem] flex-col justify-end px-5 py-7 sm:min-h-[24rem] sm:justify-center sm:px-9 sm:py-9 lg:px-11">
        <div key={slide.id} className="home-hero-copy">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-300 sm:text-xs">
            <span className="h-px w-7 bg-violet-400" />
            {slide.eyebrow}
          </p>
          <h1 className="mt-3 max-w-[14ch] text-[2rem] font-semibold leading-[1.16] tracking-[-0.045em] text-white sm:text-[2.65rem]">
            {slide.title}
          </h1>
          <p className="mt-4 max-w-[44rem] text-sm leading-6 text-zinc-300 sm:text-[15px] sm:leading-7">
            {slide.description}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <StudioButton
              href={slide.ctaHref}
              size="lg"
              className="rounded-xl bg-white px-5 text-zinc-950 shadow-lg shadow-black/30 hover:bg-zinc-100"
            >
              {slide.ctaLabel}
              <span aria-hidden>→</span>
            </StudioButton>
            <Link
              href="/tab/ranking"
              className="inline-flex min-h-12 items-center rounded-xl border border-white/15 bg-black/20 px-4 text-sm font-semibold text-zinc-100 backdrop-blur transition hover:border-violet-300/40 hover:bg-white/10"
            >
              인기 이야기 둘러보기
            </Link>
            <span className="hidden text-xs text-zinc-500 lg:inline">{slide.hint}</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-2 sm:bottom-7 sm:right-7">
        <span className="mr-1 text-[10px] tabular-nums text-zinc-500">
          {String(activeIndex + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
        </span>
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            aria-label={`${i + 1}번째 배너`}
            aria-current={i === activeIndex ? "true" : undefined}
            onClick={() => goTo(i)}
            className={cn(
              "h-1 rounded-full transition-all duration-300",
              i === activeIndex
                ? "w-8 bg-violet-300"
                : "w-3 bg-white/25 hover:bg-white/45",
            )}
          />
        ))}
      </div>
    </section>
  );
}
