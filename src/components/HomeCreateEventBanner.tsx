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
    <section className="mt-2 flex flex-col gap-3 border-y border-white/10 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          {BANNER.eyebrow}
        </p>
        <p className="mt-1 text-sm font-semibold tracking-[-0.03em] text-white sm:text-base">
          {BANNER.title}
        </p>
        <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-400">{BANNER.description}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StudioButton
          href={BANNER.ctaHref}
          size="sm"
          className="rounded-none bg-white px-4 text-zinc-950 shadow-none hover:bg-zinc-100"
        >
          {BANNER.ctaLabel}
        </StudioButton>
        <Link
          href="/tab/ranking"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-zinc-200 underline decoration-white/25 underline-offset-4 hover:text-white"
        >
          인기 이야기 둘러보기
        </Link>
        <span className="text-xs text-zinc-500">{BANNER.hint}</span>
      </div>
    </section>
  );
}
