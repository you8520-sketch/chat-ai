"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import StatusWidgetCard from "@/components/StatusWidgetCard";
import { buildStatusWidgetEditorPreviewValues } from "@/lib/statusWidget/editorPreview";
import { renderStatusWidgetHtml } from "@/lib/statusWidget/render";
import { STATUS_WIDGET_PRESET_TITLE_MAX } from "@/lib/statusWidgetPresetTypes";
import type { StatusWidget } from "@/lib/statusWidget/types";

type Props = {
  shareSlug: string;
  initialTitle: string;
  authorNickname: string;
  widget: StatusWidget;
  loggedIn: boolean;
};

export default function WidgetApplyClient({
  shareSlug,
  initialTitle,
  authorNickname,
  widget,
  loggedIn,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const previewHtml = useMemo(
    () => renderStatusWidgetHtml(widget, buildStatusWidgetEditorPreviewValues(widget)),
    [widget]
  );

  async function addToMyWidgets() {
    if (!loggedIn) {
      router.push(`/login?redirect=${encodeURIComponent(`/widget/apply/${shareSlug}`)}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/status-widget-shares/${encodeURIComponent(shareSlug)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
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
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-400">위젯 적용하기</p>
      <h1 className="mt-1 text-xl font-bold text-white">{initialTitle}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        공유: <span className="text-zinc-300">@{authorNickname}</span>
      </p>

      <div className="mt-6 rounded-2xl border border-white/10 bg-[#131626] p-4">
        <p className="mb-3 text-xs font-bold text-zinc-400">미리보기</p>
        <StatusWidgetCard html={previewHtml} />
      </div>

      {!done ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-violet-500/25 bg-violet-950/10 p-5">
          <div>
            <label className="mb-1 block text-xs text-gray-400">내 보관함에 저장할 제목</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-[#0e1120] px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              maxLength={STATUS_WIDGET_PRESET_TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, STATUS_WIDGET_PRESET_TITLE_MAX))}
              disabled={busy}
            />
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={() => void addToMyWidgets()}
            className="w-full rounded-xl bg-violet-600 py-3 text-sm font-bold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {busy ? "저장 중…" : loggedIn ? "내 위젯에 추가" : "로그인 후 내 위젯에 추가"}
          </button>
          {!loggedIn && (
            <p className="text-center text-xs text-zinc-500">
              저장하려면{" "}
              <Link
                href={`/login?redirect=${encodeURIComponent(`/widget/apply/${shareSlug}`)}`}
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
          <p className="text-sm font-bold text-emerald-300">내 위젯 보관함에 추가했습니다.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/persona#status-widget-presets"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500"
            >
              보관함 보기
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-white/5"
            >
              홈으로
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
