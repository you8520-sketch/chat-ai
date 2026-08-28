import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { resolveViewerDisplayNameForUser } from "@/lib/viewerDisplayName";
import { isActivePartnerCreator } from "@/lib/partnerTier";
import AdultVerifyGate from "@/components/AdultVerifyGate";
import CreateCharacter from "@/components/CreateCharacter";

export const dynamic = "force-dynamic";

export default async function CreatePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; kind?: string; worldId?: string; worldBorrowId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/create");

  const { edit: editParam, kind, worldId: worldIdParam, worldBorrowId: worldBorrowIdParam } =
    await searchParams;
  const editId = editParam ? Number(editParam) : null;
  const editCharacterId =
    editId != null && Number.isFinite(editId) && editId > 0 ? editId : null;
  const initialWorldId = worldIdParam ? Number(worldIdParam) : null;
  const initialWorldBorrowId = worldBorrowIdParam ? Number(worldBorrowIdParam) : null;

  if (!user.is_adult) {
    return (
      <AdultVerifyGate
        message="캐릭터 제작은 성인인증을 완료한 회원만 가능합니다."
        redirectTo="/create"
        demoLabel="데모: 인증 없이 제작 페이지 보기"
      />
    );
  }
  const creatorIsPartner = isActivePartnerCreator(getDb(), user.id);

  return (
    <CreateCharacter
      editCharacterId={editCharacterId}
      viewerDisplayName={resolveViewerDisplayNameForUser(user)}
      creatorDisplayName={user.nickname}
      creatorIsPartner={creatorIsPartner}
      userId={user.id}
      initialContentKind={kind === "simulation" ? "simulation" : "character"}
      initialWorldId={
        initialWorldId != null && Number.isFinite(initialWorldId) && initialWorldId > 0
          ? initialWorldId
          : null
      }
      initialWorldBorrowId={
        initialWorldBorrowId != null &&
        Number.isFinite(initialWorldBorrowId) &&
        initialWorldBorrowId > 0
          ? initialWorldBorrowId
          : null
      }
    />
  );
}
