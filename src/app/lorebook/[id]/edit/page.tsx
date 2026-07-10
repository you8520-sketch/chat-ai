import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateKeywordLorebook from "@/components/CreateKeywordLorebook";

export const dynamic = "force-dynamic";

export default async function LorebookEditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  const { id } = await params;
  const lorebookId = Number(id);
  if (!user) redirect(`/login?redirect=/lorebook/${id}/edit`);
  if (!Number.isFinite(lorebookId)) redirect("/studio");

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="로어북 수정은 성인인증을 완료한 회원만 이용할 수 있습니다."
        redirectTo={`/lorebook/${id}/edit`}
        demoLabel="데모: 인증 없이 수정"
      />
    );
  }

  return <CreateKeywordLorebook lorebookId={lorebookId} />;
}
