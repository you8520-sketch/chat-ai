"use client";

import { useState } from "react";
import ToggleSwitch from "@/components/ToggleSwitch";

export default function CreatorNotificationPrefs({
  initialNotifyLikes,
  initialNotifyComments,
}: {
  initialNotifyLikes: boolean;
  initialNotifyComments: boolean;
}) {
  const [notifyLikes, setNotifyLikes] = useState(initialNotifyLikes);
  const [notifyComments, setNotifyComments] = useState(initialNotifyComments);
  const [busy, setBusy] = useState<"likes" | "comments" | null>(null);
  const [error, setError] = useState("");

  async function patch(body: Record<string, boolean>, kind: "likes" | "comments") {
    setBusy(kind);
    setError("");
    const res = await fetch("/api/creator", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    if (!res.ok) {
      setError((await res.json()).error || "알림 설정 저장에 실패했습니다.");
      return false;
    }
    return true;
  }

  async function onLikesChange(next: boolean) {
    setNotifyLikes(next);
    const ok = await patch({ notify_character_likes: next }, "likes");
    if (!ok) setNotifyLikes(!next);
  }

  async function onCommentsChange(next: boolean) {
    setNotifyComments(next);
    const ok = await patch({ notify_profile_comments: next }, "comments");
    if (!ok) setNotifyComments(!next);
  }

  return (
    <div className="space-y-4">
      <ToggleSwitch
        checked={notifyLikes}
        onChange={onLikesChange}
        disabled={busy !== null}
        label="좋아요 알림"
        description="누군가 내 캐릭터에 하트를 누르면 알림을 받습니다."
      />
      <ToggleSwitch
        checked={notifyComments}
        onChange={onCommentsChange}
        disabled={busy !== null}
        label="댓글 알림"
        description="누군가 내 프로필·캐릭터에 댓글을 남기면 알림을 받습니다."
      />
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
