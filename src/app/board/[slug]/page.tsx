import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import PostForm from "./PostForm";
import CommentSection from "./CommentSection";
import MarkNoticeRead from "./MarkNoticeRead";

export const dynamic = "force-dynamic";

const BOARDS: Record<string, { title: string; writable: boolean; private?: boolean; comments?: boolean; desc?: string }> = {
  inquiry: { title: "문의 게시판", writable: true, private: true, desc: "문의 내용은 작성자 본인만 볼 수 있습니다." },
  notice: { title: "공지사항", writable: false },
  faq: { title: "FAQ", writable: false },
};

type Post = { id: number; title: string; content: string; author_name: string; created_at: string };
type Comment = { id: number; post_id: number; author_name: string; content: string; created_at: string };

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const board = BOARDS[slug];
  if (!board) notFound();

  const user = await getSessionUser();
  const db = getDb();

  // 문의 게시판은 비공개: 본인 글만 표시
  let posts: Post[] = [];
  if (board.private) {
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

  // 댓글 (댓글 허용 게시판)
  let commentsByPost = new Map<number, Comment[]>();
  if (board.comments && posts.length > 0) {
    const ids = posts.map((p) => p.id);
    const all = db
      .prepare(
        `SELECT id, post_id, author_name, content, created_at FROM comments
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

  return (
    <div className="mx-auto mt-4 max-w-3xl">
      {slug === "notice" && <MarkNoticeRead />}
      <h1 className="text-xl font-black text-white">{board.title}</h1>
      {board.desc && <p className="mt-1 text-xs text-amber-300/80">🔒 {board.desc}</p>}
      {board.writable && (user ? <PostForm board={slug} /> : (
        <p className="mt-3 text-sm text-gray-500">로그인 후 글을 작성할 수 있습니다.</p>
      ))}
      <div className="mt-4 space-y-2">
        {posts.length === 0 && (
          <p className="mt-10 text-center text-gray-500">
            {board.private && !user ? "로그인하면 내가 작성한 문의 내역이 표시됩니다." : "게시글이 없습니다."}
          </p>
        )}
        {posts.map((p) => {
          const comments = commentsByPost.get(p.id) ?? [];
          return (
            <details key={p.id} className="rounded-xl border border-white/5 bg-[#131626] p-4">
              <summary className="cursor-pointer list-none">
                <span className="font-semibold text-white">{p.title}</span>
                {board.comments && comments.length > 0 && (
                  <span className="ml-2 text-xs font-semibold text-violet-400">[{comments.length}]</span>
                )}
                <span className="ml-3 text-xs text-gray-500">
                  {p.author_name} · {new Date(p.created_at + "Z").toLocaleDateString("ko-KR")}
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap text-sm text-gray-300">{p.content}</p>
              {board.comments && (
                <CommentSection postId={p.id} comments={comments} loggedIn={!!user} />
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}
