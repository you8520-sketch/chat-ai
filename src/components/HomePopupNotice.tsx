"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HomePopupNotice as HomePopupNoticeRow } from "@/lib/homePopupNotice";

type Props = {
  notice: HomePopupNoticeRow | null;
};

function todayKey() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function storageKey(notice: HomePopupNoticeRow) {
  return `home-popup-notice:${notice.id}:${notice.updated_at.slice(0, 10)}`;
}

export default function HomePopupNotice({ notice }: Props) {
  const [visible, setVisible] = useState(false);
  const [hideToday, setHideToday] = useState(false);
  const handledForThisHomeVisitRef = useRef(false);
  const key = useMemo(() => (notice ? storageKey(notice) : ""), [notice]);

  useEffect(() => {
    if (!notice || !key) return;
    // Preference/adult filters refresh the home Server Component in place.
    // Treat those refreshes as the same home visit so a dismissed notice does
    // not reopen. Leaving home and entering it again remounts this component.
    if (handledForThisHomeVisitRef.current) return;
    handledForThisHomeVisitRef.current = true;
    const hiddenDate = window.localStorage.getItem(key);
    if (hiddenDate === todayKey()) return;
    setVisible(true);
  }, [notice, key]);

  if (!notice || !visible) return null;

  function close() {
    if (hideToday && key) {
      window.localStorage.setItem(key, todayKey());
    }
    setVisible(false);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 px-4 py-8 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-popup-notice-title"
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-[#17111f] bg-cover bg-center shadow-2xl shadow-black/50"
        style={{
          backgroundColor: notice.background_color || "#17111f",
          backgroundImage: notice.image_url
            ? `linear-gradient(rgba(0,0,0,.46), rgba(0,0,0,.72)), url("${notice.image_url}")`
            : undefined,
        }}
      >
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-violet-200/80">공지사항</p>
              <h2 id="home-popup-notice-title" className="mt-1 text-lg font-bold text-white">
                {notice.title || "안내"}
              </h2>
            </div>
            <button
              type="button"
              onClick={close}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-lg leading-none text-zinc-300 transition hover:bg-white/10 hover:text-white"
              aria-label="공지 닫기"
            >
              ×
            </button>
          </div>

          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-100">
            {notice.content}
          </p>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
            <label className="flex min-w-0 items-center gap-2 text-xs text-zinc-300">
              <input
                type="checkbox"
                checked={hideToday}
                onChange={(e) => setHideToday(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-black/30 accent-violet-500"
              />
              오늘 하루 보지 않기
            </label>
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-violet-500"
            >
              확인
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
