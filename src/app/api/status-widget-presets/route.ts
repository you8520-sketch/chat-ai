import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  createStatusWidgetPreset,
  listStatusWidgetPresets,
  sanitizeStatusWidgetPresetTitle,
  validateStatusWidgetPresetInput,
} from "@/lib/statusWidgetPresets";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const presets = listStatusWidgetPresets(user.id);
  return NextResponse.json({ presets });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const title = sanitizeStatusWidgetPresetTitle(String(body.title ?? ""));
  const widgetJson = String(body.widget_json ?? body.widgetJson ?? "").trim();
  const check = validateStatusWidgetPresetInput(title, widgetJson);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const preset = createStatusWidgetPreset(user.id, title, widgetJson);
  if (!preset) {
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, preset });
}
