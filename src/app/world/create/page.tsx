import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateWorld from "@/components/CreateWorld";

export const dynamic = "force-dynamic";

export default async function WorldCreatePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/world/create");

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="세계관 제작은 성인인증을 완료한 회원만 가능합니다."
        redirectTo="/world/create"
        demoLabel="데모: 인증 없이 세계관 제작 보기"
      />
    );
  }

  return <CreateWorld />;
}
