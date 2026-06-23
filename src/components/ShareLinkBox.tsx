"use client";

import { useState } from "react";

export default function ShareLinkBox({ path, label = "공유 링크" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const full =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
      <p className="text-xs font-bold text-cyan-300">{label}</p>
      <p className="mt-1 break-all text-sm text-gray-300">{full}</p>
      <button
        type="button"
        onClick={copy}
        className="mt-2 rounded-lg bg-cyan-600/80 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-500"
      >
        {copied ? "복사됨!" : "링크 복사"}
      </button>
    </div>
  );
}
