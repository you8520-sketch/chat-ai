import Link from "next/link";
import { notFound } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { getDb } from "@/lib/db";
import { getNoticeById } from "@/lib/notices";
import { cn, studioType } from "@/lib/studioDesign";
import MarkNoticeReadOnView from "./MarkNoticeReadOnView";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  return new Date(iso + "Z").toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function NoticeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const db = getDb();
  const notice = getNoticeById(db, id);
  if (!notice) notFound();

  return (
    <AppPageShell title="공지사항" narrow className="mt-4">
      <MarkNoticeReadOnView noticeId={notice.id} />
      <Link href="/notifications" className={cn(studioType.caption, "text-violet-300 hover:underline")}>
        ← 알림 전체 보기
      </Link>
      <article className="mt-4 rounded-2xl border border-white/10 bg-[#131626] p-5">
        <h1 className="text-xl font-bold tracking-tight text-zinc-50">{notice.title}</h1>
        <p className={cn(studioType.caption, "mt-2")}>
          {notice.author_name} · {formatDate(notice.created_at)}
        </p>
        <div className={cn(studioType.body, "mt-5 whitespace-pre-wrap leading-relaxed text-zinc-200")}>
          {notice.content}
        </div>
      </article>
    </AppPageShell>
  );
}
