"use client";

import { useEffect, useState } from "react";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";

export default function TrpgCampaignTitle({
  campaignId,
  title,
  canEdit,
  onSaved,
  inputClassName = "min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm font-medium text-zinc-100 outline-none focus:border-violet-400/40",
}: {
  campaignId: number;
  title: string;
  canEdit: boolean;
  onSaved?: (title: string) => void;
  inputClassName?: string;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setValue(title);
  }, [title]);

  async function save() {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/trpg/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!res.ok || !data.campaign) throw new Error(data.error || "제목을 바꾸지 못했습니다.");
      onSaved?.(data.campaign.title);
    } catch (e) {
      setError(e instanceof Error ? e.message : "제목을 바꾸지 못했습니다.");
      setValue(title);
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return <span className="font-medium text-zinc-100">{title}</span>;
  }

  return (
    <div className="min-w-0 flex-1">
      <input
        value={value}
        maxLength={80}
        disabled={busy}
        aria-label="캠페인 제목"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        className={inputClassName}
      />
      {error ? <p className="mt-1 text-xs text-rose-300">{error}</p> : null}
    </div>
  );
}
