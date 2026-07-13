import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { userHasCreatedCharacters } from "@/lib/creatorAccess";
import {
  createCreatorNotice,
  deleteCreatorNotice,
  listCreatorNotices,
} from "@/lib/creatorNotices";

function creatorForbidden() {
  return NextResponse.json(
    { error: "캐릭터를 제작한 크리에이터만 이용할 수 있습니다." },
    { status: 403 }
  );
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) return creatorForbidden();
  return NextResponse.json({ ok: true, notices: listCreatorNotices(user.id) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) return creatorForbidden();

  try {
    const body = await req.json();
    const notice = createCreatorNotice(user.id, body);
    return NextResponse.json({ ok: true, notice });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "공지 저장 실패" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!userHasCreatedCharacters(user.id)) return creatorForbidden();

  const body = await req.json();
  const ok = deleteCreatorNotice(user.id, Number(body.id));
  if (!ok) return NextResponse.json({ error: "삭제할 공지를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
