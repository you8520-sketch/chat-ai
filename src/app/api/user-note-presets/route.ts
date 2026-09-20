import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveSubscriptionMemoryCapability } from "@/lib/subscriptionMemoryCapability";
import {
  createUserNotePreset,
  listUserNotePresets,
  sanitizeNotePresetTitle,
  validateNotePresetInput,
} from "@/lib/userNotePresets";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const presets = listUserNotePresets(user.id);
  return NextResponse.json({ presets });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const title = sanitizeNotePresetTitle(String(body.title ?? ""));
  const content = String(body.content ?? "").trim();
  const focusMaxChars = resolveSubscriptionMemoryCapability(user).focusMaxChars;
  const check = validateNotePresetInput(title, content, focusMaxChars);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const preset = createUserNotePreset(user.id, title, content, focusMaxChars);
  if (!preset) {
    return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, preset });
}
