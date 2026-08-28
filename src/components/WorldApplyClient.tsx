"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  shareSlug: string;
  initialName: string;
  summary: string;
  content: string;
  authorNickname: string;
  loggedIn: boolean;
};

export default function WorldApplyClient({
  shareSlug,
  initialName,
  summary,
  content,
  authorNickname,
  loggedIn,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [alreadyInLibrary, setAlreadyInLibrary] = useState(false);
  const [borrowId, setBorrowId] = useState<number | null>(null);

  async function addToLibrary() {
    if (!loggedIn) {
      router.push(`/login?redirect=${encodeURIComponent(`/world/apply/${shareSlug}`)}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/world-shares/${encodeURIComponent(shareSlug)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        error?: string;
        alreadyInLibrary?: boolean;
        message?: string;
        borrowId?: number;
      };
      if (!res.ok) {
        setError(data.error || "추가에 실패했습니다.");
        return;
      }
      setBorrowId(typeof data.borrowId === "number" && data.borrowId > 0 ? data.borrowId : null);
      setAlreadyInLibrary(Boolean(data.alreadyInLibrary));
      setDone(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-400">
        공유 세계관
      </p>
      <h1 className="mt-1 text-xl font-bold text-white">{initialName}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        원작자: <span className="text-zinc-300">@{authorNickname}</span>
      </p>

      {summary ? (
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">{summary}</p>
      ) : null}

      <div className="mt-6 rounded-2xl border border-white/10 bg-[#131626] p-4">
        <p className="mb-3 text-xs font-bold text-zinc-400">세계관 본문 미리보기</p>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-300">
          {content}
        </pre>
      </div>

      {!done ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-violet-500/25 bg-violet-950/10 p-5">
          <p className="text-sm leading-relaxed text-zinc-300">
            이 세계관을 <span className="font-semibold text-violet-200">내 라이브러리</span>에 추가하면
            읽기 전용으로 보관됩니다. 캐릭터·시뮬레이션 제작에 사용할 수 있으며, 원본 수정이나 재공유는
            할 수 없습니다.
          </p>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void addToLibrary()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? "추가 중…" : loggedIn ? "내 라이브러리에 추가" : "로그인 후 라이브러리에 추가"}
          </button>
          {!loggedIn && (
            <p className="text-center text-xs text-zinc-500">
              추가하려면{" "}
              <Link
                href={`/login?redirect=${encodeURIComponent(`/world/apply/${shareSlug}`)}`}
                className="text-violet-400 hover:underline"
              >
                로그인
              </Link>
              이 필요합니다.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
          <p className="text-sm font-bold text-emerald-300">
            {alreadyInLibrary ? "이미 라이브러리에 있습니다." : "라이브러리에 추가했습니다."}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/studio?tab=worlds"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
            >
              내 라이브러리 보기
            </Link>
            <Link
              href={borrowId ? `/create?worldBorrowId=${borrowId}` : "/create"}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-white/5"
            >
              캐릭터 제작에 사용
            </Link>
            {borrowId ? (
              <Link
                href={`/create?kind=simulation&worldBorrowId=${borrowId}`}
                className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-white/5"
              >
                시뮬레이션 제작에 사용
              </Link>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
