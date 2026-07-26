"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function HeartIcon({ filled, className }: { filled?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
      />
    </svg>
  );
}

const actionBtn =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-semibold text-zinc-200 transition hover:bg-white/10";

export default function LikeFollowButtons({
  characterId,
  liked: initialLiked,
  followed: initialFollowed,
  loggedIn,
}: {
  characterId: number;
  liked: boolean;
  followed: boolean;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [followed, setFollowed] = useState(initialFollowed);

  async function toggle(kind: "like" | "follow") {
    if (!loggedIn) return router.push("/login");
    const res = await fetch(`/api/characters/${characterId}/${kind}`, { method: "POST" });
    const data = await res.json();
    if (kind === "like") setLiked(data.liked);
    else setFollowed(data.followed);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => toggle("like")}
        className={`${actionBtn} ${
          liked ? "border-rose-500/20 bg-rose-500/10 text-rose-300" : ""
        }`}
        aria-pressed={liked}
        title={liked ? "좋아요 취소" : "좋아요"}
      >
        <HeartIcon filled={liked} className="h-4 w-4" />
      </button>
      <button
        onClick={() => toggle("follow")}
        className={`${actionBtn} ${
          followed ? "border-violet-500/20 bg-violet-500/10 text-violet-300" : ""
        }`}
      >
        {followed ? "팔로잉" : "+ 팔로우"}
      </button>
    </>
  );
}
