import { NextResponse } from "next/server";
import { requireAdminRequest, requireAdminUser } from "@/lib/adminAuth";
import { addInquiryStaffReply, getPostById, listCommentsForPost, listInquiriesForAdmin } from "@/lib/boardPosts";
import { getDb } from "@/lib/db";
import { notifyInquiryReply } from "@/lib/userNotifications";

export async function GET(req: Request) {
  if (!(await requireAdminRequest(req))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const db = getDb();
  const inquiries = listInquiriesForAdmin(db);
  const commentsByPost: Record<number, ReturnType<typeof listCommentsForPost>> = {};
  for (const row of inquiries) {
    commentsByPost[row.id] = listCommentsForPost(db, row.id);
  }

  return NextResponse.json({ inquiries, commentsByPost });
}

export async function POST(req: Request) {
  const admin = await requireAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await req.json();
  const postId = Number(body.postId);
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!Number.isFinite(postId) || postId <= 0) {
    return NextResponse.json({ error: "유효하지 않은 문의입니다." }, { status: 400 });
  }
  if (!content) {
    return NextResponse.json({ error: "답변 내용을 입력하세요." }, { status: 400 });
  }
  if (content.length > 5000) {
    return NextResponse.json({ error: "답변은 5,000자 이내로 입력하세요." }, { status: 400 });
  }

  const db = getDb();
  const post = getPostById(db, postId);
  if (!post || post.board !== "inquiry") {
    return NextResponse.json({ error: "문의를 찾을 수 없습니다." }, { status: 404 });
  }

  const commentId = addInquiryStaffReply(db, postId, admin.id, content);
  if (post.author_id) {
    notifyInquiryReply(db, post.author_id, postId, post.title, content);
  }

  return NextResponse.json({ ok: true, commentId });
}
