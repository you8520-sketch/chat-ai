import { redirect } from "next/navigation";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateSimulation from "@/components/CreateSimulation";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SimulationCreatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/simulation/create");

  const editRaw = (await searchParams).edit;
  const editNumber = Number(editRaw);
  const editId = Number.isInteger(editNumber) && editNumber > 0 ? editNumber : null;

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="시뮬레이션 제작은 성인인증을 완료한 회원만 가능합니다."
        redirectTo="/simulation/create"
        demoLabel="데모: 인증 없이 시뮬레이션 제작 보기"
      />
    );
  }

  return <CreateSimulation userId={user.id} editSimulationId={editId} />;
}
