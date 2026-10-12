import Link from "next/link";

import StudioButton from "@/components/studio/StudioButton";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

const BANNER = {
  tag: "EVENT",
  eyebrow: "CREATOR EVENT · 나만의 세계를 공개하세요",
  title: `캐릭터를 만들면 ${CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P`,
  description:
    "한 명의 캐릭터부터 다인 시뮬레이션까지 자유롭게 제작하고 공개해 보세요. 승인된 작품에는 이벤트 포인트를 드립니다.",
  ctaHref: "/events/create-migration",
  ctaLabel: "제작 이벤트 참여",
  hint: "공개 저장 후 신청",
} as const;

/**
 * Creator event strip. Characters, not the promo, own the first screen.
 * Layout follows the container (main column) width, not the viewport: the left rail
 * narrows the column between 576px and 1023px, so viewport breakpoints squeezed the copy.
 */
export default function HomeCreateEventBanner() {
  return (
    <section aria-label="제작 이벤트" className="@container mt-1 border-b border-white/10 py-3 @3xl:py-4">
      <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:justify-between @3xl:gap-6">
        <div className="flex min-w-0 items-center gap-4 @3xl:flex-1">
          <span
            className="home-slab shrink-0 text-[11px] font-black tracking-[0.2em]"
            style={{ ["--slab-bg" as string]: "#7c3aed" }}
          >
            {BANNER.tag}
          </span>
          <div className="min-w-0">
            <p className="hidden break-keep text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 @3xl:block">
              {BANNER.eyebrow}
            </p>
            <p className="mt-0.5 break-keep text-lg font-extrabold leading-tight tracking-[-0.04em] text-white @3xl:text-2xl">
              {BANNER.title}
            </p>
            <p className="mt-1 hidden max-w-xl truncate text-[13px] leading-5 text-zinc-400 @3xl:block">
              {BANNER.description}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 @3xl:shrink-0">
          <StudioButton
            href={BANNER.ctaHref}
            size="md"
            className="rounded-none bg-white px-4 text-zinc-950 shadow-none hover:bg-zinc-200"
          >
            {BANNER.ctaLabel}
            <span aria-hidden>→</span>
          </StudioButton>
          <Link
            href="/tab/ranking"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-zinc-200 underline decoration-white/25 underline-offset-4 transition hover:text-white hover:decoration-white/70"
          >
            인기 이야기 둘러보기
          </Link>
          <span className="hidden text-xs text-zinc-500 @5xl:inline">{BANNER.hint}</span>
        </div>
      </div>
    </section>
  );
}
