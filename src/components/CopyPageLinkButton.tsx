"use client";

import { useState } from "react";

type Props = {
  /** 서버에서 넘긴 경로 — `/character/123` 등 */
  path: string;
  className?: string;
};

export default function CopyPageLinkButton({ path, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={() => void copyLink()}
      title="페이지 주소 복사"
      aria-label={copied ? "주소가 복사되었습니다" : "페이지 주소 복사"}
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-gray-400 transition hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-200 ${className}`}
    >
      <span aria-hidden>{copied ? "✓" : "🔗"}</span>
      {copied ? "복사됨" : "링크"}
    </button>
  );
}
