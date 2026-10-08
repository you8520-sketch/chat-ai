import Link from "next/link";

import StudioButton from "@/components/studio/StudioButton";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

const BANNER = {
  eyebrow: "CREATOR EVENT · 나만의 세계를 공개하세요",
  title: `캐릭터를 만들면 ${CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P`,
  description:
    "한 명의 캐릭터부터 다인 시뮬레이션까지 자유롭게 제작하고 공개해 보세요. 승인된 작품에는 이벤트 포인트를 드립니다.",
  ctaHref: "/events/create-migration",
  ctaLabel: "제작 이벤트 참여",
  hint: "공개 저장 후 신청",
} as const;

export default function HomeCreateEventBanner() {
  return (
    <section className="home-hero relative mt-1 overflow-hidden border-b border-white/10 bg-[#07080c] lg:min-h-[17rem]">
      <p
        aria-hidden="true"
        className="home-hero-display pointer-events-none absolute -right-[0.06em] top-1/2 z-0 hidden -translate-y-1/2 select-none text-[clamp(6.5rem,14vw,10.5rem)] leading-none tracking-[-0.06em] text-white/[0.06] md:block"
      >
        HAV.
      </p>

      <div className="relative z-10 flex max-w-xl flex-col justify-center py-7 sm:py-9 lg:min-h-[17rem] lg:py-10">
        <div className="home-hero-copy">
          <p className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-400 sm:text-[11px]">
            <span className="h-px w-8 bg-white/50" />
            {BANNER.eyebrow}
          </p>
          <h1 className="mt-3 max-w-[14ch] text-[1.7rem] font-semibold leading-[1.12] tracking-[-0.045em] text-white sm:text-4xl lg:text-[2.7rem]">
            {BANNER.title}
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400 sm:text-[15px] sm:leading-7">
            {BANNER.description}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2.5">
            <StudioButton
              href={BANNER.ctaHref}
              size="lg"
              className="rounded-none bg-white px-5 text-zinc-950 shadow-none hover:bg-zinc-100"
            >
              {BANNER.ctaLabel}
              <span aria-hidden>→</span>
            </StudioButton>
            <Link
              href="/tab/ranking"
              className="inline-flex min-h-12 items-center text-sm font-semibold text-zinc-200 underline decoration-white/25 underline-offset-4 transition hover:text-white hover:decoration-white/70"
            >
              인기 이야기 둘러보기
            </Link>
            <span className="hidden text-xs text-zinc-500 lg:inline">{BANNER.hint}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
