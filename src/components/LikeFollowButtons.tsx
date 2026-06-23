"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
        className={`rounded-full px-6 py-3 font-semibold ${
          liked ? "bg-rose-600/20 text-rose-300" : "bg-white/5 text-gray-300 hover:bg-white/10"
        }`}
      >
        {liked ? "❤️ 좋아요 취소" : "🤍 좋아요"}
      </button>
      <button
        onClick={() => toggle("follow")}
        className={`rounded-full px-6 py-3 font-semibold ${
          followed ? "bg-violet-600/20 text-violet-300" : "bg-white/5 text-gray-300 hover:bg-white/10"
        }`}
      >
        {followed ? "팔로잉 ✓" : "+ 팔로우"}
      </button>
    </>
  );
}
