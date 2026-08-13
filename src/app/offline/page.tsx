import Link from "next/link";

export default function OfflinePage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <img
        src="/icons/icon-192.png"
        alt="하비 AI"
        width={88}
        height={88}
        className="rounded-2xl shadow-2xl shadow-violet-950/50"
      />
      <h1 className="mt-6 text-2xl font-bold text-white">인터넷 연결을 확인해 주세요</h1>
      <p className="mt-3 text-sm leading-relaxed text-zinc-400">
        하비 AI의 대화와 콘텐츠를 불러오려면 인터넷 연결이 필요합니다.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-violet-500"
      >
        다시 시도
      </Link>
    </section>
  );
}
