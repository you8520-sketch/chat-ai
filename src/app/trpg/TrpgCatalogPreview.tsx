"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import type { TrpgCatalog } from "@/lib/trpg/catalog";
import {
  catalogScenarioById,
  catalogWorldById,
  visibleScenarioSecret,
  type TrpgCatalogPick,
} from "@/lib/trpg/catalogBrowse";

export default function TrpgCatalogPreview({
  catalog,
  pick,
  busy,
  onClose,
  onStart,
}: {
  catalog: TrpgCatalog;
  pick: TrpgCatalogPick | null;
  busy: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!pick) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [pick, onClose]);

  if (!pick || !mounted) return null;

  let title = "";
  let kindLabel = "";
  let cover: ReactNode = null;
  let meta: ReactNode = null;
  let body: ReactNode = null;
  let startLabel = "이걸로 캠페인 시작";

  switch (pick.kind) {
    case "world": {
      const world = catalogWorldById(catalog, pick.id);
      if (!world) return null;
      title = world.name;
      kindLabel = "세계관";
      startLabel = "이 세계관으로 캠페인 시작";
      cover = (
        <div className="aspect-square w-28 shrink-0 overflow-hidden rounded-xl bg-black sm:w-36">
          {world.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={world.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
      );
      meta = (
        <div className="min-w-0 flex-1 space-y-2">
          {world.creatorName && !world.mine ? (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-600">by</span> {world.creatorName}
            </p>
          ) : null}
          {world.summary.trim() ? <p className={studioType.body}>{world.summary}</p> : null}
          {world.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {world.genres.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                >
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );
      body = world.content.trim() ? (
        <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{world.content}</p>
      ) : (
        <p className="text-sm text-zinc-500">작성된 세계관 본문이 없습니다.</p>
      );
      break;
    }
    case "scenario": {
      const found = catalogScenarioById(catalog, pick.id);
      if (!found) return null;
      const { scenario, viewerIsCreator } = found;
      const secret = visibleScenarioSecret(scenario.secretContent, viewerIsCreator);
      title = scenario.title;
      kindLabel = "시나리오";
      startLabel = "이 시나리오로 캠페인 시작";
      meta = (
        <div className="min-w-0 flex-1 space-y-2">
          {scenario.summary.trim() ? <p className={studioType.body}>{scenario.summary}</p> : null}
          {scenario.startLocation.trim() ? (
            <p className="text-xs text-zinc-500">시작 장소 · {scenario.startLocation}</p>
          ) : null}
          {scenario.genres.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {scenario.genres.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md border border-white/[0.06] bg-white/[0.035] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400"
                >
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );
      body = (
        <div className="space-y-5">
          {scenario.assets[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={scenario.assets[0].url}
              alt=""
              className="max-h-64 w-full rounded-xl object-cover"
            />
          ) : null}
          {scenario.content.trim() ? (
            <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-200">{scenario.content}</p>
          ) : (
            <p className="text-sm text-zinc-500">작성된 시나리오 본문이 없습니다.</p>
          )}
          {secret ? (
            <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3.5">
              <p className="text-[11px] font-semibold tracking-wide text-amber-200/90">
                GM 비밀 · 제작자만 볼 수 있습니다
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-amber-50/90">{secret}</p>
            </section>
          ) : null}
        </div>
      );
      break;
    }
    default: {
      const _exhaustive: never = pick;
      return _exhaustive;
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trpg-catalog-preview-title"
        className={cn(
          studioSurface.card,
          "flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-[#11141f] shadow-2xl shadow-black/50 sm:rounded-2xl"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-violet-300/80">{kindLabel}</p>
            <h2 id="trpg-catalog-preview-title" className="mt-1 truncate text-lg font-semibold text-zinc-50">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 shrink-0 items-center rounded-lg border border-white/10 px-3 text-xs font-semibold text-zinc-300 hover:bg-white/5"
          >
            닫기
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {cover || meta ? (
            <div className="flex gap-3.5 sm:gap-4">
              {cover}
              {meta}
            </div>
          ) : null}
          {body}
        </div>
        <div className="border-t border-white/10 px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={busy}
            onClick={onStart}
            className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {startLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
