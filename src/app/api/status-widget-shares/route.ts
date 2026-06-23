import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  createStatusWidgetShareFromJson,
  createStatusWidgetShareFromPreset,
} from "@/lib/statusWidgetShares";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const presetId = Number(body.presetId ?? body.preset_id);

  let result: { share: { share_slug: string }; applyPath: string };

  if (Number.isFinite(presetId) && presetId > 0) {
    const created = createStatusWidgetShareFromPreset(user.id, presetId);
    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: 404 });
    }
    result = created;
  } else {
    const title = String(body.title ?? "");
    const widgetJson = String(body.widget_json ?? body.widgetJson ?? "").trim();
    const created = createStatusWidgetShareFromJson(user.id, title, widgetJson);
    if ("error" in created) {
      return NextResponse.json({ error: created.error }, { status: 400 });
    }
    result = created;
  }

  return NextResponse.json({
    ok: true,
    shareSlug: result.share.share_slug,
    applyPath: result.applyPath,
  });
}
