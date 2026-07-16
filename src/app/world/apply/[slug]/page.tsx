import { notFound } from "next/navigation";

import WorldApplyClient from "@/components/WorldApplyClient";
import { getSessionUser } from "@/lib/auth";
import { getWorldShareBySlug } from "@/lib/worldShares";

export const dynamic = "force-dynamic";

export default async function WorldApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const share = getWorldShareBySlug(slug);
  if (!share) notFound();

  const user = await getSessionUser();

  return (
    <main className="min-h-screen bg-[#0a0d18]">
      <WorldApplyClient
        shareSlug={share.shareSlug}
        initialName={share.name}
        summary={share.summary}
        content={share.content}
        authorNickname={share.authorNickname}
        loggedIn={Boolean(user)}
      />
    </main>
  );
}
