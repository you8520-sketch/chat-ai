"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HomePopupNotice } from "@/lib/homePopupNotice";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

type Props = {
  initialNotice: HomePopupNotice | null;
};

const DEFAULT_CONTENT =
  "레이아웃을 만지다가 이미지 에셋이 안 뜨는 상황을 인식 중입니다.\n에셋을 손보고, 에셋 앨범을 볼 수 있도록 만들겠습니다.";

const COLOR_PRESETS = [
  "#21183a",
  "#141827",
  "#1f2937",
  "#2a1618",
  "#11251d",
  "#1f1a12",
];

function toInputDateTime(value: string | null | undefined) {
  if (!value) return "";
  return value.replace(" ", "T").slice(0, 16);
}

export default function AdminHomePopupNoticeClient({ initialNotice }: Props) {
  const [enabled, setEnabled] = useState((initialNotice?.enabled ?? 1) === 1);
  const [title, setTitle] = useState(initialNotice?.title || "작업 안내");
  const [content, setContent] = useState(initialNotice?.content || DEFAULT_CONTENT);
  const [backgroundColor, setBackgroundColor] = useState(
    initialNotice?.background_color || "#21183a"
  );
  const [imageUrl, setImageUrl] = useState(initialNotice?.image_url || "");
  const [startsAt, setStartsAt] = useState(toInputDateTime(initialNotice?.starts_at));
  const [endsAt, setEndsAt] = useState(toInputDateTime(initialNotice?.ends_at));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const preview = useMemo<HomePopupNotice>(
    () => ({
      id: initialNotice?.id ?? 1,
      enabled: enabled ? 1 : 0,
      title,
      content,
      background_color: backgroundColor,
      image_url: imageUrl,
      starts_at: startsAt || null,
      ends_at: endsAt || null,
      updated_at: initialNotice?.updated_at ?? "",
    }),
    [backgroundColor, content, enabled, endsAt, imageUrl, initialNotice, startsAt, title]
  );

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/admin/home-popup-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          title,
          content,
          backgroundColor,
          imageUrl,
          startsAt: startsAt || null,
          endsAt: endsAt || null,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "저장하지 못했습니다.");
      setNotice("저장했습니다.");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/settings" className={studioSurface.linkQuiet}>
            ← 설정으로
          </Link>
          <h1 className={cn(studioType.heading, "mt-3")}>홈 팝업 공지</h1>
          <p className={cn(studioType.helper, "mt-1")}>
            홈 화면 중앙에 뜨는 작은 공지 팝업을 관리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>

      {notice ? (
        <p className="mb-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-zinc-200">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className={cn(studioSurface.card, "space-y-4 p-5")}>
          <label className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-violet-500"
            />
            팝업 사용
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-zinc-400">제목</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131c] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-zinc-400">내용</span>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={600}
              rows={7}
              className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-[#11131c] px-3 py-2 text-sm leading-6 text-zinc-100 outline-none focus:border-violet-500/50"
            />
            <span className="mt-1 block text-right text-[11px] text-zinc-500">
              {content.length.toLocaleString()} / 600자
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-zinc-400">시작일시</span>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131c] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-zinc-400">종료일시</span>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131c] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
              />
            </label>
          </div>

          <div>
            <span className="text-xs font-semibold text-zinc-400">배경 색</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => setBackgroundColor(e.target.value)}
                className="h-9 w-12 rounded border border-white/10 bg-transparent"
              />
              {COLOR_PRESETS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setBackgroundColor(color)}
                  className="h-8 w-8 rounded-full border border-white/15 ring-offset-2 ring-offset-[#0b0d14] transition hover:ring-2 hover:ring-violet-400"
                  style={{ backgroundColor: color }}
                  aria-label={`${color} 배경 선택`}
                />
              ))}
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-zinc-400">배경 이미지 URL</span>
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#11131c] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-500/50"
            />
          </label>
        </section>

        <aside className={cn(studioSurface.card, "h-fit p-5")}>
          <p className="mb-3 text-xs font-semibold text-zinc-400">미리보기</p>
          <div
            className="overflow-hidden rounded-2xl border border-white/10 bg-cover bg-center shadow-xl shadow-black/30"
            style={{
              backgroundColor: preview.background_color,
              backgroundImage: preview.image_url
                ? `linear-gradient(rgba(0,0,0,.46), rgba(0,0,0,.72)), url("${preview.image_url}")`
                : undefined,
            }}
          >
            <div className="p-4">
              <p className="text-[11px] font-semibold text-violet-200/80">공지사항</p>
              <p className="mt-1 text-lg font-bold text-white">{preview.title || "안내"}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-100">
                {preview.content || "내용을 입력하세요."}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-zinc-300">
                <span>오늘 하루 보지 않기</span>
                <span className="rounded bg-violet-600 px-2 py-1 font-bold text-white">확인</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
