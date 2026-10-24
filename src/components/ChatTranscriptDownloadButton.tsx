"use client";

import { useRef, useState } from "react";
import { IconDownload } from "@/components/ChatToolbarIcons";

const LABEL = "전체 대화 다운로드";
const FALLBACK_FILENAME = "chat-transcript.txt";

export function parseDownloadFilename(disposition: string | null): string {
  if (!disposition) return FALLBACK_FILENAME;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return FALLBACK_FILENAME;
    }
  }
  return FALLBACK_FILENAME;
}

type Props = {
  chatId: number | null;
  onError: (message: string) => void;
};

/** 채팅 우측 레일/모바일 `···` 메뉴 공용. 화면에 로드된 턴과 무관하게 서버가 전체 대화를 내려준다. */
export default function ChatTranscriptDownloadButton({ chatId, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function download() {
    if (!chatId || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/chat/export?chatId=${encodeURIComponent(String(chatId))}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        let message = "대화 다운로드에 실패했습니다.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) message = data.error;
        } catch {
          // 본문이 JSON이 아니면 기본 안내를 쓴다.
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = parseDownloadFilename(res.headers.get("Content-Disposition"));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : "대화 다운로드에 실패했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="chat-transcript-download"
      onClick={() => void download()}
      disabled={busy || !chatId}
      aria-busy={busy}
      aria-label={LABEL}
      title={busy ? "대화를 내려받는 중…" : LABEL}
      className={`flex w-full flex-col items-center gap-0.5 rounded-md px-0 py-1.5 transition hover:bg-white/[0.06] disabled:cursor-wait disabled:opacity-60 ${
        busy ? "text-sky-200" : "text-zinc-100 hover:text-sky-100"
      }`}
    >
      <IconDownload className={`h-4 w-4 ${busy ? "animate-pulse" : ""}`} />
      <span className="max-w-full text-center text-[8px] font-medium leading-[1.15] tracking-tight min-[576px]:px-0.5 min-[576px]:text-[9px]">
        {busy ? (
          "내려받는 중"
        ) : (
          <>
            <span className="min-[576px]:hidden">대화</span>
            <span className="hidden min-[576px]:inline">전체 대화</span>
            <br />
            다운로드
          </>
        )}
      </span>
    </button>
  );
}
