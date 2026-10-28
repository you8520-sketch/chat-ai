import { redirect } from "next/navigation";
import { canUseCreatorTools } from "@/lib/adultVerification";
import { getSessionUser } from "@/lib/auth";
import { resolveOfficialCharacterEditorAccess } from "@/lib/officialAdminAccess";
import { isAdminUser } from "@/lib/isAdminUser";
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

  if (!canUseCreatorTools(user)) {
    return (
      <AdultVerifyGate
        message="캐릭터 제작은 성인인증을 완료한 회원만 가능합니다."
        redirectTo="/create"
        demoLabel="데모: 인증 없이 제작 페이지 보기"
      />
    );
  }
  const db = getDb();
  const creatorIsPartner = isActivePartnerCreator(db, user.id);
  const editRow = editCharacterId == null ? null : db.prepare(
    "SELECT id, creator_id, official FROM characters WHERE id=?"
  ).get(editCharacterId) as { id: number; creator_id: number | null; official: number } | undefined;
  const adminCanSavePrivateDraft = isAdminUser(user) &&
    (editCharacterId == null || resolveOfficialCharacterEditorAccess(user, editRow) === "owner");

  return (
    <CreateCharacter
      editCharacterId={editCharacterId}
      viewerDisplayName={resolveViewerDisplayNameForUser(user)}
      creatorDisplayName={user.nickname}
      creatorIsPartner={creatorIsPartner}
      userId={user.id}
      adminCanSavePrivateDraft={adminCanSavePrivateDraft}
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
