import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { importStatusWidgetShareToUserPresets } from "@/lib/statusWidgetShares";
import { getStatusWidgetPresetById } from "@/lib/statusWidgetPresets";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title : undefined;

  const result = importStatusWidgetShareToUserPresets(user.id, slug, title);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  const preset = getStatusWidgetPresetById(user.id, result.presetId);
  return NextResponse.json({ ok: true, presetId: result.presetId, preset });
}
