import Link from "next/link";

import { notFound, redirect } from "next/navigation";

import { getDb } from "@/lib/db";

import { getSessionUser } from "@/lib/auth";
import { getPointBalance } from "@/lib/points";

import type { CharacterRow } from "@/components/CharacterCard";

import LikeFollowButtons from "@/components/LikeFollowButtons";

import CreatorGiftPanel, { ACTION_ROW_BUTTON_CLASS } from "@/components/CreatorGiftPanel";

import CharacterPublicPagePreview from "@/components/CharacterPublicPagePreview";
import { parseAssets } from "@/lib/characterAssets";
import ShareLinkBox from "@/components/ShareLinkBox";
import CharacterStartRow from "@/components/CharacterStartRow";
import ProfileCommentSection from "@/components/ProfileCommentSection";
import CommentsEnabledToggle from "@/components/CommentsEnabledToggle";
import { fetchCharacterChatSessions } from "@/lib/recentChats";
import { resolveViewerDisplayNameForUser } from "@/lib/viewerDisplayName";
import { replaceProfilePlaceholders } from "@/lib/userPlaceholder";
import {
  canAccessCharacter,
  sharePath,
  visibilityLabel,
  type CharacterVisibility,
  type ModerationStatus,
} from "@/lib/characterVisibility";
import {
  getCharacterCommentsEnabled,
  listProfileCommentsForViewer,
  mapProfileCommentForClient,
  canWriteCharacterProfileComment,
  getCommentWriteBlockedMessage,
} from "@/lib/profileComments";
import { checkCommentReportEligibility } from "@/lib/commentPolicy";
import { userHasReportedComment } from "@/lib/commentReports";
import { ensureDefaultPersona } from "@/lib/userPersonas";
import { isActivePartnerCreator } from "@/lib/partnerTier";



export const dynamic = "force-dynamic";



export default async function CharacterPage({ params }: { params: Promise<{ id: string }> }) {

  const { id } = await params;

  const db = getDb();

  const c = db.prepare("SELECT * FROM characters WHERE id=?").get(id) as
    | (CharacterRow & {
        description: string;
        greeting: string;
        images: string;
        creator_id: number | null;
        visibility: CharacterVisibility;
        moderation_status: ModerationStatus;
        moderation_note: string;
        share_slug: string | null;
        comments_enabled: number;
        creator_comment: string;
      })
    | undefined;

  if (!c) notFound();

  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/character/${id}`)}`);

  const access = canAccessCharacter(
    {
      id: c.id,
      creator_id: c.creator_id,
      visibility: c.visibility ?? "public",
      moderation_status: c.moderation_status ?? "approved",
      share_slug: c.share_slug,
      official: c.official,
    },
    user.id
  );
  if (!access.ok) {
    return (
      <div className="mx-auto mt-20 max-w-md rounded-2xl border border-amber-500/30 bg-[#131626] p-8 text-center">
        <p className="text-4xl">🔒</p>
        <h1 className="mt-3 text-xl font-black text-white">열람할 수 없습니다</h1>
        <p className="mt-2 text-sm text-gray-400">{access.reason}</p>
        {c.creator_id === user.id && c.moderation_status === "rejected" && c.moderation_note && (
          <p className="mt-3 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">검수 사유: {c.moderation_note}</p>
        )}
        <Link href="/" className="mt-6 inline-block text-sm text-violet-400 hover:underline">
          홈으로
        </Link>
      </div>
    );
  }

  const images: string[] = JSON.parse(c.images || "[]");
  const galleryAssets = parseAssets((c as { assets?: string }).assets);
  const assetImageUrls =
    galleryAssets.length > 0
      ? galleryAssets.map((a) => a.url)
      : images;

  if (c.nsfw === 1 && !user.is_adult) {
    redirect(`/verify?redirect=${encodeURIComponent(`/character/${id}`)}`);
  }



  const tags: string[] = JSON.parse(c.tags || "[]");

  const liked = user

    ? !!db.prepare("SELECT 1 FROM likes WHERE user_id=? AND character_id=?").get(user.id, c.id)

    : false;

  const creatorId = c.creator_id ?? 0;
  const creatorIsPartner = isActivePartnerCreator(db, creatorId);

  const followed = user

    ? !!db.prepare("SELECT 1 FROM follows WHERE user_id=? AND creator_id=?").get(user.id, creatorId)

    : false;

  let personaDisplayName = "";
  if (user) {
    personaDisplayName = resolveViewerDisplayNameForUser(user);
  }

  const tagline = replaceProfilePlaceholders(c.tagline, {
    personaName: user ? personaDisplayName : null,
    fallbackNickname: user?.nickname ?? "",
    characterName: c.name,
  });
  const description = replaceProfilePlaceholders(c.description, {
    personaName: user ? personaDisplayName : null,
    fallbackNickname: user?.nickname ?? "",
    characterName: c.name,
  });

  const characterBranches =
    user != null ? fetchCharacterChatSessions(getDb(), user.id, c.id) : [];

  const personaList = user ? ensureDefaultPersona(user.id, user.nickname) : [];
  const defaultPersonaId = personaList[0]?.id ?? null;

  const isOwner = c.creator_id === user?.id;
  const paidPoints = user ? getPointBalance(user.id).paid : 0;
  const canWriteCharacterComment =
    user != null &&
    canWriteCharacterProfileComment(db, user.id, c.id, c.creator_id);
  const commentWriteBlockedMessage =
    user != null && !canWriteCharacterComment
      ? getCommentWriteBlockedMessage(db, user.id, { characterId: c.id, isOwner })
      : "이 캐릭터와 대화한 후에만 댓글을 작성할 수 있습니다.";
  const canReportComment =
    user != null &&
    !isOwner &&
    checkCommentReportEligibility(db, user.id, { characterId: c.id }).ok;
  const commentsEnabled = getCharacterCommentsEnabled(db, c.id);
  const showComments = commentsEnabled || isOwner;
  const comments = showComments
    ? listProfileCommentsForViewer(db, "character", c.id, user?.id ?? null, c.creator_id).map((row) => ({
        ...mapProfileCommentForClient(row, isOwner),
        user_has_reported:
          user != null && user.id !== row.author_id
            ? userHasReportedComment(db, row.id, user.id)
            : false,
      }))
    : [];



  return (

    <div className="mt-8 space-y-4">

      {(c.official === 1 || c.nsfw === 1 || (c.official === 0 && c.creator_id) || c.moderation_status === "rejected") && (
        <div className="flex flex-wrap items-center gap-2">
          {c.official === 1 && <span className="rounded bg-violet-600 px-2 py-0.5 text-xs font-bold">공식</span>}
          {c.nsfw === 1 && <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-bold">19</span>}
          {c.official === 0 && c.creator_id && (
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-gray-300">
              {visibilityLabel(c.visibility ?? "private")}
            </span>
          )}
          {c.moderation_status === "rejected" && (
            <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">검수 반려</span>
          )}
        </div>
      )}

      {(c.visibility === "link" || (c.creator_id === user?.id && c.share_slug)) &&
        c.moderation_status === "approved" && (
          <ShareLinkBox path={sharePath(c)} label="링크 공개 URL (목록에는 안 뜸)" />
        )}

      <CharacterPublicPagePreview
        name={c.name}
        tagline={tagline}
        tags={tags}
        description={description}
        cardImageUrl={images[0] ?? ""}
        galleryAssets={galleryAssets.length > 0 ? galleryAssets : undefined}
        assetImageUrls={assetImageUrls}
        viewerIsCreator={isOwner}
        emoji={c.emoji}
        hue={c.hue}
        creatorName={c.creator_name}
        creatorIsPartner={creatorIsPartner}
        creatorComment={c.creator_comment}
        likes={c.likes}
        totalTurns={c.total_turns ?? 0}
        users={c.chats_count}
        collapsibleDescription
        creatorHref={c.creator_id ? `/creator/${c.creator_id}` : undefined}
        viewerDisplayName={user ? personaDisplayName : null}
        pagePath={`/character/${c.id}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <CharacterStartRow
          characterId={c.id}
          characterName={c.name}
          loggedIn={!!user}
          branches={characterBranches}
          personas={personaList}
          initialPersonaId={defaultPersonaId}
        />

        <LikeFollowButtons characterId={c.id} liked={liked} followed={followed} loggedIn={!!user} />

        {creatorId > 0 && !isOwner && (
          <CreatorGiftPanel
            recipientId={creatorId}
            recipientNickname={c.creator_name}
            paidPoints={paidPoints}
            loggedIn={!!user}
            loginRedirect={`/character/${c.id}`}
            buttonClassName={ACTION_ROW_BUTTON_CLASS}
            modalTitle={`@${c.creator_name}에게 포인트 선물`}
          />
        )}

        {isOwner && c.official === 0 && (
          <Link
            href={`/create?edit=${c.id}`}
            className="inline-flex items-center rounded-xl border border-violet-500/40 bg-violet-500/10 px-5 py-2.5 text-sm font-bold text-violet-200 transition hover:bg-violet-500/20"
          >
            수정
          </Link>
        )}
      </div>

      {isOwner && c.official === 0 && (
        <div className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
          <p className="text-sm font-bold text-violet-200">공개 설정</p>
          <div className="mt-3">
            <CommentsEnabledToggle
              scope="character"
              targetId={c.id}
              initialEnabled={c.comments_enabled !== 0}
              label="댓글 허용"
              description="OFF 시 다른 사용자는 이 캐릭터의 댓글을 보거나 작성할 수 없습니다."
            />
          </div>
        </div>
      )}

      {showComments && (
        <ProfileCommentSection
          targetType="character"
          targetId={c.id}
          comments={comments}
          loggedIn={!!user}
          canWrite={canWriteCharacterComment}
          canReport={canReportComment}
          isOwner={isOwner}
          ownerUserId={c.creator_id ?? undefined}
          writeBlockedMessage={commentWriteBlockedMessage}
        />
      )}

    </div>

  );

}

