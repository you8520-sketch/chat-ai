import Link from "next/link";
import "./creator-gallery.css";
import { notFound } from "next/navigation";
import CharacterCard, { type CharacterRow } from "@/components/CharacterCard";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import CreatorGiftPanel from "@/components/CreatorGiftPanel";
import OfficialCreatorBadge from "@/components/OfficialCreatorBadge";
import OfficialStudioBadge from "@/components/OfficialStudioBadge";
import ProfileCommentSection from "@/components/ProfileCommentSection";
import { shouldHideAdultListings } from "@/lib/adultVerification";
import { getSessionUser } from "@/lib/auth";
import { listableWhere } from "@/lib/characterVisibility";
import { getDb } from "@/lib/db";
import { getPointBalance } from "@/lib/points";
import { getGiftableBalance } from "@/lib/pointGifts";
import { isActivePartnerCreator } from "@/lib/partnerTier";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";
import {
  getCreatorCommentsEnabled,
  listProfileCommentsForViewer,
  mapProfileCommentForClient,
  canWriteCreatorProfileComment,
  getCommentWriteBlockedMessage,
} from "@/lib/profileComments";
import { userHasReportedComment } from "@/lib/commentReports";
import { cn, studioSurface, studioType } from "@/lib/studioDesign";
import { decorateCharactersWithCreatorTiers } from "@/lib/creatorTierBadges";
import { listCreatorNotices } from "@/lib/creatorNotices";

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
  const siteManaged = isSiteManagedUser(creator.id);
  const creatorIsPartner = !siteManaged && isActivePartnerCreator(db, creator.id);
  const creatorNotices = listCreatorNotices(creatorId);

  const user = await getSessionUser();
  const isOwner = user?.id === creatorId;
  const balance = user ? getPointBalance(user.id) : null;
  const giftable = user ? getGiftableBalance(user.id) : null;
  const paidPoints = balance?.paid ?? 0;
  const freePoints = balance?.free ?? 0;
  const blurNsfw = shouldHideAdultListings(user);
  const loggedIn = !!user;
  const commentsEnabled = getCreatorCommentsEnabled(db, creatorId);
  const showComments = commentsEnabled || isOwner;

  const characters = decorateCharactersWithCreatorTiers(
    db,
    db
      .prepare(
        siteManaged
          ? `SELECT * FROM characters
             WHERE creator_id=? AND ${listableWhere()}
             ORDER BY likes DESC, created_at DESC
             LIMIT 24`
          : `SELECT * FROM characters
             WHERE creator_id=? AND official=0 AND ${listableWhere()}
             ORDER BY likes DESC, created_at DESC
             LIMIT 24`
      )
      .all(creatorId) as CharacterRow[]
  );

  const charCount = db
    .prepare(
      siteManaged
        ? "SELECT COUNT(*) AS c FROM characters WHERE creator_id=?"
        : "SELECT COUNT(*) AS c FROM characters WHERE creator_id=? AND official=0"
    )
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

  // This is a display partition of the existing popularity query, not a curated selection.
  const popularWorks = characters.slice(0, 2);
  const moreWorks = characters.slice(2);
  const latestNotice = creatorNotices[0];
  const previousNotices = creatorNotices.slice(1);

  return (
    <div className="creator-gallery w-full max-w-5xl py-6 sm:py-10">
      <header className="creator-gallery__identity">
        <div className="flex min-w-0 flex-1 flex-col items-start">
          <p className="creator-gallery__eyebrow text-xs font-medium tracking-wider text-zinc-400">
            {siteManaged ? "공식 스튜디오" : "크리에이터"}
          </p>
          <div className="mt-3 flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 text-3xl font-semibold leading-tight tracking-tight text-zinc-50 [overflow-wrap:anywhere] sm:text-4xl">
              <span className="font-normal text-violet-300/60">@</span>{creator.nickname}
            </h1>
            {siteManaged ? <OfficialStudioBadge size="md" /> : null}
            {!siteManaged && creatorIsPartner ? <OfficialCreatorBadge size="md" /> : null}
          </div>
          <p className={cn(studioType.caption, "mt-3")}>
            제작 캐릭터 <span className="tabular-nums text-zinc-200">{Number(charCount.c).toLocaleString()}</span>개
          </p>
          {creator.creator_profile_html && (
            <div
              className="creator-comment-html creator-gallery__html mt-5 max-w-2xl text-sm leading-7 text-zinc-300"
              dangerouslySetInnerHTML={{ __html: creator.creator_profile_html }}
            />
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isOwner && !siteManaged && (
            <Link href="/creator" className="creator-gallery__action">
              크리에이터 대시보드 <span aria-hidden>↗</span>
            </Link>
          )}
          {!isOwner && !siteManaged && (
            <CreatorGiftPanel
              recipientId={creatorId}
              recipientNickname={creator.nickname}
              paidPoints={paidPoints}
              freePoints={freePoints}
              giftableFreePoints={giftable?.giftableFree}
              loggedIn={!!user}
              loginRedirect={`/creator/${creatorId}`}
              buttonClassName="creator-gallery__action"
            />
          )}
        </div>
      </header>

      {(latestNotice || creator.creator_notice_html) && (
        <section id="creator-notices" aria-labelledby="creator-notices-title" className="creator-gallery__notices mt-8">
          <h2 id="creator-notices-title" className={cn(studioType.sectionTitle, "mb-4")}>
            제작자 공지
          </h2>
          {latestNotice ? (
            <>
              <details className="creator-gallery__notice" open={latestNotice.content.length <= 280}>
                <summary>
                  <span className="creator-gallery__notice-meta">
                    <span className="text-xs font-medium text-violet-300">최근 소식</span>
                    <time dateTime={latestNotice.created_at.replace(" ", "T") + "Z"} className={studioType.counter}>
                      {latestNotice.created_at.slice(0, 10).replaceAll("-", ".")}
                    </time>
                  </span>
                  <h3 className="mt-2 text-base font-semibold leading-6 text-zinc-100">{latestNotice.title}</h3>
                  {latestNotice.content.length > 280 && (
                    <span className="creator-gallery__notice-preview mt-2 block text-sm leading-7 text-zinc-300">
                      {latestNotice.content.slice(0, 160)}…
                    </span>
                  )}
                  <span className="creator-gallery__disclosure-label mt-2 inline-flex min-h-11 items-center text-xs text-zinc-400">
                    <span className="creator-gallery__when-closed">공지 전문 읽기 ＋</span>
                    <span className="creator-gallery__when-open">접기 −</span>
                  </span>
                </summary>
                <p className="whitespace-pre-wrap pb-2 text-sm leading-7 text-zinc-300">{latestNotice.content}</p>
              </details>
              {previousNotices.length > 0 && (
                <details className="creator-gallery__archive mt-3">
                  <summary className="creator-gallery__action w-fit">이전 공지 {previousNotices.length}개</summary>
                  <div className="mt-2 divide-y divide-white/10">
                    {previousNotices.map((notice) => (
                      <details key={notice.id} className="creator-gallery__notice py-3">
                        <summary className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <h3 className="text-sm font-medium text-zinc-200">{notice.title}</h3>
                          <time dateTime={notice.created_at.replace(" ", "T") + "Z"} className={studioType.counter}>
                            {notice.created_at.slice(0, 10).replaceAll("-", ".")}
                          </time>
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap pb-2 text-sm leading-7 text-zinc-300">{notice.content}</p>
                      </details>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <div
              className="creator-comment-html creator-gallery__html text-sm leading-7 text-zinc-300"
              dangerouslySetInnerHTML={{ __html: creator.creator_notice_html }}
            />
          )}
        </section>
      )}

      <section id="creator-works" aria-labelledby="creator-works-title" className="mt-10 sm:mt-12">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="creator-works-title" className="text-xl font-semibold tracking-tight text-zinc-50">인기 작품</h2>
          {characters.length > 0 && <p className={studioType.caption}>공개 작품 · 좋아요순</p>}
        </div>
        {popularWorks.length > 0 ? (
          <>
            <div className="grid max-w-xl grid-cols-2 gap-3 sm:gap-5">
              {popularWorks.map((c) => (
                <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
              ))}
            </div>
            {moreWorks.length > 0 && (
              <div className="mt-9 sm:mt-10">
                <h3 className={studioType.sectionTitle}>더 둘러보기</h3>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">
                  {moreWorks.map((c) => (
                    <CharacterCard key={c.id} c={c} blurNsfw={blurNsfw} loggedIn={loggedIn} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="border-y border-white/10 py-10">
            <p className={studioType.body}>아직 공개된 작품이 없습니다.</p>
            <p className={cn(studioType.caption, "mt-2")}>새로운 이야기가 이곳에 채워질 예정입니다.</p>
          </div>
        )}
      </section>

      {(isOwner || showComments) && (
        <section aria-label="제작자와 이야기 나누기" className="creator-gallery__community mt-12 border-t border-white/10 pt-7">
          <h2 className={studioType.sectionTitle}>이야기 나누기</h2>
          {isOwner && (
            <div className={cn(studioSurface.cardMuted, "mt-4 p-4")}>
              <CommentsEnabledToggle
                scope="creator"
                initialEnabled={creator.creator_comments_enabled !== 0}
                label="크리에이터 댓글 허용"
                description="OFF 시 다른 사용자는 내 프로필 댓글을 보거나 작성할 수 없습니다."
              />
            </div>
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
              currentUserId={user?.id}
              writeBlockedMessage={commentWriteBlockedMessage}
            />
          )}
        </section>
      )}
    </div>
  );
}
