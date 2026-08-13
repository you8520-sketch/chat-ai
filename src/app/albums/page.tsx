import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppPageShell } from "@/components/AppPageShell";
import { getSessionUser } from "@/lib/auth";
import AlbumsClient from "./AlbumsClient";

export const dynamic = "force-dynamic";

export default async function AlbumsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/albums");

  return (
    <AppPageShell
      title="생성 이미지 앨범"
      description="일반 캐릭터 채팅 이미지와 TRPG 캠페인 일러스트를 나눠 볼 수 있습니다."
      className="pb-16"
    >
      <Suspense fallback={<p className="text-sm text-zinc-500">앨범을 불러오는 중…</p>}>
        <AlbumsClient />
      </Suspense>
    </AppPageShell>
  );
}
