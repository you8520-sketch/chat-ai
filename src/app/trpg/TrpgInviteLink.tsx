"use client";

import { useEffect, useState } from "react";
import { trpgInvitePath } from "@/lib/trpg/invite";

export default function TrpgInviteLink({
  code,
  canJoin,
  compact = false,
}: {
  code: string;
  canJoin: boolean;
  compact?: boolean;
}) {
  const path = trpgInvitePath(code);
  const [full, setFull] = useState(path);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setFull(typeof window !== "undefined" ? `${window.location.origin}${path}` : path);
  }, [path]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = full;
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

  if (!path) return null;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
      >
        {copied ? "복사됨" : "입장 링크 복사"}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-violet-400/20 bg-violet-500/5 p-3">
      <p className="text-xs font-semibold text-violet-200">같이할 유저 초대</p>
      <p className="mt-1 break-all text-sm text-zinc-200">{full}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {canJoin
          ? "시작 전에 이 링크를 보내면 바로 입장합니다. 사람+AI 합쳐 4자리입니다."
          : "이미 시작됐거나 정원이 가득해서 새 참가는 안 됩니다."}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="mt-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500"
      >
        {copied ? "복사됨" : "입장 링크 복사"}
      </button>
    </div>
  );
}
