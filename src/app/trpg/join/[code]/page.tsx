import Link from "next/link";
import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canAccessTrpg } from "@/lib/trpg/access";
import { joinTrpgCampaign } from "@/lib/trpg/engine";
import { resolveTrpgHumanPersona } from "@/lib/trpg/hostPersona";
import { parseTrpgInviteInput } from "@/lib/trpg/invite";

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

  let campaignId: number | null = null;
  let error = "";
  try {
    const persona = resolveTrpgHumanPersona(user.id, user.nickname, null);
    campaignId = joinTrpgCampaign(getDb(), {
      code,
      userId: user.id,
      nickname: user.nickname,
      persona,
    });
  } catch (e) {
    error = e instanceof Error && e.message.trim() ? e.message : "참가하지 못했습니다.";
  }
  if (campaignId) redirect(`/trpg/${campaignId}`);

  return (
    <AppPageShell title="TRPG 입장" description={error} narrow>
      <Link href="/trpg" className="text-sm font-semibold text-violet-300">
        TRPG 로비로
      </Link>
    </AppPageShell>
  );
}
