import type { Metadata } from "next";

import StatusWidgetCommunity from "@/components/StatusWidgetCommunity";
import { getSessionUser } from "@/lib/auth";
import { listPublicStatusWidgetShares } from "@/lib/statusWidgetShares";
import { parseStatusWidgetShareSort } from "@/lib/statusWidgetShareTypes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "공유 상태창",
};

export default async function WidgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const { sort } = await searchParams;
  const mode = parseStatusWidgetShareSort(sort);
  const items = listPublicStatusWidgetShares(mode);
  const user = await getSessionUser();

  return (
    <div className="pb-8">
      <h1 className="text-xl font-bold text-white">공유 상태창</h1>
      <p className="mt-2 text-sm text-zinc-400">
        사람들이 커뮤니티에 공개한 상태창입니다. 인기는 서로 다른 사람이 가져온 횟수입니다.
      </p>
      <div className="mt-6">
        <StatusWidgetCommunity items={items} sort={mode} viewerUserId={user?.id ?? null} />
      </div>
    </div>
  );
}
