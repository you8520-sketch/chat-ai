import { notFound } from "next/navigation";

import WidgetApplyClient from "@/components/WidgetApplyClient";
import { getSessionUser } from "@/lib/auth";
import { parseStatusWidgetJson } from "@/lib/statusWidget";
import { getStatusWidgetShareBySlug } from "@/lib/statusWidgetShares";

export const dynamic = "force-dynamic";

export default async function WidgetApplyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const share = getStatusWidgetShareBySlug(slug);
  if (!share) notFound();

  const widget = parseStatusWidgetJson(share.widgetJson);
  if (!widget) notFound();

  const user = await getSessionUser();

  return (
    <main className="min-h-screen bg-[#0a0d18]">
      <WidgetApplyClient
        shareSlug={share.shareSlug}
        initialTitle={share.title}
        authorNickname={share.authorNickname}
        widget={widget}
        loggedIn={Boolean(user)}
      />
    </main>
  );
}
