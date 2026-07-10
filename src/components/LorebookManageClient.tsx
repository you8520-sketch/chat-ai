"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import StudioButton from "@/components/studio/StudioButton";
import StudioEmptyState, { StudioBackLink } from "@/components/studio/StudioEmptyState";
import type { KeywordLorebookListItem } from "@/lib/keywordLorebooks";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

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
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <StudioBackLink href="/studio?tab=lorebooks">← 제작 · 로어북</StudioBackLink>
      <h1 className={`${studioType.heading} mt-4`}>내 로어북</h1>
      <p className={`${studioType.helper} mt-2`}>
        저장된 로어북을 수정하거나 캐릭터에 연결할 수 있습니다.
      </p>

      <StudioButton href="/lorebook/create" className="mt-6">
        + 새 로어북
      </StudioButton>

      {loading ? (
        <p className={`${studioType.helper} mt-8`}>불러오는 중…</p>
      ) : lorebooks.length === 0 ? (
        <StudioEmptyState
          message="아직 만든 로어북이 없습니다."
          href="/lorebook/create"
          cta="로어북 제작하기"
        />
      ) : (
        <ul className="mt-6 space-y-2">
          {lorebooks.map((lb) => (
            <li key={lb.id}>
              <Link
                href={`/lorebook/${lb.id}/edit`}
                className={cn(
                  studioSurface.card,
                  "flex min-h-14 items-center justify-between gap-3 px-4 py-3.5 transition hover:border-white/20",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-zinc-50">{lb.name}</p>
                  {lb.summary ? (
                    <p className={cn(studioType.caption, "mt-0.5 truncate")}>{lb.summary}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-semibold text-zinc-400">
                  {lb.entryCount}항목
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
