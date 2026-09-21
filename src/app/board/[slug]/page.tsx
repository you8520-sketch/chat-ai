import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { BOARD_CONFIG } from "@/lib/boardConfig";
import MarkNoticeRead from "./MarkNoticeRead";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";

export const dynamic = "force-dynamic";

type Post = { id: number; title: string; content: string; author_name: string; created_at: string };

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ post?: string }>;
}) {
  const { slug } = await params;
  const { post: focusedPostParam } = await searchParams;
  const focusedPostId = Number(focusedPostParam);
  const board = BOARD_CONFIG[slug as keyof typeof BOARD_CONFIG];
  if (!board) notFound();

  const db = getDb();
  const posts = db
    .prepare("SELECT id, title, content, author_name, created_at FROM posts WHERE board=? ORDER BY id DESC LIMIT 50")
    .all(slug) as Post[];

  return (
    <div className="mx-auto mt-4 max-w-3xl">
      {slug === "notice" && <MarkNoticeRead />}
      <h1 className={studioType.heading}>{board.title}</h1>
      <div className="mt-4 space-y-2">
        {posts.length === 0 && (
          <p className={cn(studioType.helper, "mt-10 text-center")}>게시글이 없습니다.</p>
        )}
        {posts.map((p) => (
          <details
            id={`post-${p.id}`}
            key={p.id}
            open={Number.isFinite(focusedPostId) && focusedPostId === p.id}
            className={cn(studioSurface.card, "scroll-mt-20 p-4")}
          >
            <summary className="cursor-pointer list-none">
              <span className="font-semibold text-zinc-50">{p.title}</span>
              <span className="ml-3 text-xs text-zinc-500">
                {p.author_name} · {new Date(p.created_at + "Z").toLocaleDateString("ko-KR")}
              </span>
            </summary>
            <p className={cn(studioType.body, "mt-3 whitespace-pre-wrap")}>{p.content}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
