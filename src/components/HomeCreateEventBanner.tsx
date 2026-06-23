import Link from "next/link";

export default function HomeCreateEventBanner() {
  return (
    <div className="mt-2 rounded-2xl bg-gradient-to-r from-violet-900/55 via-fuchsia-900/40 to-emerald-900/45 p-6">
      <p className="text-xs font-bold uppercase tracking-wider text-violet-300/90">CLOSED BETA</p>
      <h1 className="mt-1 text-2xl font-black text-white">클로즈베타 테스트중</h1>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">
        클로즈베타 참여자에게 무료 포인트를 지급합니다. 신청 후 관리자 승인 시 포인트가 지급됩니다.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href="/events/beta-free-points"
          className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-black hover:bg-emerald-400"
        >
          무료 포인트 신청하기
        </Link>
        <p className="text-xs text-zinc-500">신청 → 관리자 검토 → 승인 후 지급</p>
      </div>
    </div>
  );
}
