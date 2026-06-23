import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  listApplicationsForUser,
  listEligibleCharacters,
  submitCreateMigrationApplication,
} from "@/lib/createMigrationEvent";
import { CREATE_MIGRATION_EVENT_REWARD } from "@/lib/plans";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const db = getDb();
  const characters = listEligibleCharacters(db, user.id);
  const applications = listApplicationsForUser(db, user.id);
  const applicationByCharacterId = Object.fromEntries(
    applications.map((a) => [a.character_id, a])
  );

  return NextResponse.json({
    reward: CREATE_MIGRATION_EVENT_REWARD,
    characters: characters.map((c) => ({
      ...c,
      application: applicationByCharacterId[c.id] ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const characterId = Number(body.characterId);
  if (!Number.isFinite(characterId) || characterId <= 0) {
    return NextResponse.json({ error: "캐릭터를 선택하세요." }, { status: 400 });
  }

  const result = submitCreateMigrationApplication(getDb(), user.id, characterId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  return NextResponse.json({ ok: true, applicationId: result.applicationId });
}
