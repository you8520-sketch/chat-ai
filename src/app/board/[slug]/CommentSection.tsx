"use client";

type Comment = {
  id: number;
  author_name: string;
  content: string;
  created_at: string;
  is_staff_reply?: number;
};

export default function CommentSection({
  comments,
  canReply = false,
}: {
  postId: number;
  comments: Comment[];
  loggedIn: boolean;
  canReply?: boolean;
}) {
  if (comments.length === 0 && !canReply) {
    return (
      <div className="mt-4 border-t border-white/5 pt-3">
        <p className="text-xs text-gray-600">아직 운영팀 답변이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-white/5 pt-3">
      <p className="text-xs font-semibold text-gray-500">답변 {comments.length}</p>
      <div className="mt-2 space-y-2">
        {comments.map((c) => (
          <div
            key={c.id}
            className={`rounded-lg px-3 py-2 ${
              c.is_staff_reply ? "border border-violet-500/20 bg-violet-950/20" : "bg-[#0e1120]"
            }`}
          >
            <p className="text-[11px] text-gray-500">
              <span className={`font-semibold ${c.is_staff_reply ? "text-violet-300" : "text-gray-400"}`}>
                {c.author_name}
              </span>
              {c.is_staff_reply === 1 && (
                <span className="ml-1 rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] text-violet-200">
                  운영팀
                </span>
              )}{" "}
              ·{" "}
              {new Date(c.created_at + "Z").toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-300">{c.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
