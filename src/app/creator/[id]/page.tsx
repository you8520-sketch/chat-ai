import Link from "next/link";
import { notFound } from "next/navigation";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import CreatorGiftPanel from "@/components/CreatorGiftPanel";
import ProfileCommentSection from "@/components/ProfileCommentSection";
import { getSessionUser } from "@/lib/auth";
import { listableWhere } from "@/lib/characterVisibility";
import { getDb } from "@/lib/db";
import { getPointBalance } from "@/lib/points";
import {
  getCreatorCommentsEnabled,
  listProfileCommentsForViewer,
  mapProfileCommentForClient,
} from "@/lib/profileComments";

export const dynamic = "force-dynamic";

export default async function CreatorProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const creatorId = Number(id);
  if (!Number.isFinite(creatorId) || creatorId <= 0) notFound();

  const db = getDb();
  const creator = db
    .prepare("SELECT id, nickname, creator_comments_enabled FROM users WHERE id=?")
    .get(creatorId) as { id: number; nickname: string; creator_comments_enabled: number } | undefined;
  if (!creator) notFound();

  const user = await getSessionUser();
  const isOwner = user?.id === creatorId;
  const paidPoints = user ? getPointBalance(user.id).paid : 0;
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
  const loggedIn = !!user;
  const commentsEnabled = getCreatorCommentsEnabled(db, creatorId);
  const showComments = commentsEnabled || isOwner;

  const characters = db
    .prepare(
      `SELECT * FROM characters
       WHERE creator_id=? AND official=0 AND ${listableWhere()}
       ORDER BY likes DESC, created_at DESC
       LIMIT 24`
    )
    .all(creatorId) as CharacterRow[];

  const charCount = db
    .prepare("SELECT COUNT(*) AS c FROM characters WHERE creator_id=? AND official=0")
    .get(creatorId) as { c: number };

  const comments = showComments
    ? listProfileCommentsForViewer(db, "creator", creatorId, user?.id ?? null, creatorId).map((row) =>
        mapProfileCommentForClient(row, isOwner)
      )
    : [];

  const canWriteComment = !!user && (isOwner || commentsEnabled);

  return (
    <div className="mx-auto mt-8 max-w-4xl px-4">
      <div className="rounded-2xl border border-white/5 bg-[#131626] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">크리에이터</p>
            <h1 className="mt-1 text-2xl font-black text-white">@{creator.nickname}</h1>
            <p className="mt-2 text-sm text-gray-300">
              캐릭터 {Number(charCount.c).toLocaleString()}개
            </p>
            {isOwner && (
              <Link
                href="/creator"
                className="mt-3 inline-block text-xs text-violet-400 hover:underline"
              >
                크리에이터 대시보드 →
              </Link>
            )}
          </div>
          {!isOwner && (
            <CreatorGiftPanel
              recipientId={creatorId}
              recipientNickname={creator.nickname}
              paidPoints={paidPoints}
              loggedIn={!!user}
              loginRedirect={`/creator/${creatorId}`}
            />
          )}
        </div>
      </div>

      {isOwner && (
        <div className="mt-4 rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
          <p className="text-sm font-bold text-violet-200">댓글 설정</p>
          <div className="mt-3">
            <CommentsEnabledToggle
              scope="creator"
              initialEnabled={creator.creator_comments_enabled !== 0}
              label="크리에이터 댓글 허용"
              description="OFF 시 다른 사용자는 내 프로필 댓글을 보거나 작성할 수 없습니다."
            />
          </div>
        </div>
      )}

      {characters.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-bold text-gray-200">공개 캐릭터</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {characters.map((c) => (
              <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
            ))}
          </div>
        </section>
      )}

      {showComments && (
        <ProfileCommentSection
          targetType="creator"
          targetId={creatorId}
          comments={comments}
          loggedIn={!!user}
          canWrite={canWriteComment}
          isOwner={isOwner}
          ownerUserId={creatorId}
        />
      )}
    </div>
  );
}
