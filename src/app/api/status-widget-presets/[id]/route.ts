import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  deleteStatusWidgetPreset,
  getStatusWidgetPresetById,
  sanitizeStatusWidgetPresetTitle,
  updateStatusWidgetPreset,
  validateStatusWidgetPresetInput,
} from "@/lib/statusWidgetPresets";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const presetId = Number((await ctx.params).id);
  if (!Number.isFinite(presetId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const prev = getStatusWidgetPresetById(user.id, presetId);
  if (!prev) return NextResponse.json({ error: "상태창을 찾을 수 없습니다." }, { status: 404 });

  const body = await req.json();
  const title = body.title != null ? sanitizeStatusWidgetPresetTitle(String(body.title)) : undefined;
  const widgetJson =
    body.widget_json != null || body.widgetJson != null
      ? String(body.widget_json ?? body.widgetJson ?? "").trim()
      : undefined;
  const check = validateStatusWidgetPresetInput(
    title ?? prev.title,
    widgetJson ?? prev.widget_json
  );
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const preset = updateStatusWidgetPreset(user.id, presetId, {
    title,
    widget_json: widgetJson,
  });
  if (!preset) {
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, preset });
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const presetId = Number((await ctx.params).id);
  if (!Number.isFinite(presetId)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const ok = deleteStatusWidgetPreset(user.id, presetId);
  if (!ok) return NextResponse.json({ error: "상태창을 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
