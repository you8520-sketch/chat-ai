import Link from "next/link";

import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

export default function HomeCreateEventBanner() {
  return (
    <div className="mt-2 rounded-2xl bg-gradient-to-r from-violet-900/55 via-fuchsia-900/40 to-emerald-900/45 p-6">
      <p className="text-xs font-bold uppercase tracking-wider text-emerald-300/90">EVENT</p>
      <h1 className="mt-1 text-2xl font-black text-white">
        캐릭터 제작 · 이식하면{" "}
        <span className="text-emerald-300">{CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P</span> 증정!
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">
        새 캐릭터를 제작하거나 다른 플랫폼 캐릭터를 이식해 공개로 등록하고 이벤트에 신청하세요. 관리자 승인 후
        무료 포인트{" "}
        <span className="font-bold text-emerald-300">{CREATE_MIGRATION_EVENT_REWARD.toLocaleString()}P</span>가
        지급됩니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href="/events/create-migration"
          className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-emerald-400"
        >
          신청하기
        </Link>
        <p className="text-xs text-zinc-500">공개 저장 캐릭터 선택 → 신청 → 관리자 승인 후 지급</p>
      </div>
    </div>
  );
}
