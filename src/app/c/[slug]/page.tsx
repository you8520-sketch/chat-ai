import { redirect, notFound } from "next/navigation";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 링크 공개 slug → 캐릭터 상세로 리다이렉트 */
export default async function ShareCharacterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = getDb();
  const row = db
    .prepare("SELECT id FROM characters WHERE share_slug=? AND visibility='link' AND moderation_status='approved'")
    .get(slug) as { id: number } | undefined;
  if (!row) notFound();
  redirect(`/character/${row.id}`);
}
