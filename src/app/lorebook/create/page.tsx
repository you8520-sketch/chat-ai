import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateKeywordLorebook from "@/components/CreateKeywordLorebook";

export const dynamic = "force-dynamic";

export default async function LorebookCreatePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/lorebook/create");

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="로어북 제작은 성인인증을 완료한 회원만 이용할 수 있습니다."
        redirectTo="/lorebook/create"
        demoLabel="데모: 인증 없이 로어북 제작 보기"
      />
    );
  }

  return <CreateKeywordLorebook />;
}
