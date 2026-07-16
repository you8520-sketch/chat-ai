"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WORLD_NAME_LIMIT } from "@/lib/worlds";

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
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function addToMyWorlds() {
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
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "저장에 실패했습니다.");
        return;
      }
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
        공유받은 세계관
      </p>
      <h1 className="mt-1 text-xl font-bold text-white">{initialName}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        공유: <span className="text-zinc-300">@{authorNickname}</span>
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
          <div>
            <label className="mb-1 block text-xs text-gray-400">내 세계관에 저장할 이름</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              maxLength={WORLD_NAME_LIMIT}
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, WORLD_NAME_LIMIT))}
              disabled={busy}
            />
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void addToMyWorlds()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? "저장 중…" : loggedIn ? "내 세계관에 추가" : "로그인 후 내 세계관에 추가"}
          </button>
          {!loggedIn && (
            <p className="text-center text-xs text-zinc-500">
              저장하려면{" "}
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
          <p className="text-sm font-bold text-emerald-300">공유받은 세계관으로 추가했습니다.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/studio?tab=worlds"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
            >
              내 세계관 보기
            </Link>
            <Link
              href="/create"
              className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-white/5"
            >
              캐릭터에 사용
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
