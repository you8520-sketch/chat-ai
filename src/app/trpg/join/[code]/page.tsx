import Link from "next/link";
import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessTrpg } from "@/lib/trpg/access";
import { peekTrpgInvite } from "@/lib/trpg/engine";
import { parseTrpgInviteInput } from "@/lib/trpg/invite";
import { ensureDefaultPublicPersona } from "@/lib/userPersonas";
import TrpgJoinClient from "./TrpgJoinClient";

export const dynamic = "force-dynamic";

export default async function TrpgJoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const raw = (await params).code;
  const code = parseTrpgInviteInput(raw) || parseTrpgInviteInput(decodeURIComponent(raw));
  const joinPath = code ? `/trpg/join/${code}` : "/trpg";
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=${encodeURIComponent(joinPath)}`);
  if (!canAccessTrpg(user)) redirect("/");
  if (!code) {
    return (
      <AppPageShell title="TRPG 입장" description="초대 링크가 올바르지 않습니다." narrow>
        <Link href="/trpg" className="text-sm font-semibold text-violet-300">
          TRPG 로비로
        </Link>
      </AppPageShell>
    );
  }

  const peek = peekTrpgInvite(getDb(), { code, userId: user.id });
  if (!peek) {
    return (
      <AppPageShell title="TRPG 입장" description="초대 코드를 찾을 수 없습니다." narrow>
        <Link href="/trpg" className="text-sm font-semibold text-violet-300">
          TRPG 로비로
        </Link>
      </AppPageShell>
    );
  }
  if (peek.alreadyJoined) redirect(`/trpg/${peek.campaignId}`);
  if (!peek.canJoin) {
    return (
      <AppPageShell title="TRPG 입장" description="이미 시작됐거나 정원이 가득합니다." narrow>
        <Link href="/trpg" className="text-sm font-semibold text-violet-300">
          TRPG 로비로
        </Link>
      </AppPageShell>
    );
  }

  const personas = ensureDefaultPublicPersona(user.id, user.nickname);
  return (
    <TrpgJoinClient
      code={code}
      title={peek.title}
      remainingSlots={peek.remainingSlots}
      personas={personas}
    />
  );
}
