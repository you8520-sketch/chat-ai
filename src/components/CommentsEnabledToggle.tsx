"use client";

import { useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";

export default function CommentsEnabledToggle({
  scope,
  targetId,
  initialEnabled,
  label = "댓글 허용",
  description = "OFF 시 다른 사용자는 댓글을 보거나 작성할 수 없습니다.",
}: {
  scope: "creator" | "character";
  targetId?: number;
  initialEnabled: boolean;
  label?: string;
  description?: string;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onChange(next: boolean) {
    setEnabled(next);
    setBusy(true);
    setError("");
    const url = scope === "creator" ? "/api/creator" : `/api/characters/${targetId}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments_enabled: next }),
    });
    setBusy(false);
    if (!res.ok) {
      setEnabled(!next);
      setError((await res.json()).error || "설정 저장에 실패했습니다.");
    }
  }

  return (
    <div>
      <ToggleSwitch
        checked={enabled}
        onChange={onChange}
        disabled={busy}
        label={label}
        description={description}
      />
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
