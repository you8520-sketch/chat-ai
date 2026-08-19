"use client";

import { useEffect, useState } from "react";
import { trpgInvitePath } from "@/lib/trpg/invite";
import type { TrpgBillingMode } from "@/lib/trpg/types";

export default function TrpgInviteLink({
  code,
  canJoin,
  compact = false,
  billingMode,
}: {
  code: string;
  canJoin: boolean;
  compact?: boolean;
  billingMode?: TrpgBillingMode;
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

  if (!canJoin) {
    return (
      <p className="text-xs text-zinc-500" data-trpg-invite-closed>
        새 참가 불가
      </p>
    );
  }

  return (
    <div className={compact ? "" : "space-y-1"}>
      {billingMode === "host_pays" ? (
        <p className="text-xs text-zinc-500">방장이 플레이 비용을 부담하는 방입니다.</p>
      ) : null}
      <button
        type="button"
        onClick={() => void copy()}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-white/10"
        data-trpg-invite-copy
      >
        {copied ? "복사됨" : "초대 링크 복사"}
      </button>
    </div>
  );
}
