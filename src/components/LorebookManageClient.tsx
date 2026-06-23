"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";

export default function LorebookManageClient() {
  const [lorebooks, setLorebooks] = useState<KeywordLorebookListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lorebooks");
        const data = await res.json();
        if (!cancelled && Array.isArray(data.lorebooks)) setLorebooks(data.lorebooks);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/studio" className="text-sm text-zinc-500 hover:text-zinc-300">
        ← 제작 메뉴
      </Link>
      <h1 className="mt-4 text-2xl font-black text-white">📖 내 로어북</h1>
      <p className="mt-2 text-sm text-gray-400">저장된 로어북을 수정하거나 캐릭터에 연결할 수 있습니다.</p>

      <Link
        href="/lorebook/create"
        className="mt-6 inline-block rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500"
      >
        + 새 로어북
      </Link>

      {loading ? (
        <p className="mt-8 text-sm text-zinc-500">불러오는 중…</p>
      ) : lorebooks.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-white/5 bg-[#131626] p-6 text-sm text-zinc-500">
          아직 만든 로어북이 없습니다.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {lorebooks.map((lb) => (
            <li key={lb.id}>
              <Link
                href={`/lorebook/${lb.id}/edit`}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-[#131626] px-4 py-3 transition hover:border-emerald-500/30"
              >
                <div>
                  <p className="font-semibold text-white">{lb.name}</p>
                  {lb.summary && <p className="text-xs text-zinc-500">{lb.summary}</p>}
                </div>
                <span className="text-xs text-emerald-400/80">{lb.entryCount}항목</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
