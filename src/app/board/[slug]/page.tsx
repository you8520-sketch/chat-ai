import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { BOARD_CONFIG } from "@/lib/boardConfig";
import PostForm from "./PostForm";
import CommentSection from "./CommentSection";
import MarkNoticeRead from "./MarkNoticeRead";

export const dynamic = "force-dynamic";

type Post = { id: number; title: string; content: string; author_name: string; created_at: string };
type Comment = {
  id: number;
  post_id: number;
  author_name: string;
  content: string;
  created_at: string;
  is_staff_reply: number;
};

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = BOARD_CONFIG[slug as keyof typeof BOARD_CONFIG];
  if (!board) notFound();

  const user = await getSessionUser();
  const db = getDb();

  let posts: Post[] = [];
  if ("private" in board && board.private) {
    posts = user
      ? (db
          .prepare(
            "SELECT id, title, content, author_name, created_at FROM posts WHERE board=? AND author_id=? ORDER BY id DESC LIMIT 50"
          )
          .all(slug, user.id) as Post[])
      : [];
  } else {
    posts = db
      .prepare("SELECT id, title, content, author_name, created_at FROM posts WHERE board=? ORDER BY id DESC LIMIT 50")
      .all(slug) as Post[];
  }

  let commentsByPost = new Map<number, Comment[]>();
  if ("comments" in board && board.comments && posts.length > 0) {
    const ids = posts.map((p) => p.id);
    const all = db
      .prepare(
        `SELECT id, post_id, author_name, content, created_at, COALESCE(is_staff_reply, 0) AS is_staff_reply
         FROM comments
         WHERE post_id IN (${ids.map(() => "?").join(",")}) ORDER BY id ASC`
      )
      .all(...ids) as Comment[];
    commentsByPost = all.reduce((map, c) => {
      const arr = map.get(c.post_id) ?? [];
      arr.push(c);
      map.set(c.post_id, arr);
      return map;
    }, new Map<number, Comment[]>());
  }

  const boardDesc = "desc" in board ? board.desc : undefined;
  const boardComments = "comments" in board && board.comments;

  return (
    <div className="mx-auto mt-4 max-w-3xl">
      {slug === "notice" && <MarkNoticeRead />}
      <h1 className="text-xl font-black text-white">{board.title}</h1>
      {boardDesc && <p className="mt-1 text-xs text-amber-300/80">🔒 {boardDesc}</p>}
      {"writable" in board && board.writable && (user ? (
        <PostForm board={slug} />
      ) : (
        <p className="mt-3 text-sm text-gray-500">로그인 후 글을 작성할 수 있습니다.</p>
      ))}
      <div className="mt-4 space-y-2">
        {posts.length === 0 && (
          <p className="mt-10 text-center text-gray-500">
            {"private" in board && board.private && !user
              ? "로그인하면 내가 작성한 문의 내역이 표시됩니다."
              : "게시글이 없습니다."}
          </p>
        )}
        {posts.map((p) => {
          const comments = commentsByPost.get(p.id) ?? [];
          const hasStaffReply = comments.some((c) => c.is_staff_reply === 1);
          return (
            <details key={p.id} className="rounded-xl border border-white/5 bg-[#131626] p-4">
              <summary className="cursor-pointer list-none">
                <span className="font-semibold text-white">{p.title}</span>
                {boardComments && hasStaffReply && (
                  <span className="ml-2 text-xs font-semibold text-emerald-400">[답변]</span>
                )}
                {boardComments && comments.length > 0 && (
                  <span className="ml-2 text-xs font-semibold text-violet-400">[{comments.length}]</span>
                )}
                <span className="ml-3 text-xs text-gray-500">
                  {p.author_name} · {new Date(p.created_at + "Z").toLocaleDateString("ko-KR")}
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-gray-300">{p.content}</p>
              {boardComments && (
                <CommentSection
                  postId={p.id}
                  comments={comments}
                  loggedIn={!!user}
                  canReply={false}
                />
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}
