import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { checkCommentWriteEligibility } from "@/lib/commentPolicy";
import { submitProfileComment } from "@/lib/commentSubmit";
import {
  isProfileCommentsEnabled,
  isUserCommentBanned,
  listProfileCommentsForViewer,
  mapProfileCommentForClient,
  resolveTargetOwnerId,
  type ProfileCommentTarget,
} from "@/lib/profileComments";
import { userHasReportedComment } from "@/lib/commentReports";

const MAX_CONTENT = 2000;

function parseTargetType(raw: unknown): ProfileCommentTarget | null {
  if (raw === "creator" || raw === "character") return raw;
  return null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const targetType = parseTargetType(searchParams.get("targetType"));
  const targetId = Number(searchParams.get("targetId"));
  if (!targetType || !Number.isFinite(targetId) || targetId <= 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const db = getDb();
  const user = await getSessionUser();
  const ownerId = resolveTargetOwnerId(db, targetType, targetId);
  if (ownerId == null && targetType === "character") {
    return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  }
  if (targetType === "creator") {
    const exists = db.prepare("SELECT id FROM users WHERE id=?").get(targetId);
    if (!exists) return NextResponse.json({ error: "크리에이터를 찾을 수 없습니다." }, { status: 404 });
  }

  const enabled = isProfileCommentsEnabled(db, targetType, targetId);
  const isOwner = user != null && ownerId != null && user.id === ownerId;

  if (!enabled && !isOwner) {
    return NextResponse.json({ enabled: false, comments: [] });
  }

  const comments =
    enabled || isOwner
      ? listProfileCommentsForViewer(db, targetType, targetId, user?.id ?? null, ownerId).map((c) => ({
          ...mapProfileCommentForClient(c, isOwner),
          user_has_reported:
            user != null && user.id !== c.author_id
              ? userHasReportedComment(db, c.id, user.id)
              : false,
        }))
      : [];

  return NextResponse.json({
    enabled,
    comments,
    ownerPreview: isOwner && !enabled,
    isOwner,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (isUserCommentBanned(getDb(), user.id)) {
    return NextResponse.json({ error: "댓글 작성이 제한된 계정입니다." }, { status: 403 });
  }

  const body = await req.json();
  const targetType = parseTargetType(body.targetType);
  const targetId = Number(body.targetId);
  const content = typeof body.content === "string" ? body.content.trim().slice(0, MAX_CONTENT) : "";
  const isPrivate = body.isPrivate === true;

  if (!targetType || !Number.isFinite(targetId) || targetId <= 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  if (!content) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

  const db = getDb();
  const ownerId = resolveTargetOwnerId(db, targetType, targetId);
  if (ownerId == null && targetType === "character") {
    return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
  }
  if (targetType === "creator") {
    const exists = db.prepare("SELECT id FROM users WHERE id=?").get(targetId);
    if (!exists) return NextResponse.json({ error: "크리에이터를 찾을 수 없습니다." }, { status: 404 });
  }

  const isOwner = ownerId != null && user.id === ownerId;
  const enabled = isProfileCommentsEnabled(db, targetType, targetId);

  if (isPrivate && !isOwner) {
    return NextResponse.json({ error: "비공개 댓글은 크리에이터만 작성할 수 있습니다." }, { status: 403 });
  }

  if (!enabled && !isOwner) {
    return NextResponse.json({ error: "댓글이 비활성화되어 있습니다." }, { status: 403 });
  }

  if (!isOwner) {
    const eligibility = checkCommentWriteEligibility(db, user.id, {
      characterId: targetType === "character" ? targetId : undefined,
    });
    if (!eligibility.ok) {
      return NextResponse.json({ error: eligibility.message }, { status: 403 });
    }
  }

  const result = await submitProfileComment({
    targetType,
    targetId,
    authorId: user.id,
    authorName: user.nickname,
    content,
    isPrivate,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, commentId: result.commentId });
}
