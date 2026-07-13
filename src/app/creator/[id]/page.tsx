import Link from "next/link";
import { notFound } from "next/navigation";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import CreatorGiftPanel from "@/components/CreatorGiftPanel";
import OfficialCreatorBadge from "@/components/OfficialCreatorBadge";
import ProfileCommentSection from "@/components/ProfileCommentSection";
import { getSessionUser } from "@/lib/auth";
import { listableWhere } from "@/lib/characterVisibility";
import { getDb } from "@/lib/db";
import { getPointBalance } from "@/lib/points";
import { isActivePartnerCreator } from "@/lib/partnerTier";
import {
  getCreatorCommentsEnabled,
  listProfileCommentsForViewer,
  mapProfileCommentForClient,
  canWriteCreatorProfileComment,
  getCommentWriteBlockedMessage,
} from "@/lib/profileComments";
import { checkCommentReportEligibility } from "@/lib/commentPolicy";
import { userHasReportedComment } from "@/lib/commentReports";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";

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
    .prepare("SELECT id, nickname, creator_comments_enabled, creator_profile_html, creator_notice_html FROM users WHERE id=?")
    .get(creatorId) as
    | {
        id: number;
        nickname: string;
        creator_comments_enabled: number;
        creator_profile_html: string;
        creator_notice_html: string;
      }
    | undefined;
  if (!creator) notFound();
  const creatorIsPartner = isActivePartnerCreator(db, creator.id);

  const user = await getSessionUser();
  const isOwner = user?.id === creatorId;
  const paidPoints = user ? getPointBalance(user.id).paid : 0;
  const blurNsfw = !user?.is_adult || !user?.nsfw_on;
  const loggedIn = !!user;
  const commentsEnabled = getCreatorCommentsEnabled(db, creatorId);
  const showComments = commentsEnabled || isOwner;

  const characters = decorateCharactersWithCreatorTiers(
    db,
    db
      .prepare(
        `SELECT * FROM characters
         WHERE creator_id=? AND official=0 AND ${listableWhere()}
         ORDER BY likes DESC, created_at DESC
         LIMIT 24`
      )
      .all(creatorId) as CharacterRow[]
  );

  const charCount = db
    .prepare("SELECT COUNT(*) AS c FROM characters WHERE creator_id=? AND official=0")
    .get(creatorId) as { c: number };

  const comments = showComments
    ? listProfileCommentsForViewer(db, "creator", creatorId, user?.id ?? null, creatorId).map((row) => ({
        ...mapProfileCommentForClient(row, isOwner),
        user_has_reported:
          user != null && user.id !== row.author_id
            ? userHasReportedComment(db, row.id, user.id)
            : false,
      }))
    : [];

  const canWriteComment =
    user != null && canWriteCreatorProfileComment(db, user.id, creatorId);
  const commentWriteBlockedMessage =
    user != null && !canWriteComment
      ? getCommentWriteBlockedMessage(db, user.id, { isOwner })
      : "댓글을 작성할 수 없습니다.";
  const canReportComment =
    user != null && !isOwner && checkCommentReportEligibility(db, user.id, {}).ok;

  return (
    <div className="mx-auto mt-8 max-w-4xl px-4">
      <div className={cn(studioSurface.card, "p-6")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">크리에이터</p>
            <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-zinc-50">
              @{creator.nickname}
              {creatorIsPartner && <OfficialCreatorBadge size="md" />}
            </h1>
            <p className={cn(studioType.body, "mt-2")}>
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


      {(creator.creator_profile_html || creator.creator_notice_html) && (
        <section className="mt-4 grid gap-4 md:grid-cols-[1.5fr_1fr]">
          {creator.creator_profile_html && (
            <div className={cn(studioSurface.card, "overflow-hidden p-5")}>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-violet-300 shadow-[0_0_14px_rgba(167,139,250,0.8)]" />
                <h2 className={studioType.sectionTitle}>크리에이터 소개</h2>
              </div>
              <div
                className="creator-comment-html text-sm leading-7 text-zinc-200"
                dangerouslySetInnerHTML={{ __html: creator.creator_profile_html }}
              />
            </div>
          )}

          {creator.creator_notice_html && (
            <div className={cn(studioSurface.card, "overflow-hidden border-amber-300/20 bg-amber-300/[0.045] p-5")}>
              <div className="mb-3 flex items-center gap-2">
                <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-[11px] font-black text-amber-100">
                  NOTICE
                </span>
                <h2 className={studioType.sectionTitle}>제작자 공지</h2>
              </div>
              <div
                className="creator-comment-html text-sm leading-7 text-zinc-200"
                dangerouslySetInnerHTML={{ __html: creator.creator_notice_html }}
              />
            </div>
          )}
        </section>
      )}

      {isOwner && (
        <div className={cn(studioSurface.card, "mt-4 p-5")}>
          <p className={studioType.sectionTitle}>댓글 설정</p>
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
          <h2 className={studioType.sectionTitle}>공개 캐릭터</h2>
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
          canReport={canReportComment}
          isOwner={isOwner}
          ownerUserId={creatorId}
          writeBlockedMessage={commentWriteBlockedMessage}
        />
      )}
    </div>
  );
}
