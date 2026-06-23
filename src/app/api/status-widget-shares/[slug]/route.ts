import { NextResponse } from "next/server";
import { getStatusWidgetShareBySlug } from "@/lib/statusWidgetShares";
import { parseStatusWidgetJson } from "@/lib/statusWidget";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const share = getStatusWidgetShareBySlug(slug);
  if (!share) {
    return NextResponse.json({ error: "공유 링크를 찾을 수 없습니다." }, { status: 404 });
  }
  const widget = parseStatusWidgetJson(share.widgetJson);
  if (!widget) {
    return NextResponse.json({ error: "위젯 데이터가 올바르지 않습니다." }, { status: 500 });
  }
  return NextResponse.json({
    shareSlug: share.shareSlug,
    title: share.title,
    widgetJson: share.widgetJson,
    authorNickname: share.authorNickname,
    createdAt: share.createdAt,
    widget,
  });
}
